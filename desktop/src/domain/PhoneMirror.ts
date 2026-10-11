export type ConnectionTransport = "usb" | "wifi";
export type DeviceAvailability = "ready" | "unauthorized" | "offline";
export interface ConnectionTarget {
  identity: string;
  transport: ConnectionTransport;
}
export interface DeviceEndpoint {
  transport: ConnectionTransport;
  address: string;
  identifier: string;
}
export interface DeviceCapabilities {
  control: boolean;
  audio: boolean;
  keepScreenAwake: boolean;
}
export interface PhoneDevice {
  platform?: "android" | "ios";
  capabilities?: DeviceCapabilities;
  id: string;
  identity: string;
  name: string;
  availability: DeviceAvailability;
  endpoint: DeviceEndpoint;
}
export interface WirelessService {
  name: string;
  kind: "pairing" | "connection";
  address: string;
}
export interface MirrorSettings {
  videoMaxDimension: number;
  videoMaxFrameRate: number;
  keepScreenAwake: boolean;
}
export interface SessionRequest {
  sessionId: string;
  target: ConnectionTarget;
  settings: MirrorSettings;
}
export interface SessionStatus {
  phase: "connecting" | "streaming" | "failed" | "stopped";
  message: string;
}
export interface SessionCallbacks {
  onPacket(packet: ArrayBuffer): void;
  onStatus(status: SessionStatus): void;
  onAudio?(packet: ArrayBuffer): void;
  onAudioStatus?(message: string): void;
}
export interface PhoneMirrorBackend {
  discoverDevices(): Promise<PhoneDevice[]>;
  discoverServices(): Promise<WirelessService[]>;
  pairDevice(address: string, code: string): Promise<void>;
  connectDevice(address: string): Promise<void>;
  startSession(
    request: SessionRequest,
    callbacks: SessionCallbacks,
  ): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  sendControl?(
    sessionId: string,
    input: import("./PhoneInput").ControlInput,
  ): Promise<void>;
}
export interface AudioSink {
  prepare(): Promise<void>;
  write(packet: ArrayBuffer): void;
  setMuted(muted: boolean): void;
  reset(): void;
  close(): void;
}
export interface VideoSink {
  write(packet: ArrayBuffer): void;
  reset(): void;
  close(): void;
}
export function validWirelessAddress(input: string): boolean {
  const value = input.trim();
  if (value.length > 128 || /\s/.test(value)) return false;
  const match = /^(\[[^\]]+\]|[0-9.]+):([0-9]+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return false;
  if (match[1].startsWith("[")) {
    if (!match[1].includes(":")) return false;
    try {
      new URL(`http://${match[1]}:${Number(match[2])}`);
      return true;
    } catch {
      return false;
    }
  }
  const parts = match[1].split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255,
    )
  );
}
export function validPairingCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}
export const defaultMirrorSettings: MirrorSettings = {
  videoMaxDimension: 1920,
  videoMaxFrameRate: 60,
  keepScreenAwake: true,
};
export function validMirrorSettings(value: unknown): value is MirrorSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as MirrorSettings;
  return (
    [720, 1280, 1920, 2560, 3840].includes(settings.videoMaxDimension) &&
    [15, 30, 60].includes(settings.videoMaxFrameRate) &&
    typeof settings.keepScreenAwake === "boolean"
  );
}

export type AudioPlaybackStatus =
  "idle" | "ready" | "playing" | "blocked" | "unavailable";

export function deviceCapabilities(device?: PhoneDevice): DeviceCapabilities {
  if (device?.platform === "ios")
    return {
      control: false,
      audio: device.capabilities?.audio === true,
      keepScreenAwake: false,
    };
  return (
    device?.capabilities ?? {
      control: true,
      audio: true,
      keepScreenAwake: true,
    }
  );
}
