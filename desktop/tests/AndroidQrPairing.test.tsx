import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AndroidQrPairingController } from "../src/application/AndroidQrPairingController";
import { AndroidQrPairingPanel } from "../src/presentation/AndroidQrPairingPanel";
const info = {
  sessionId: "qr-1",
  payload: `WIFI:T:ADB;S:studio-${"ab".repeat(16)};P:${"cd".repeat(16)};;`,
  expiresInSeconds: 120,
};
it("shows QR, blocks repeated starts, clears secrets after completion and refreshes devices", async () => {
  let complete!: (v: { address: string }) => void;
  const backend = {
    start: vi.fn(async () => info),
    wait: vi.fn(() => new Promise<{ address: string }>((r) => (complete = r))),
    cancel: vi.fn(async () => {}),
  };
  const connected = vi.fn();
  const controller = new AndroidQrPairingController(backend, connected);
  render(<AndroidQrPairingPanel controller={controller} />);
  fireEvent.click(screen.getByText("Android QR 페어링 시작"));
  await screen.findByRole("img", { name: "Android Wi-Fi 페어링 QR 코드" });
  await controller.start();
  expect(backend.start).toHaveBeenCalledTimes(1);
  complete({ address: "192.168.0.44:65535" });
  await waitFor(() => expect(connected).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("img")).toBeNull();
  expect(controller.getSnapshot().payload).toBeUndefined();
});
it("cancels pending starts and ignores late completion without refreshing devices", async () => {
  let ready!: (v: typeof info) => void;
  const backend = {
    start: vi.fn(() => new Promise<typeof info>((r) => (ready = r))),
    wait: vi.fn(async () => ({ address: "1.2.3.4:1" })),
    cancel: vi.fn(async () => {}),
  };
  const connected = vi.fn();
  const controller = new AndroidQrPairingController(backend, connected);
  const task = controller.start();
  await controller.cancel();
  ready(info);
  await task;
  expect(backend.cancel).toHaveBeenCalledWith("qr-1");
  expect(backend.wait).not.toHaveBeenCalled();
  expect(connected).not.toHaveBeenCalled();
});
it("removes QR on errors and keeps manual pairing available", async () => {
  const backend = {
    start: vi.fn(async () => info),
    wait: vi.fn(async () => {
      throw Error("secret must not appear");
    }),
    cancel: vi.fn(async () => {}),
  };
  const controller = new AndroidQrPairingController(backend, vi.fn());
  await controller.start();
  expect(controller.getSnapshot().phase).toBe("error");
  expect(controller.getSnapshot().payload).toBeUndefined();
  expect(controller.getSnapshot().message).not.toContain("secret");
});
it("reports failed cancellation and blocks restart until cancellation is retried", async () => {
  const backend = {
    start: vi.fn(async () => info),
    wait: vi.fn(() => new Promise<{ address: string }>(() => {})),
    cancel: vi.fn(async (): Promise<void> => {
      throw Error("cancel failed");
    }),
  };
  const controller = new AndroidQrPairingController(backend, vi.fn());
  void controller.start();
  await waitFor(() => expect(controller.getSnapshot().phase).toBe("waiting"));
  await controller.cancel();
  expect(controller.getSnapshot().phase).toBe("cancelError");
  await controller.start();
  expect(backend.start).toHaveBeenCalledTimes(1);
  backend.cancel.mockResolvedValueOnce(undefined);
  await controller.cancel();
  expect(controller.getSnapshot().phase).toBe("idle");
});
it("finishes cancellation when a pending start fails later", async () => {
  let fail!: (reason: Error) => void;
  const backend = {
    start: vi.fn(
      () => new Promise<typeof info>((_, reject) => (fail = reject)),
    ),
    wait: vi.fn(async () => ({ address: "1.2.3.4:1" })),
    cancel: vi.fn(async () => {}),
  };
  const controller = new AndroidQrPairingController(backend, vi.fn());
  const pending = controller.start();
  await controller.cancel();
  fail(Error("late start failure"));
  await pending;
  expect(controller.getSnapshot().phase).toBe("idle");
  expect(backend.wait).not.toHaveBeenCalled();
});
