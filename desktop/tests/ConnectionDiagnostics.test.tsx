import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionDiagnosticsController } from "../src/application/ConnectionDiagnosticsController";
import { ConnectionDiagnosticsPanel } from "../src/presentation/ConnectionDiagnosticsPanel";
const report = {
  elapsedMilliseconds: 12,
  checks: [
    {
      code: "android-device",
      title: "Android 기기 상태",
      status: "failed" as const,
      message: "승인이 필요합니다.",
      action: "폰에서 USB 디버깅을 허용하세요.",
    },
  ],
};
const request = { platform: "android" as const, transport: "usb" as const };
it("drives diagnostics, renders status and guidance, and supports retry without connection operations", async () => {
  const backend = {
    run: vi.fn(async () => report),
    cancel: vi.fn(async () => {}),
  };
  const controller = new ConnectionDiagnosticsController(backend, () => "one");
  render(<ConnectionDiagnosticsPanel controller={controller} />);
  await userEvent.click(screen.getByRole("button", { name: "연결 진단 시작" }));
  expect(backend.run).toHaveBeenCalledWith("one", request);
  expect(
    screen.getByText("폰에서 USB 디버깅을 허용하세요."),
  ).toBeInTheDocument();
  expect(screen.getByText("문제 확인")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "다시 진단" }));
  expect(backend.run).toHaveBeenCalledTimes(2);
});
it("rejects invalid values before invocation and accepts address port boundaries", async () => {
  const backend = {
    run: vi.fn(async () => report),
    cancel: vi.fn(async () => {}),
  };
  const c = new ConnectionDiagnosticsController(backend, () => "one");
  for (const address of [
    "1.2.3.4:0",
    "1.2.3.4:65536",
    "host:123",
    "PMW1|secret",
    "1.2.3.4:1\n",
  ])
    await c.run({ ...request, transport: "wifi", address });
  expect(backend.run).not.toHaveBeenCalled();
  for (const address of ["1.2.3.4:1", "[::1]:65535"])
    await c.run({ ...request, transport: "wifi", address });
  expect(backend.run).toHaveBeenCalledTimes(2);
  await c.run({ ...request, platform: "invalid" as "android" });
  expect(backend.run).toHaveBeenCalledTimes(2);
});
it("blocks repeated runs and ignores results/errors arriving after cancellation and disposal", async () => {
  let finish!: (r: typeof report) => void;
  const backend = {
    run: vi.fn(() => new Promise<typeof report>((r) => (finish = r))),
    cancel: vi.fn(async () => {}),
  };
  const c = new ConnectionDiagnosticsController(backend, () => "one");
  const pending = c.run(request);
  await c.run(request);
  expect(backend.run).toHaveBeenCalledTimes(1);
  await c.cancel();
  finish(report);
  await pending;
  expect(c.getSnapshot().report).toBeUndefined();
  expect(c.getSnapshot().phase).toBe("idle");
  const second = c.run(request);
  c.dispose();
  finish(report);
  await second;
  expect(c.getSnapshot().report).toBeUndefined();
  expect(backend.cancel).toHaveBeenCalledWith("one");
});
it("retries transport failures and never surfaces raw backend secrets", async () => {
  const backend = {
    run: vi
      .fn()
      .mockRejectedValueOnce(new Error("secret 123456 IP"))
      .mockResolvedValue(report),
    cancel: vi.fn(async () => {}),
  };
  const c = new ConnectionDiagnosticsController(backend, () => "one");
  await c.run(request);
  expect(c.getSnapshot().phase).toBe("error");
  expect(JSON.stringify(c.getSnapshot())).not.toContain("secret");
  await c.run(request);
  expect(c.getSnapshot().phase).toBe("done");
});
it("keeps cancelling state on failed cancellation until the outstanding task ends", async () => {
  let finish!: (r: typeof report) => void;
  const backend = {
    run: vi.fn(() => new Promise<typeof report>((r) => (finish = r))),
    cancel: vi.fn(async () => {
      throw new Error("secret");
    }),
  };
  const c = new ConnectionDiagnosticsController(backend, () => "one");
  const pending = c.run(request);
  await c.cancel();
  expect(c.getSnapshot().phase).toBe("running");
  await c.run(request);
  expect(backend.run).toHaveBeenCalledTimes(1);
  finish(report);
  await pending;
  expect(c.getSnapshot().phase).toBe("done");
});
it("integrates diagnostics beside device controls without starting or stopping the mirror session", async () => {
  const { PhoneMirrorApp } = await import("../src/presentation/PhoneMirrorApp");
  const { PhoneMirrorController } =
    await import("../src/application/PhoneMirrorController");
  const { FakeBackend } = await import("./fixtures");
  const mirrorBackend = new FakeBackend();
  const mirror = new PhoneMirrorController(mirrorBackend);
  await mirror.refreshDevices();
  const backend = {
    run: vi.fn(async () => report),
    cancel: vi.fn(async () => {}),
  };
  const diagnostics = new ConnectionDiagnosticsController(backend, () => "one");
  render(
    <PhoneMirrorApp
      controller={mirror}
      connectionDiagnosticsController={diagnostics}
    />,
  );
  await userEvent.click(screen.getByText("연결 문제 진단"));
  await userEvent.click(screen.getByRole("button", { name: "연결 진단 시작" }));
  expect(backend.run).toHaveBeenCalledWith("one", {
    platform: "android",
    transport: "usb",
    identifier: "A",
  });
  expect(mirrorBackend.startSession).not.toHaveBeenCalled();
  expect(mirrorBackend.stopSession).not.toHaveBeenCalled();
});
it("supports iPhone and Wi-Fi diagnosis without a discovered phone, and locks controls until cancellation", async () => {
  let finish!: (r: typeof report) => void;
  const backend = {
    run: vi.fn(() => new Promise<typeof report>((r) => (finish = r))),
    cancel: vi.fn(async () => {}),
  };
  const diagnostics = new ConnectionDiagnosticsController(backend, () => "one");
  render(<ConnectionDiagnosticsPanel controller={diagnostics} />);
  await userEvent.selectOptions(screen.getByLabelText("진단할 폰"), "ios");
  await userEvent.selectOptions(
    screen.getByLabelText("진단 연결 방식"),
    "wifi",
  );
  await userEvent.click(screen.getByRole("button", { name: "연결 진단 시작" }));
  expect(backend.run).toHaveBeenCalledWith("one", {
    platform: "ios",
    transport: "wifi",
  });
  expect(screen.queryByLabelText("진단 연결 주소")).not.toBeInTheDocument();
  expect(screen.getByLabelText("진단할 폰")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "진단 취소" }));
  finish(report);
  expect(screen.getByLabelText("진단할 폰")).toBeEnabled();
});
it("validates identifier length, control characters and runtime address types", async () => {
  const backend = {
    run: vi.fn(async () => report),
    cancel: vi.fn(async () => {}),
  };
  const c = new ConnectionDiagnosticsController(backend, () => "one");
  for (const identifier of ["", "a".repeat(257), "a\n", "a\u0085"])
    await c.run({ ...request, identifier });
  await c.run({
    ...request,
    transport: "wifi",
    address: 5 as unknown as string,
  });
  expect(backend.run).not.toHaveBeenCalled();
  await c.run({ ...request, identifier: "a".repeat(256) });
  expect(backend.run).toHaveBeenCalledTimes(1);
});
