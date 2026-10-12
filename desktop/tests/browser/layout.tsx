import { ConnectionDiagnosticsController } from "../../src/application/ConnectionDiagnosticsController";
import { AndroidQrPairingController } from "../../src/application/AndroidQrPairingController";
import jsQR from "jsqr";
import { IosReceiverController } from "../../src/application/IosReceiverController";
import { WebAudioPlayer } from "../../src/infrastructure/WebAudioPlayer";
import { IosWifiReceiverController } from "../../src/application/IosWifiReceiverController";
import { createRoot } from "react-dom/client";
import { PhoneMirrorController } from "../../src/application/PhoneMirrorController";
import { PhoneMirrorApp } from "../../src/presentation/PhoneMirrorApp";
import { IosKeyboardInputController } from "../../src/application/IosKeyboardInputController";
import type {
  PhoneMirrorBackend,
  PhoneDevice,
} from "../../src/domain/PhoneMirror";
import "../../src/presentation/styles.css";
const iosUsbFixture = new URLSearchParams(location.search).has("iosusb");
const iosWifiFixture = new URLSearchParams(location.search).has("ioswifi");
const iosFixture = new URLSearchParams(location.search).has("ios");
const iosAudioFixture = new URLSearchParams(location.search).has("iosaudio");
const nativeFixture = new URLSearchParams(location.search).has("native");
const device: PhoneDevice = {
  platform: iosFixture ? "ios" : "android",
  id: iosUsbFixture
    ? "usb:ios-usb:fixture"
    : iosFixture
      ? "usb:ios:fixture"
      : "usb:fixture",
  identity: iosUsbFixture
    ? "ios-usb:fixture"
    : iosFixture
      ? "ios:fixture"
      : "fixture",
  name: iosFixture ? "Mock iPhone" : "Layout fixture",
  availability: "ready",
  capabilities:
    iosWifiFixture || iosAudioFixture || iosUsbFixture
      ? { audio: true, control: false, keepScreenAwake: false }
      : undefined,
  endpoint: {
    transport: iosWifiFixture ? "wifi" : "usb",
    address: "fixture",
    identifier: "fixture",
  },
};
if (new URLSearchParams(location.search).has("adaptive")) {
  device.id = "wifi:fixture";
  device.endpoint = {
    transport: "wifi",
    address: "1.2.3.4:1",
    identifier: "adb-fixture._adb-tls-connect._tcp",
  };
}
const qualityRequests: {
  settings: { videoMaxDimension: number; videoMaxFrameRate: number };
}[] = [];
(
  window as unknown as { qualityRequests: typeof qualityRequests }
).qualityRequests = qualityRequests;
const controls: unknown[] = [];
(window as unknown as { controls: unknown[] }).controls = controls;
let packetTimers: ReturnType<typeof setTimeout>[] = [];
const backend: PhoneMirrorBackend = {
  discoverDevices: async () => [device],
  discoverServices: async () => [],
  pairDevice: async () => {},
  connectDevice: async () => {},
  startSession: async (_request, callbacks) => {
    qualityRequests.push(_request);
    (
      window as unknown as { pushAudio: (packet: ArrayBuffer) => void }
    ).pushAudio = (packet) => callbacks.onAudio?.(packet);
    if (nativeFixture) {
      const response = await fetch("/tests/generated/ios/packets.json");
      if (!response.ok) throw Error("Missing native encoder fixture");
      const packets = (await response.json()) as number[][];
      packetTimers = packets.map((bytes, index) =>
        setTimeout(
          () => callbacks.onPacket(Uint8Array.from(bytes).buffer),
          index * 33,
        ),
      );
    }
  },
  sendControl: async (_id, input) => {
    controls.push(input);
  },
  stopSession: async () => {
    packetTimers.forEach(clearTimeout);
    packetTimers = [];
  },
};
import { MediaCaptureController } from "../../src/application/MediaCaptureController";
import { CanvasMediaCapture } from "../../src/infrastructure/CanvasMediaCapture";
const saved: Blob[] = [];
(window as unknown as { saved: Blob[] }).saved = saved;
import { NativeMediaCapture } from "../../src/infrastructure/NativeMediaCapture";
const nativeSaved: string[] = [];
const nativeStarts: unknown[] = [];
(window as unknown as { nativeStarts: unknown[] }).nativeStarts = nativeStarts;
(window as unknown as { nativeSaved: string[] }).nativeSaved = nativeSaved;
const media = new MediaCaptureController(
  iosFixture
    ? new NativeMediaCapture(
        {
          start: async (context) => {
            nativeStarts.push(context);
            return "mock-native-recording";
          },
          finish: async () => ({ nativeRecordingId: "mock-completed-file" }),
          status: async () => true,
          pause: async () => {},
          resume: async () => {},
        },
        () => {
          const sessionId = controller.getActiveSessionId();
          const dimensions = controller.snapshot.dimensions;
          return sessionId && dimensions
            ? {
                sessionId,
                ...dimensions,
                fps: 30,
                includeAudio: controller.getCapabilities().audio,
              }
            : undefined;
        },
        () =>
          new CanvasMediaCapture(
            document.querySelector("canvas")!,
          ).screenshot(),
      )
    : {
        screenshot: () =>
          new CanvasMediaCapture(
            document.querySelector("canvas")!,
          ).screenshot(),
        record: (onLimit) =>
          new CanvasMediaCapture(document.querySelector("canvas")!).record(
            onLimit,
          ),
      },
  {
    save: async (blob) => {
      if (!(blob instanceof Blob)) {
        nativeSaved.push(blob.nativeRecordingId);
        return "/mock-native";
      }
      saved.push(blob);
      return "/fixture";
    },
  },
);
import { WindowPresentationController } from "../../src/application/WindowPresentationController";
const presentation = new WindowPresentationController({
  setMode: async (mode) => mode,
});
const controller = new PhoneMirrorController(backend);
controller.attachAudioSink(
  new WebAudioPlayer((message, status) =>
    controller.setAudioMessage(message, status),
  ),
);
const receiver = new IosWifiReceiverController({
  start: async () => ({
    receiverId: "mock",
    port: 1234,
    codes: [`PMW1|127.0.0.1:1234|${"ab".repeat(32)}`],
  }),
  stop: async () => {},
});
const usbReceiver = new IosReceiverController(
  {
    start: async () => ({
      receiverId: "usb",
      port: 27483,
      codes: [`PMU1|27483|${"ab".repeat(32)}`],
    }),
    stop: async () => {},
  },
  "usb",
);
(window as unknown as { disconnectFixture: () => void }).disconnectFixture =
  () => {
    void controller.stop();
  };
