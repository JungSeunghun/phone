import {
  AdaptiveQualityPolicy,
  type AdaptiveQualitySample,
} from "../domain/AdaptiveQuality";
import type { AudioPlaybackStatus } from "../domain/PhoneMirror";
import {
  defaultMirrorSettings,
  deviceCapabilities,
  validMirrorSettings,
  validPairingCode,
  validWirelessAddress,
} from "../domain/PhoneMirror";
import type {
  ConnectionTarget,
  MirrorSettings,
  PhoneDevice,
  PhoneMirrorBackend,
  VideoSink,
  AudioSink,
  WirelessService,
} from "../domain/PhoneMirror";

export interface SettingsStorage {
  load(): unknown;
  save(value: StoredPreferences): void;
}
export interface StoredPreferences {
  selectedDeviceId: string;
  settings: MirrorSettings;
  adaptiveQuality?: boolean;
  autoReconnect: boolean;
}
export interface PhoneMirrorSnapshot {
  phase: "idle" | "ready" | "connecting" | "live" | "reconnecting" | "error";
  message: string;
  devices: PhoneDevice[];
  selectedDeviceId: string;
  refreshing: boolean;
  dimensions: { width: number; height: number } | null;
  settings: MirrorSettings;
  adaptiveQuality: boolean;
  qualityMessage: string;
  autoReconnect: boolean;
  services: WirelessService[];
  pairingAddress: string;
  pairingCode: string;
  connectionAddress: string;
  wirelessBusy: boolean;
  wirelessMessage: string;
  canPair: boolean;
  canConnect: boolean;
  audioMessage: string;
  audioMuted: boolean;
  audioPlayback: AudioPlaybackStatus;
  inputMessage: string;
}
const retryDelays = [1000, 2000, 4000, 8000, 16000];
export class PhoneMirrorController {
  snapshot: PhoneMirrorSnapshot = {
    phase: "idle",
    message: "USB로 연결하거나 Wi-Fi를 페어링하세요.",
    devices: [],
    selectedDeviceId: "",
    refreshing: false,
    dimensions: null,
    settings: { ...defaultMirrorSettings },
    adaptiveQuality: true,
    qualityMessage: "Wi-Fi 자동 화질 대기",
    autoReconnect: true,
    services: [],
    pairingAddress: "",
    pairingCode: "",
    connectionAddress: "",
    wirelessBusy: false,
    wirelessMessage: "",
    canPair: false,
    canConnect: false,
    audioMessage: "폰 연결 후 컴퓨터에서 소리를 재생합니다.",
    audioMuted: false,
    audioPlayback: "idle",
    inputMessage: "클릭 · 드래그 · 휠 · 우클릭 뒤로",
  };
  private qualityPolicy = new AdaptiveQualityPolicy();
  private runtimeSettings?: MirrorSettings;
  private qualityChanging = false;
  private pendingQuality?: number;
  private listeners = new Set<() => void>();
  private generation = 0;
  private sessionId?: string;
  private intent?: ConnectionTarget;
  private activeCapabilities?: import("../domain/PhoneMirror").DeviceCapabilities;
  private retryCount = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private sink?: VideoSink;
  private audioSink?: AudioSink;
  private wirelessGeneration = 0;
  constructor(
    private backend: PhoneMirrorBackend,
    private storage?: SettingsStorage,
  ) {
    try {
      const saved = storage?.load() as Partial<StoredPreferences> | undefined;
      if (saved && validMirrorSettings(saved.settings))
        this.snapshot.settings = { ...saved.settings };
      if (saved && typeof saved.adaptiveQuality === "boolean")
        this.snapshot.adaptiveQuality = saved.adaptiveQuality;
      if (
        saved &&
        typeof saved.selectedDeviceId === "string" &&
        /^(usb|wifi):[^\s].{0,255}$/.test(saved.selectedDeviceId)
      )
        this.snapshot.selectedDeviceId = saved.selectedDeviceId;
      if (saved && typeof saved.autoReconnect === "boolean")
        this.snapshot.autoReconnect = saved.autoReconnect;
    } catch {
      /* Corrupt storage falls back to defaults without starting a session. */
    }
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): PhoneMirrorSnapshot => this.snapshot;
  private update(change: Partial<PhoneMirrorSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    next.canPair =
      !next.wirelessBusy &&
      validWirelessAddress(next.pairingAddress) &&
      validPairingCode(next.pairingCode);
    next.canConnect =
      !next.wirelessBusy && validWirelessAddress(next.connectionAddress);
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  private persist(): void {
    try {
      this.storage?.save({
        selectedDeviceId: this.snapshot.selectedDeviceId,
        settings: this.snapshot.settings,
        adaptiveQuality: this.snapshot.adaptiveQuality,
        autoReconnect: this.snapshot.autoReconnect,
      });
    } catch {
      /* Connection continues if preferences cannot be written. */
    }
  }
  attachVideoSink(sink: VideoSink): () => void {
    this.sink = sink;
    return () => {
      if (this.sink === sink) this.sink = undefined;
      sink.close();
    };
  }
  attachAudioSink(sink: AudioSink): () => void {
    this.audioSink = sink;
    sink.setMuted(this.snapshot.audioMuted);
    return () => {
      if (this.audioSink === sink) this.audioSink = undefined;
      sink.close();
    };
  }
  getCapabilities() {
    return (
      (this.intent && this.activeCapabilities) ||
      deviceCapabilities(
        this.snapshot.devices.find(
          (d) => d.id === this.snapshot.selectedDeviceId,
        ),
      )
    );
  }
  async enableAudio(): Promise<void> {
    if (!this.getCapabilities().audio) return;
    const generation = this.generation;
    try {
      await this.audioSink?.prepare();
    } catch {
      if (
        generation !== this.generation ||
        !["connecting", "live", "reconnecting"].includes(this.snapshot.phase)
      )
        return;
      this.update({
        audioPlayback: "blocked",
        audioMessage:
          "소리 재생을 시작할 수 없습니다. 소리 재생 버튼을 눌러주세요.",
      });
    }
  }
  setAudioMessage(
    message: string,
    audioPlayback = this.snapshot.audioPlayback,
  ) {
    if (!["connecting", "live", "reconnecting"].includes(this.snapshot.phase))
      return;
    if (
      this.snapshot.audioMessage !== message ||
      this.snapshot.audioPlayback !== audioPlayback
    )
      this.update({ audioMessage: message, audioPlayback });
  }
  setInputMessage(message: string) {
    this.update({ inputMessage: message });
  }
  setAudioMuted(value: boolean) {
    this.audioSink?.setMuted(value);
    this.update({ audioMuted: value });
  }
  getActiveSessionId(): string | undefined {
    return this.snapshot.phase === "live" ? this.sessionId : undefined;
  }
  async sendControl(
    input: import("../domain/PhoneInput").ControlInput,
  ): Promise<void> {
    const id = this.sessionId;
    if (!id || this.snapshot.phase !== "live")
      throw Error("Inactive input session");
    if (!this.getCapabilities().control || !this.backend.sendControl)
      throw Error("Input unavailable");
    await this.backend.sendControl(id, input);
  }
  async refreshDevices(): Promise<void> {
    if (this.snapshot.refreshing) return;
    this.update({ refreshing: true });
    try {
      const devices = await this.backend.discoverDevices();
      const selectedDeviceId = devices.some(
        (device) => device.id === this.snapshot.selectedDeviceId,
      )
        ? this.snapshot.selectedDeviceId
        : this.intent
          ? this.snapshot.selectedDeviceId
          : (devices.find((device) => device.availability === "ready")?.id ??
            devices[0]?.id ??
            "");
      this.update({
        devices,
        selectedDeviceId,
        ...(this.intent
          ? {}
          : {
              phase: devices.some(
                (d) => d.id === selectedDeviceId && d.availability === "ready",
              )
                ? ("ready" as const)
                : ("idle" as const),
              message: devices.length
                ? "기기를 선택하고 화면 보기를 시작하세요."
                : "USB 연결이나 Wi-Fi 페어링을 확인하세요.",
            }),
      });
    } catch {
      if (!this.intent)
        this.update({
          message:
            "기기 검색에 실패했습니다. USB 신뢰·권한 또는 Android Platform Tools를 확인하세요.",
          phase: "error",
        });
    } finally {
      this.update({ refreshing: false });
    }
  }
  selectDevice(id: string): void {
    if (
      this.intent ||
      !this.snapshot.devices.some((device) => device.id === id)
    )
      return;
    this.update({ selectedDeviceId: id });
    this.persist();
  }
  setSettings(settings: MirrorSettings): void {
    if (!this.intent && validMirrorSettings(settings)) {
      this.update({ settings: { ...settings } });
      this.persist();
    }
  }
  setAutoReconnect(value: boolean): void {
    this.update({ autoReconnect: value });
    this.persist();
    if (!value && this.snapshot.phase === "reconnecting") void this.stop();
  }
  async start(): Promise<void> {
    if (this.intent) return;
    const device = this.snapshot.devices.find(
      (device) =>
        device.id === this.snapshot.selectedDeviceId &&
        device.availability === "ready",
    );
    if (!device) return;
    this.qualityPolicy = new AdaptiveQualityPolicy();
    this.runtimeSettings = undefined;
    this.pendingQuality = undefined;
    this.activeCapabilities = { ...deviceCapabilities(device) };
    this.intent = {
      identity: device.identity,
      transport: device.endpoint.transport,
    };
    this.retryCount = 0;
    this.persist();
    const session = this.beginSession();
    // Prepare audio within the original user gesture, after reserving its generation.
    void this.enableAudio();
    await session;
  }
  private async beginSession(): Promise<void> {
    if (!this.intent) return;
    const token = ++this.generation,
      sessionId = crypto.randomUUID();
    this.sessionId = sessionId;
    this.sink?.reset();
    this.audioSink?.reset();
    this.update({
      phase: "connecting",
      audioMessage: this.getCapabilities().audio
        ? "폰 소리를 연결하고 있습니다."
        : "이 기기는 소리 수신을 지원하지 않습니다.",
      audioPlayback: this.getCapabilities().audio ? "idle" : "unavailable",
      inputMessage: this.getCapabilities().control
        ? "클릭 · 드래그 · 휠 · 우클릭 뒤로"
        : "iPhone: 화면 보기 전용 · 폰에서 직접 조작하세요.",
      dimensions: null,
      message: "폰의 실제 영상 프레임을 기다리고 있습니다.",
    });
    this.frameTimer = setTimeout(() => {
      if (token === this.generation)
        this.sessionFailed("첫 영상 프레임 응답 시간이 초과됐습니다.");
    }, 15000);
    try {
      await this.backend.startSession(
        {
          sessionId,
          target: { ...this.intent },
          settings: { ...(this.runtimeSettings ?? this.snapshot.settings) },
        },
        {
          onAudio: (packet) => {
            if (token !== this.generation) return;
            try {
              this.audioSink?.write(packet);
            } catch {
              this.setAudioMessage("폰 오디오 패킷을 재생할 수 없습니다.");
            }
          },
          onAudioStatus: (message) => {
            if (token === this.generation)
              this.setAudioMessage(message, "unavailable");
          },
          onPacket: (packet) => {
            if (token !== this.generation) return;
            try {
              this.sink?.write(packet);
            } catch (error) {
              this.videoFailed(
                error instanceof Error
                  ? error.message
                  : "영상을 표시할 수 없습니다.",
              );
            }
          },
          onStatus: (status) => {
            if (token !== this.generation) return;
            if (status.phase === "failed") this.sessionFailed(status.message);
            else if (status.phase === "stopped") void this.stop();
            else if (this.snapshot.phase !== "live")
              this.update({ message: status.message });
          },
        },
      );
      if (token !== this.generation) await this.backend.stopSession(sessionId);
    } catch {
      if (token === this.generation)
        this.sessionFailed(
          "화면 연결을 시작할 수 없습니다. USB 신뢰·권한 또는 Android 연결을 확인하세요.",
        );
    }
  }
  setAdaptiveQuality(enabled: boolean): void {
    this.update({
      adaptiveQuality: enabled,
      qualityMessage: enabled ? "Wi-Fi 자동 화질 대기" : "자동 화질 꺼짐",
    });
    if (!this.runtimeSettings) this.qualityPolicy = new AdaptiveQualityPolicy();
    this.pendingQuality = undefined;
    this.persist();
  }
  async observeAdaptiveQuality(
    sample: AdaptiveQualitySample,
    now: number,
    recording: boolean,
  ): Promise<void> {
    const device = this.snapshot.devices.find(
      (d) => d.id === this.snapshot.selectedDeviceId,
    );
    if (
      !this.snapshot.adaptiveQuality ||
      this.snapshot.phase !== "live" ||
      !this.intent ||
      this.intent.transport !== "wifi" ||
      device?.platform === "ios" ||
      this.qualityChanging
    )
      return;
    const decision = this.qualityPolicy.observe(sample, now);
    if (decision !== undefined) this.pendingQuality = decision;
    if (this.pendingQuality === undefined) return;
    if (recording) {
      this.update({ qualityMessage: "녹화 보호: 자동 화질 변경 대기" });
      return;
    }
    const level = this.pendingQuality;
    this.pendingQuality = undefined;
    const original = this.snapshot.settings;
    const next = {
      ...original,
      videoMaxDimension: Math.min(
        original.videoMaxDimension,
        [720, 1280, original.videoMaxDimension][level],
      ),
      videoMaxFrameRate: Math.min(
        original.videoMaxFrameRate,
        [15, 30, original.videoMaxFrameRate][level],
      ),
    };
    const current = this.runtimeSettings ?? original;
    if (
      next.videoMaxDimension === current.videoMaxDimension &&
      next.videoMaxFrameRate === current.videoMaxFrameRate
    )
      return;
    this.qualityChanging = true;
    const id = this.sessionId;
    const intent = { ...this.intent };
    const generation = ++this.generation;
    this.sessionId = undefined;
    clearTimeout(this.frameTimer);
    this.update({
      phase: "connecting",
      qualityMessage: `자동 화질: 최대 ${next.videoMaxDimension}px · ${next.videoMaxFrameRate}fps (영상 다시 연결)`,
    });
    try {
      if (id) await this.backend.stopSession(id);
      if (generation !== this.generation || !this.intent) return;
      this.runtimeSettings = next;
      this.intent = intent;
      await this.beginSession();
    } catch {
      if (generation === this.generation)
        this.sessionFailed("자동 화질 변경에 실패했습니다.");
    } finally {
      this.qualityChanging = false;
    }
  }
  frameRendered(width: number, height: number): void {
    if (
      !this.sessionId ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    )
      return;
    clearTimeout(this.frameTimer);
    this.retryCount = 0;
    if (
      this.snapshot.phase !== "live" ||
      this.snapshot.dimensions?.width !== width ||
      this.snapshot.dimensions?.height !== height
    )
      this.update({
        phase: "live",
        message: "앱 안에서 폰 화면을 보고 있습니다.",
        dimensions: { width, height },
      });
  }
  videoFailed(message: string): void {
    if (!this.sessionId) return;
    const stopped = this.stop(),
      generation = this.generation;
    void stopped.then(() => {
      if (generation === this.generation)
        this.update({ phase: "error", message });
    });
  }
  private sessionFailed(message: string): void {
    const id = this.sessionId;
    this.generation++;
    this.sessionId = undefined;
    clearTimeout(this.frameTimer);
    this.sink?.reset();
    this.audioSink?.reset();
    if (id) void this.backend.stopSession(id).catch(() => {});
    if (
      !this.intent ||
      !this.snapshot.autoReconnect ||
      this.retryCount >= retryDelays.length
    ) {
      this.intent = undefined;
      this.update({ phase: "error", dimensions: null, message });
      return;
    }
    this.update({
      phase: "reconnecting",
      dimensions: null,
      message: `${message} 같은 폰의 ${this.intent.transport === "usb" ? "USB" : "Wi-Fi"} 연결을 다시 찾습니다.`,
    });
    this.scheduleRetry(retryDelays[this.retryCount]);
  }
  private scheduleRetry(delay: number): void {
    clearTimeout(this.retryTimer);
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      void (async () => {
        await this.refreshDevices();
        if (!this.intent || generation !== this.generation) return;
        const ready = this.snapshot.devices.some(
          (device) =>
            device.identity === this.intent!.identity &&
            device.endpoint.transport === this.intent!.transport &&
            device.availability === "ready",
        );
        if (!ready) {
          this.scheduleRetry(2000);
          return;
        }
        this.retryCount++;
        await this.beginSession();
      })();
    }, delay);
  }
  async stop(): Promise<void> {
    const id = this.sessionId;
    this.generation++;
    this.sessionId = undefined;
    this.intent = undefined;
    this.retryCount = 0;
    const generation = this.generation;
    clearTimeout(this.retryTimer);
    clearTimeout(this.frameTimer);
    this.sink?.reset();
    this.audioSink?.reset();
    this.update({
      phase: this.snapshot.devices.some(
        (device) =>
          device.id === this.snapshot.selectedDeviceId &&
          device.availability === "ready",
      )
        ? "ready"
        : "idle",
      dimensions: null,
      message: "연결을 종료했습니다.",
      audioMessage: "소리 재생을 종료했습니다.",
      audioPlayback: "idle",
    });
    if (id) {
      try {
        await this.backend.stopSession(id);
      } catch {
        if (generation === this.generation)
          this.update({
            message: "영상은 종료했습니다. 연결 정리 상태를 확인하세요.",
          });
      }
    }
  }
  setPairingAddress(value: string): void {
    this.update({ pairingAddress: value });
  }
  setPairingCode(value: string): void {
    this.update({ pairingCode: value });
  }
  setConnectionAddress(value: string): void {
    this.update({ connectionAddress: value });
  }
  async refreshServices(): Promise<void> {
    if (this.snapshot.wirelessBusy) return;
    const generation = ++this.wirelessGeneration;
    this.update({
      wirelessBusy: true,
      wirelessMessage: "무선 기기를 찾고 있습니다.",
    });
    try {
      const services = await this.backend.discoverServices();
      if (generation === this.wirelessGeneration)
        this.update({
          services,
          wirelessMessage: services.length
            ? "페어링 또는 연결 주소를 선택하세요."
            : "검색된 기기가 없습니다. 주소를 직접 입력할 수 있습니다.",
        });
    } catch {
      if (generation === this.wirelessGeneration)
        this.update({
          wirelessMessage:
            "무선 검색에 실패했습니다. 주소를 직접 입력할 수 있습니다.",
        });
    } finally {
      if (generation === this.wirelessGeneration)
        this.update({ wirelessBusy: false });
    }
  }
  selectService(service: WirelessService): void {
    if (
      this.snapshot.wirelessBusy ||
      !this.snapshot.services.some(
        (value) =>
          value.name === service.name &&
          value.address === service.address &&
          value.kind === service.kind,
      )
    )
      return;
    this.update(
      service.kind === "pairing"
        ? { pairingAddress: service.address }
        : { connectionAddress: service.address },
    );
  }
  async pair(): Promise<void> {
    if (!this.snapshot.canPair) return;
    const address = this.snapshot.pairingAddress,
      code = this.snapshot.pairingCode,
      generation = ++this.wirelessGeneration;
    this.update({
      wirelessBusy: true,
      pairingCode: "",
      wirelessMessage: "폰과 페어링하고 있습니다.",
    });
    try {
      await this.backend.pairDevice(address, code);
      if (generation === this.wirelessGeneration) {
        this.update({
          wirelessMessage:
            "페어링했습니다. 폰의 무선 디버깅 연결 주소로 연결하세요.",
        });
        await this.refreshDevices();
      }
    } catch {
      if (generation === this.wirelessGeneration)
        this.update({
          wirelessMessage:
            "페어링에 실패했습니다. 새 코드와 페어링 포트를 확인하세요.",
        });
    } finally {
      if (generation === this.wirelessGeneration)
        this.update({ wirelessBusy: false });
    }
  }
  async connect(): Promise<void> {
    if (!this.snapshot.canConnect) return;
    const generation = ++this.wirelessGeneration,
      address = this.snapshot.connectionAddress;
    this.update({
      wirelessBusy: true,
      wirelessMessage: "무선 기기를 연결하고 있습니다.",
    });
    try {
      await this.backend.connectDevice(address);
      if (generation === this.wirelessGeneration) {
        this.update({ wirelessMessage: "Wi-Fi 연결을 완료했습니다." });
        await this.refreshDevices();
      }
    } catch {
      if (generation === this.wirelessGeneration)
        this.update({
          wirelessMessage:
            "연결에 실패했습니다. 연결 포트와 같은 Wi-Fi인지 확인하세요.",
        });
    } finally {
      if (generation === this.wirelessGeneration)
        this.update({ wirelessBusy: false });
    }
  }
  dispose(): void {
    this.wirelessGeneration++;
    this.update({ pairingCode: "" });
    void this.stop();
    this.listeners.clear();
  }
}
