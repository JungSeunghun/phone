import { it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IosWifiReceiverPanel } from "../src/presentation/IosWifiReceiverPanel";
import { IosWifiReceiverController } from "../src/application/IosWifiReceiverController";
import { deviceCapabilities } from "../src/domain/PhoneMirror";
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
  fireEvent.click(screen.getByText("iPhone Wi-Fi 송출"));
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
