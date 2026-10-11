import { vi } from "vitest";
import type {
  PhoneDevice,
  PhoneMirrorBackend,
  SessionCallbacks,
  SessionRequest,
} from "../src/domain/PhoneMirror";
export const usbDevice: PhoneDevice = {
  id: "usb:A",
  identity: "A",
  name: "Galaxy",
  availability: "ready",
  endpoint: { transport: "usb", address: "A", identifier: "A" },
};
export const wifiDevice: PhoneDevice = {
  ...usbDevice,
  id: "wifi:A",
  endpoint: {
    transport: "wifi",
    address: "1.2.3.4:1",
    identifier: "adb-A-guid._adb-tls-connect._tcp",
  },
};
export class FakeBackend implements PhoneMirrorBackend {
  devices = [usbDevice, wifiDevice];
  callbacks?: SessionCallbacks;
  discoverDevices = vi.fn(async () => this.devices);
  discoverServices = vi.fn(async () => []);
  pairDevice = vi.fn(async () => {});
  connectDevice = vi.fn(async () => {});
  startSession = vi.fn(
    async (_request: SessionRequest, callbacks: SessionCallbacks) => {
      this.callbacks = callbacks;
    },
  );
  stopSession = vi.fn(async () => {});
}
