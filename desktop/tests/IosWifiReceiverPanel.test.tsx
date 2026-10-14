import { it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { IosWifiReceiverPanel } from "../src/presentation/IosWifiReceiverPanel";
import { IosWifiReceiverController } from "../src/application/IosWifiReceiverController";
import { deviceCapabilities } from "../src/domain/PhoneMirror";
it("separates Wi-Fi receiver setup into ordered actions without starting a receiver", () => {
  const start = vi.fn();
  render(
    <IosWifiReceiverPanel
      controller={new IosWifiReceiverController({ start, stop: vi.fn() })}
    />,
  );
  fireEvent.click(screen.getByText("iPhone Wi-Fi 수신"));
  const steps = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(steps).toHaveLength(3);
  expect(steps[0]).toHaveTextContent("같은 Wi-Fi");
  expect(steps[1]).toHaveTextContent("연결 QR 또는 코드");
  expect(steps[2]).toHaveTextContent("화면 방송");
  expect(start).not.toHaveBeenCalled();
});
it("starts listening, exposes code only while active, and stops", async () => {
  const backend = {
    start: vi.fn(async () => ({
      receiverId: "id",
      port: 1234,
      codes: ["PMW1|127.0.0.1:1234|secret"],
    })),
    stop: vi.fn(async () => {}),
  };
  render(
    <IosWifiReceiverPanel
      controller={new IosWifiReceiverController(backend)}
    />,
  );
  fireEvent.click(screen.getByText("iPhone Wi-Fi 수신"));
  fireEvent.click(screen.getByText("iPhone 수신 시작"));
  await waitFor(() =>
    expect(screen.getByLabelText("iPhone 연결 코드 1")).toHaveValue(
      "PMW1|127.0.0.1:1234|secret",
    ),
  );
  fireEvent.click(screen.getByText("iPhone 수신 종료"));
  await waitFor(() => expect(backend.stop).toHaveBeenCalledWith("id"));
  expect(screen.queryByLabelText("iPhone 연결 코드 1")).toBeNull();
});
it("permits iPhone Wi-Fi and USB audio while keeping control unavailable", () => {
  const base = {
    platform: "ios" as const,
    id: "wifi:ios-wifi:id",
    identity: "ios-wifi:id",
    name: "iPhone",
    availability: "ready" as const,
    capabilities: { control: true, audio: true, keepScreenAwake: true },
  };
  expect(
    deviceCapabilities({
      ...base,
      endpoint: {
        transport: "wifi",
        address: "127.0.0.1:12",
        identifier: "id",
      },
    }),
  ).toEqual({ control: false, audio: true, keepScreenAwake: false });
  expect(
    deviceCapabilities({
      ...base,
      endpoint: { transport: "usb", address: "id", identifier: "id" },
    }).audio,
  ).toBe(true);
});