const androidQrFixture = new URLSearchParams(location.search).has("androidqr");
let finishAndroidQr: ((result: { address: string }) => void) | undefined;
const androidQrPairing = new AndroidQrPairingController(
  {
    start: async () => ({
      sessionId: "android-qr-fixture",
      payload: `WIFI:T:ADB;S:studio-${"ab".repeat(16)};P:${"cd".repeat(16)};;`,
      expiresInSeconds: 120,
    }),
    wait: () =>
      new Promise((resolve) => {
        finishAndroidQr = resolve;
      }),
    cancel: async () => {},
  },
  async () => {
    await controller.refreshDevices();
  },
);
(window as unknown as { completeAndroidQr: () => void }).completeAndroidQr =
  () => finishAndroidQr?.({ address: "192.168.0.44:65535" });
(
  window as unknown as { decodeAndroidQr: () => Promise<string | undefined> }
).decodeAndroidQr = async () => {
  const img = document.querySelector<HTMLImageElement>(
    'img[alt="Android Wi-Fi 페어링 QR 코드"]',
  )!;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(img, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data.data, data.width, data.height)?.data;
};
const diagnostics = new ConnectionDiagnosticsController({
  run: async (_identifier, request) => ({
    elapsedMilliseconds: 4,
    checks:
      request.platform === "android"
        ? [
            {
              code: "adb",
              title: "Android 연결 도구",
              status: "passed",
              message: "점검을 통과했습니다.",
              action: "",
            },
            {
              code: "android-device",
              title: "Android 기기 상태",
              status: "failed",
              message: "승인이 필요합니다.",
              action: "폰에서 USB 디버깅을 허용하세요.",
            },
          ]
        : [
            {
              code: "ios-wifi-receiver",
              title: "iPhone Wi-Fi 수신 수신",
              status: "warning",
              message: "방송 대기 중입니다.",
              action: "최신 QR을 송출 앱에 저장하고 화면 방송을 시작하세요.",
            },
          ],
  }),
  cancel: async () => {},
});
createRoot(document.getElementById("root")!).render(
  <PhoneMirrorApp
    controller={controller}
    iosKeyboardInputController={
      new URLSearchParams(location.search).has("ioskeyboard")
        ? new IosKeyboardInputController({
            start: async () => ({
              receiverId: "mock-keyboard",
              codes: ["PMK1|127.0.0.1:1234|" + "ab".repeat(32)],
            }),
            status: async () => ({ connected: true, generation: "1" }),
            stop: async () => {},
            send: async (_receiver, input) => {
              const fixture = window as unknown as {
                keyboardControls: unknown[];
              };
              fixture.keyboardControls ??= [];
              fixture.keyboardControls.push(input);
            },
          })
        : undefined
    }
    connectionDiagnosticsController={diagnostics}
    androidQrPairingController={androidQrFixture ? androidQrPairing : undefined}
    iosWifiReceiverController={receiver}
    iosUsbReceiverController={iosUsbFixture ? usbReceiver : undefined}
    mediaController={media}
    windowPresentationController={presentation}
  />,
);
(
  window as unknown as {
    renderFixture: (width: number, height: number) => void;
  }
).renderFixture = (width, height) => {
  const canvas = document.querySelector("canvas")!;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#2dd4bf";
  context.fillRect(0, 0, width, height);
  controller.frameRendered(width, height);
};

(
  window as unknown as {
    simulateAdaptiveNetwork: (now: number) => Promise<void>;
  }
).simulateAdaptiveNetwork = (now) =>
  controller.observeAdaptiveQuality(
    { samples: 30, receiveJitterP95Ms: 160, decodeP95Ms: 5 },
    now,
    media.getSnapshot().recording ||
      media.getSnapshot().busy ||
      media.getSnapshot().pauseBusy,
  );
