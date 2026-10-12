import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectionDiagnosticsController } from "../src/application/ConnectionDiagnosticsController";
import { ConnectionDiagnosticsPanel } from "../src/presentation/ConnectionDiagnosticsPanel";
it("saves a sanitized summary on demand, deduplicates, and handles cancel/failure", async () => {
  const report = {
    elapsedMilliseconds: 1,
    checks: [
      {
        code: "adb",
        status: "passed" as const,
        title: "private-serial",
        message: "secret-ip",
        action: "private-key",
      },
    ],
  };
  const controller = new ConnectionDiagnosticsController(
    { run: async () => report, cancel: async () => {} },
    () => "id",
  );
  const save = vi.fn(async (_summary: unknown) => true);
  render(
    <ConnectionDiagnosticsPanel
      controller={controller}
      summaryStore={{ save }}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "진단 요약 저장" }),
  ).not.toBeInTheDocument();
  await controller.run({
    platform: "android",
    transport: "usb",
    identifier: "private-serial",
  });
  const button = await screen.findByRole("button", { name: "진단 요약 저장" });
  fireEvent.click(button);
  await screen.findByText("진단 요약을 저장했습니다.");
  expect(JSON.stringify(save.mock.calls[0])).not.toMatch(/private|secret/);
  let finish!: (value: boolean) => void;
  save.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(2);
  finish(false);
  await screen.findByText("진단 요약 저장을 취소했습니다.");
  save.mockRejectedValueOnce(new Error("private-path"));
  fireEvent.click(button);
  await screen.findByText("진단 요약을 저장하지 못했습니다. 다시 시도하세요.");
});
it("clears old export status when another diagnostic report arrives", async () => {
  const controller = new ConnectionDiagnosticsController(
    {
      run: async () => ({ elapsedMilliseconds: 0, checks: [] }),
      cancel: async () => {},
    },
    () => "id",
  );
  render(
    <ConnectionDiagnosticsPanel
      controller={controller}
      summaryStore={{ save: async () => true }}
    />,
  );
  await controller.run({ platform: "android", transport: "usb" });
  fireEvent.click(
    await screen.findByRole("button", { name: "진단 요약 저장" }),
  );
  await screen.findByText("진단 요약을 저장했습니다.");
  await controller.run({ platform: "ios", transport: "wifi" });
  expect(
    screen.queryByText("진단 요약을 저장했습니다."),
  ).not.toBeInTheDocument();
});
