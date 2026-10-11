import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IosReceiverController } from "../src/application/IosReceiverController";
import { IosReceiverPanel } from "../src/presentation/IosReceiverPanel";
it("shows USB setup, saves no code after stop and stops the active session before the receiver", async () => {
  const order: string[] = [];
  const backend = {
    start: vi.fn(async () => ({
      receiverId: "usb",
      port: 27483,
      codes: ["PMU1|27483|secret"],
    })),
    stop: vi.fn(async () => {
      order.push("receiver");
    }),
  };
  const controller = new IosReceiverController(backend, "usb");
  render(
    <IosReceiverPanel
      controller={controller}
      transport="usb"
      onStop={async () => {
        order.push("session");
      }}
    />,
  );
  fireEvent.click(screen.getByText("iPhone Windows USB 송출"));
  expect(screen.getByText(/Apple 기기 드라이버/)).toBeVisible();
  fireEvent.click(screen.getByText("iPhone USB 수신 시작"));
  await waitFor(() =>
    expect(screen.getByLabelText("iPhone USB 연결 코드 1")).toHaveValue(
      "PMU1|27483|secret",
    ),
  );
  fireEvent.click(screen.getByText("iPhone USB 수신 종료"));
  await waitFor(() => expect(order).toEqual(["session", "receiver"]));
  expect(screen.queryByLabelText("iPhone USB 연결 코드 1")).toBeNull();
});
