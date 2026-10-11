import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  PhoneDevice,
  PhoneMirrorBackend,
  SessionCallbacks,
  SessionRequest,
  SessionStatus,
  WirelessService,
} from "../domain/PhoneMirror";
import type {
  SettingsStorage,
  StoredPreferences,
} from "../application/PhoneMirrorController";

export class TauriPhoneMirrorBackend implements PhoneMirrorBackend {
  discoverDevices(): Promise<PhoneDevice[]> {
    return invoke("discover_devices");
  }
  discoverServices(): Promise<WirelessService[]> {
    return invoke("discover_services");
  }
  pairDevice(address: string, code: string): Promise<void> {
    return invoke("pair_device", { address, code });
  }
  connectDevice(address: string): Promise<void> {
    return invoke("connect_device", { address });
  }
  startSession(
    request: SessionRequest,
    callbacks: SessionCallbacks,
  ): Promise<void> {
    const onPacket = new Channel<ArrayBuffer>(),
      onStatus = new Channel<SessionStatus>(),
      onAudio = new Channel<ArrayBuffer>(),
      onAudioStatus = new Channel<string>();
    onPacket.onmessage = callbacks.onPacket;
    onStatus.onmessage = callbacks.onStatus;
    onAudio.onmessage = (packet) => callbacks.onAudio?.(packet);
    onAudioStatus.onmessage = (message) => callbacks.onAudioStatus?.(message);
    return invoke("start_session", {
      request,
      onPacket,
      onStatus,
      onAudio,
      onAudioStatus,
    });
  }
  sendControl(
    sessionId: string,
    input: import("../domain/PhoneInput").ControlInput,
  ): Promise<void> {
    return invoke("send_control", { sessionId, input });
  }
  stopSession(sessionId: string): Promise<void> {
    return invoke("stop_session", { sessionId });
  }
}
export class LocalSettingsStorage implements SettingsStorage {
  load(): unknown {
    const value = localStorage.getItem("phoneMirror.desktop.preferences.v1");
    return value ? JSON.parse(value) : undefined;
  }
  save(value: StoredPreferences): void {
    localStorage.setItem(
      "phoneMirror.desktop.preferences.v1",
      JSON.stringify(value),
    );
  }
}
