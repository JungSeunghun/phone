import { FirstConnectionGuide } from "./FirstConnectionGuide";
import { ApplicationUpdateController } from "../application/ApplicationUpdateController";
import { TauriApplicationUpdateBackend } from "../infrastructure/TauriApplicationUpdateBackend";
import { ApplicationUpdatePanel } from "./ApplicationUpdatePanel";
import { ConnectionDiagnosticsController } from "../application/ConnectionDiagnosticsController";
import { TauriConnectionDiagnosticsBackend } from "../infrastructure/TauriConnectionDiagnosticsBackend";
import { ConnectionDiagnosticsPanel } from "./ConnectionDiagnosticsPanel";
import { AndroidQrPairingController } from "../application/AndroidQrPairingController";
import { TauriAndroidQrPairingBackend } from "../infrastructure/TauriAndroidQrPairingBackend";
import { AndroidWirelessConnectionPanel } from "./AndroidWirelessConnectionPanel";
import { IosReceiverController } from "../application/IosReceiverController";
import { IosReceiverPanel } from "./IosReceiverPanel";
import { TauriIosUsbReceiverBackend } from "../infrastructure/TauriIosUsbReceiverBackend";
import { IosWifiReceiverController } from "../application/IosWifiReceiverController";
import { TauriIosWifiReceiverBackend } from "../infrastructure/TauriIosWifiReceiverBackend";
import { IosWifiReceiverPanel } from "./IosWifiReceiverPanel";
import {
  useEffect,
  useRef,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import type { PhoneMirrorController } from "../application/PhoneMirrorController";
import { WebVideoRenderer } from "../infrastructure/WebVideoRenderer";

import { MediaCaptureController } from "../application/MediaCaptureController";
import { NativeMediaCapture } from "../infrastructure/NativeMediaCapture";
import { TauriNativeRecordingBackend } from "../infrastructure/TauriNativeRecordingBackend";
import { CanvasMediaCapture } from "../infrastructure/CanvasMediaCapture";
import { TauriMediaCaptureStore } from "../infrastructure/TauriMediaCaptureStore";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { WindowPresentationController } from "../application/WindowPresentationController";
import { TauriWindowPresentationBackend } from "../infrastructure/TauriWindowPresentationBackend";

import type { VideoPerformanceSnapshot } from "../domain/VideoPerformance";
import { RecordingStatus } from "./RecordingStatus";
import { ToolbarIcon } from "./ToolbarIcon";
import { CaptureActions } from "./CaptureActions";

import {
  TextInputController,
  type TextClipboard,
} from "../application/TextInputController";
import { SystemTextClipboard } from "../infrastructure/SystemTextClipboard";
import { TextInputPanel } from "./TextInputPanel";
import { IosKeyboardInputController } from "../application/IosKeyboardInputController";
import { TauriIosKeyboardInputBackend } from "../infrastructure/TauriIosKeyboardInputBackend";
import { IosKeyboardInputPanel } from "./IosKeyboardInputPanel";

import { usePhoneInteraction } from "./PhoneInteraction";

export function PhoneMirrorApp({
  controller,
  mediaController,
  windowPresentationController,
  iosWifiReceiverController,
  iosUsbReceiverController,
  androidQrPairingController,
  connectionDiagnosticsController,
  textClipboard,
  iosKeyboardInputController,
}: {
  controller: PhoneMirrorController;
  textClipboard?: TextClipboard;
  iosKeyboardInputController?: IosKeyboardInputController;
  mediaController?: MediaCaptureController;
  windowPresentationController?: WindowPresentationController;
  iosWifiReceiverController?: IosWifiReceiverController;
  iosUsbReceiverController?: IosReceiverController;
  androidQrPairingController?: AndroidQrPairingController;
  connectionDiagnosticsController?: ConnectionDiagnosticsController;
}) {
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    canvas = useRef<HTMLCanvasElement>(null);
  const keyboardInput = useMemo(
    () =>
      iosKeyboardInputController ??
      new IosKeyboardInputController(new TauriIosKeyboardInputBackend()),
    [iosKeyboardInputController],
  );
  const keyboardState = useSyncExternalStore(
    keyboardInput.subscribe,
    keyboardInput.getSnapshot,
  );
  const textSession = () => {
    if (controller.getCapabilities().control)
      return controller.getActiveSessionId();
    const current = controller.getSnapshot();
    return current.phase === "live"
      ? keyboardInput.session(current.selectedDeviceId)
      : undefined;
  };
  const textInput = useMemo(
    () =>
      new TextInputController(
        textSession,
        (input, session) =>
          controller.getCapabilities().control
            ? controller.sendControl(input, session)
            : keyboardInput.send(input, session),
        textClipboard ?? new SystemTextClipboard(),
      ),
    [controller, textClipboard, keyboardInput],
  );
  useEffect(() => {
    let session = controller.getActiveSessionId();
    const unsubscribe = controller.subscribe(() => {
      const current = controller.getActiveSessionId();
      if (current !== session) {
        if (session && !current) void keyboardInput.stop();
        session = current;
        textInput.reset();
      }
      const selectedId = controller.getSnapshot().selectedDeviceId;
      if (
        keyboardInput.getSnapshot().targetId &&
        keyboardInput.getSnapshot().targetId !== selectedId
      )
        void keyboardInput.stop();
    });
    return () => {
      unsubscribe();
      textInput.reset();
    };
  }, [controller, textInput, keyboardInput]);
  useEffect(() => {
    let session = keyboardInput.session(
      controller.getSnapshot().selectedDeviceId,
    );
    const unsubscribe = keyboardInput.subscribe(() => {
      const current = keyboardInput.session(
        controller.getSnapshot().selectedDeviceId,
      );
      if (session !== current) {
        session = current;
        textInput.reset();
      }
    });
    return () => {
      unsubscribe();
      void keyboardInput.stop();
    };
  }, [controller, keyboardInput, textInput]);
  const diagnostics = useMemo(
    () =>
      connectionDiagnosticsController ??
      new ConnectionDiagnosticsController(
        new TauriConnectionDiagnosticsBackend(),
      ),
    [connectionDiagnosticsController],
  );
  useEffect(() => () => diagnostics.dispose(), [diagnostics]);
  const androidQr = useMemo(
    () =>
      androidQrPairingController ??
      new AndroidQrPairingController(new TauriAndroidQrPairingBackend(), () =>
        controller.refreshDevices(),
      ),
    [androidQrPairingController, controller],
  );
  const androidQrState = useSyncExternalStore(
    androidQr.subscribe,
    androidQr.getSnapshot,
  );
  const androidQrBusy = [
    "starting",
    "waiting",
    "cancelling",
    "cancelError",
  ].includes(androidQrState.phase);
  useEffect(() => () => androidQr.dispose(), [androidQr]);
  const media = useMemo(
    () =>
      mediaController ??
      new MediaCaptureController(
        new NativeMediaCapture(
          new TauriNativeRecordingBackend(),
          () => {
            const sessionId = controller.getActiveSessionId(),
              snapshot = controller.getSnapshot();
            if (!sessionId || !snapshot.dimensions) return undefined;
            return {
              sessionId,
              ...snapshot.dimensions,
              fps: snapshot.settings.videoMaxFrameRate,
              includeAudio: controller.getCapabilities().audio,
            };
          },
          () => new CanvasMediaCapture(canvas.current!).screenshot(),
        ),
        new TauriMediaCaptureStore(),
      ),
    [mediaController, controller],
  );
  const windowBackend = useMemo(() => new TauriWindowPresentationBackend(), []);
  const presentation = useMemo(
    () =>
      windowPresentationController ??
      new WindowPresentationController(windowBackend),
    [windowPresentationController, windowBackend],
  );
  const view = useSyncExternalStore(
    presentation.subscribe,
    presentation.getSnapshot,
  );
  useEffect(() => {
    const sync = () => {
      const mirror = controller.getSnapshot();
      presentation.setLive(
        mirror.phase === "live",
        mirror.dimensions ?? undefined,
      );
    };
    sync();
    const unsubscribe = controller.subscribe(sync);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void presentation.setMode("normal");
    };
    window.addEventListener("keydown", escape);
    const unlisten = isTauri()
      ? windowBackend.subscribe((mode) => presentation.nativeModeChanged(mode))
      : undefined;
    const errors = isTauri()
      ? listen<string>("window-view-error", (event) =>
          presentation.nativeError(event.payload),
        )
      : undefined;
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", escape);
      void unlisten?.then((remove) => remove());
      void errors?.then((remove) => remove());
      presentation.dispose();
    };
  }, [controller, presentation, windowBackend]);
  const receiver = useMemo(
    () =>
      iosWifiReceiverController ??
      new IosWifiReceiverController(new TauriIosWifiReceiverBackend()),
    [iosWifiReceiverController],
  );
  useEffect(() => () => receiver.dispose(), [receiver]);
  const usbReceiver = useMemo(
    () =>
      iosUsbReceiverController ??
      new IosReceiverController(new TauriIosUsbReceiverBackend(), "usb"),
    [iosUsbReceiverController],
  );
  useEffect(() => () => usbReceiver.dispose(), [usbReceiver]);
  const [settingsOpen, setSettingsOpen] = useState(true);
  useEffect(() => {
    setSettingsOpen(state.phase !== "live");
  }, [state.phase]);
  const capture = useSyncExternalStore(media.subscribe, media.getSnapshot);
  useEffect(() => {
    const sync = () => media.setLive(controller.getSnapshot().phase === "live");
    sync();
    const unsubscribe = controller.subscribe(sync);
    const unlisten = isTauri()
      ? listen("media-shutdown", () => {
          void media.finish().then(() => invoke("finish_media_shutdown"));
        })
      : undefined;
    return () => {
      unsubscribe();
      media.setLive(false);
      void unlisten?.then((remove) => remove());
    };
  }, [controller, media]);
  const [performanceReport, setPerformanceReport] =
    useState<VideoPerformanceSnapshot>();
  const interaction = usePhoneInteraction(controller);
  const capabilities = controller.getCapabilities();
  const active = ["connecting", "live", "reconnecting"].includes(state.phase);
  const applicationUpdate = useMemo(
    () =>
      new ApplicationUpdateController(
        new TauriApplicationUpdateBackend(),
        localStorage,
        () =>
          ["connecting", "live", "reconnecting"].includes(
            controller.getSnapshot().phase,
          ) ||
          media.getSnapshot().busy ||
          media.getSnapshot().recording,
        () => performance.now(),
      ),
    [controller, media],
  );
  const selected = state.devices.find(
    (device) => device.id === state.selectedDeviceId,
  );
  useEffect(() => {
    const sink = new WebVideoRenderer(
      canvas.current!,
      (width, height) => controller.frameRendered(width, height),
      (message) => controller.videoFailed(message),
      () => media.setLive(false),
    );
    const detach = controller.attachVideoSink(sink);
    const performanceTimer = setInterval(() => {
      setPerformanceReport(sink.getPerformance());
      void controller.observeAdaptiveQuality(
        sink.takeAdaptiveSample(),
        performance.now(),
        media.getSnapshot().recording ||
          media.getSnapshot().busy ||
          media.getSnapshot().pauseBusy,
      );
    }, 1000);
    void controller.refreshDevices();
    const timer = setInterval(() => {
      void controller.refreshDevices();
    }, 2000);
    return () => {
      clearInterval(timer);
      clearInterval(performanceTimer);
      detach();
      controller.dispose();
    };
  }, [controller, media]);
  const phaseLabel = {
    idle: "기기 연결 대기",
    ready: "화면 보기 준비",
    connecting: "영상 연결 중",
    live: "화면 수신 중",
    reconnecting: "자동 재연결 대기",
    error: "연결 확인 필요",
  }[state.phase];
  return (
    <main
      className={
        "app-shell view-" +
        view.mode +
        (settingsOpen ? "" : " settings-collapsed")
      }
    >
      <aside
        className="sidebar"
        id="mirror-settings"
        aria-label="기기 및 화면 설정"
      >
        <div className="sidebar-device">
          <header className="brand">
            <span className="brand-icon">▣</span>
            <div>
              <h1>Phone Mirror</h1>
              <p>Android · iPhone</p>
            </div>
          </header>
          <section aria-label="기기 선택">
            <div className="section-title">
              <h2>연결된 기기</h2>
              <button
                className="quiet"
                onClick={() => void controller.refreshDevices()}
                disabled={state.refreshing}
              >
                새로 고침
              </button>
            </div>
            <label className="sr-only" htmlFor="device">
              연결된 기기
            </label>
            <select
              id="device"
              value={state.selectedDeviceId}
              onChange={(event) => controller.selectDevice(event.target.value)}
              disabled={active}
            >
              {!state.devices.length && (
                <option value="">연결된 기기가 없습니다</option>
              )}
              {!state.devices.some((d) => d.id === state.selectedDeviceId) &&
                state.selectedDeviceId && (
                  <option value={state.selectedDeviceId}>
                    선택한 폰 재연결 대기
                  </option>
                )}
              {state.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ·{" "}
                  {device.endpoint.transport === "usb" ? "USB" : "Wi-Fi"} ·{" "}
                  {device.availability === "ready"
                    ? "사용 가능"
                    : device.availability === "unauthorized"
                      ? "승인 필요"
                      : "오프라인"}
                </option>
              ))}
            </select>
            <p className="hint">
              {selected?.platform === "ios"
                ? selected.endpoint.transport === "wifi"
                  ? "iPhone 송출 앱에서 방송을 시작하세요. 연결 코드가 바뀌면 앱에 다시 입력하세요."
                  : selected.identity.startsWith("ios-usb:")
                    ? "USB 송출 앱에서 화면 방송을 시작하세요. USB 신뢰와 연결 코드를 확인하세요."
                    : "iPhone 잠금을 해제하고 ‘이 컴퓨터를 신뢰’를 승인하세요. Mac의 카메라 권한도 필요합니다."
                : "Android USB는 디버깅을 허용하고, Wi-Fi는 같은 네트워크에서 연결하세요."}
            </p>
          </section>
        </div>
        <div className="sidebar-content">
          <section aria-label="기기 연결">
            {!active && <FirstConnectionGuide />}
            <h2>기기 연결</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.autoReconnect}
                onChange={(event) =>
                  controller.setAutoReconnect(event.target.checked)
                }
              />
              연결이 끊기면 자동 재연결
            </label>
            <AndroidWirelessConnectionPanel
              controller={controller}
              pairingController={androidQr}
              pairingBusy={androidQrBusy}
            />
            <IosWifiReceiverPanel
              controller={receiver}
              onStop={() => controller.stop()}
            />
            {(iosUsbReceiverController ||
              navigator.userAgent.includes("Windows")) && (
              <IosReceiverPanel
                controller={usbReceiver}
                transport="usb"
                onStop={() => controller.stop()}
              />
            )}
          </section>
          <section aria-label="화면 설정">
            <h2>화면 설정</h2>
            {active &&
              !(
                selected?.platform === "ios" &&
                (selected.endpoint.transport === "wifi" ||
                  selected.identity.startsWith("ios-usb:"))
              ) && (
                <p id="video-settings-guidance" className="hint">
                  연결을 종료하면 화질과 프레임을 변경할 수 있습니다. 다음
                  연결부터 적용됩니다.
                </p>
              )}
            {selected?.platform === "ios" &&
              (selected.endpoint.transport === "wifi" ||
                selected.identity.startsWith("ios-usb:")) && (
                <p className="hint" id="video-settings-guidance">
                  화질과 프레임은 iPhone 송출 앱에서 설정합니다.
                </p>
              )}
            <label className="setting">
              화질
              <select
                aria-label="화질"
                aria-describedby="video-settings-guidance"
                value={state.settings.videoMaxDimension}
                disabled={
                  active ||
                  (selected?.platform === "ios" &&
                    (selected.endpoint.transport === "wifi" ||
                      selected.identity.startsWith("ios-usb:")))
                }
                onChange={(event) =>
                  controller.setSettings({
                    ...state.settings,
                    videoMaxDimension: Number(event.target.value),
                  })
                }
              >
                {[720, 1280, 1920, 2560, 3840].map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>
            <label className="setting">
              프레임
              <select
                aria-label="프레임"
                aria-describedby="video-settings-guidance"
                value={state.settings.videoMaxFrameRate}
                disabled={
                  active ||
                  (selected?.platform === "ios" &&
                    (selected.endpoint.transport === "wifi" ||
                      selected.identity.startsWith("ios-usb:")))
                }
                onChange={(event) =>
                  controller.setSettings({
                    ...state.settings,
                    videoMaxFrameRate: Number(event.target.value),
                  })
                }
              >
                {[15, 30, 60].map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={state.adaptiveQuality}
                onChange={(event) =>
                  controller.setAdaptiveQuality(event.target.checked)
                }
              />
              Android Wi-Fi 자동 화질
            </label>
            <p role="status">{state.qualityMessage}</p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={
                  capabilities.keepScreenAwake && state.settings.keepScreenAwake
                }
                disabled={active || !capabilities.keepScreenAwake}
                onChange={(event) =>
                  controller.setSettings({
                    ...state.settings,
                    keepScreenAwake: event.target.checked,
                  })
                }
              />
              연결 중 폰 화면 켜두기
            </label>
          </section>
          {selected?.platform === "ios" && (
            <section aria-label="iPhone 키보드 설정">
              <IosKeyboardInputPanel
                controller={keyboardInput}
                targetId={state.selectedDeviceId}
              />
            </section>
          )}
          <ApplicationUpdatePanel controller={applicationUpdate} />
          <section aria-label="연결 진단">
            <ConnectionDiagnosticsPanel
              controller={diagnostics}
              selectedDevice={selected}
            />
          </section>
        </div>
      </aside>
      <section className="viewer">
        <header className="viewer-header connection-panel">
          <div
            className="connection-summary"
            role="group"
            aria-label="연결 정보"
          >
            {selected && (
              <span className="connection-device" title={selected.name}>
                {selected.name}
              </span>
            )}
            {selected && (
              <span className="transport-badge">
                {selected.endpoint.transport === "usb" ? "USB" : "Wi-Fi"}
              </span>
            )}
            <span className={"connection-state " + state.phase} role="status">
              <span className="status-dot" />
              {phaseLabel}
            </span>
            {selected?.platform === "ios" && (
              <span className="transport-badge">
                {keyboardInput.session(state.selectedDeviceId)
                  ? "iPhone · 키보드 입력 연결됨"
                  : "iPhone · 보기 전용"}
              </span>
            )}
            {state.dimensions && (
              <span className="metrics">
                {state.dimensions.width} × {state.dimensions.height}
              </span>
            )}
          </div>
          <div className="view-controls">
            {view.mode === "normal" ? (
              <>
                <button
                  className="settings-toggle"
                  aria-label={settingsOpen ? "설정 닫기" : "설정 열기"}
                  aria-expanded={settingsOpen}
                  aria-controls="mirror-settings"
                  title="기기 및 화면 설정"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                >
                  <ToolbarIcon name="settings" />
                  <span>설정</span>
                </button>
                <button
                  disabled={!view.live || view.busy}
                  onClick={() => void presentation.setMode("fullscreen")}
                >
                  전체 화면
                </button>
                <button
                  disabled={!view.live || view.busy}
                  onClick={() => void presentation.setMode("pip")}
                >
                  PiP
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={view.busy}
                  onClick={() => void presentation.setMode("normal")}
                >
                  기본 보기
                </button>
                <button
                  aria-label={state.audioMuted ? "음소거 해제" : "소리 끄기"}
                  disabled={!capabilities.audio}
                  onClick={() => controller.setAudioMuted(!state.audioMuted)}
                >
                  <ToolbarIcon name={state.audioMuted ? "muted" : "sound"} />
                </button>
              </>
            )}
            {view.mode !== "normal" && (
              <CaptureActions
                compact
                live={capture.live}
                busy={capture.busy}
                recording={capture.recording}
                onScreenshot={() => void media.screenshot()}
                onRecord={() => void media.startRecording()}
              />
            )}
          </div>
          <button
            className={active ? "connection-stop" : "primary"}
            disabled={!active && selected?.availability !== "ready"}
            onClick={() =>
              active ? void controller.stop() : void controller.start()
            }
          >
            {active && <ToolbarIcon name="disconnect" />}
            <span>{active ? "연결 종료" : "폰 화면 보기"}</span>
          </button>
        </header>
        {state.phase !== "live" && state.message && (
          <p className="connection-message" role="status">
            {state.message}
          </p>
        )}
        {view.message && (
          <p className="view-message" role="alert">
            {view.message}
          </p>
        )}
        <RecordingStatus
          recording={capture.recording}
          elapsedSeconds={capture.elapsedSeconds}
          busy={capture.busy && !capture.screenshotBusy}
          paused={capture.paused}
          pauseBusy={capture.pauseBusy}
          onPause={() => void media.pauseRecording()}
          onResume={() => void media.resumeRecording()}
          onStop={() => void media.stopRecording()}
        />
        <div className="video-stage">
          <canvas
            ref={canvas}
            tabIndex={
              state.phase === "live" &&
              (capabilities.control || keyboardState.connected)
                ? 0
                : -1
            }
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === "v" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!event.repeat) void textInput.pasteClipboard();
              }
            }}
            {...interaction}
            aria-label="폰 영상"
            className={state.phase === "live" ? "visible" : "hidden"}
            width={1}
            height={1}
          />
          {state.phase !== "live" && (
            <div className="empty-state">
              <span className={active ? "pulse phone-symbol" : "phone-symbol"}>
                ▣
              </span>
              <h2>
                {active
                  ? "폰 화면을 연결하고 있어요."
                  : "작은 화면을, 더 넓게."}
              </h2>
              <p>
                {active
                  ? state.message
                  : "Android USB·Wi-Fi 또는 iPhone USB·Wi-Fi 화면을 볼 수 있습니다."}
              </p>
            </div>
          )}
        </div>
        {(capabilities.control || selected?.platform === "ios") && (
          <TextInputPanel
            controller={textInput}
            enabled={
              state.phase === "live" &&
              (capabilities.control ||
                !!keyboardInput.session(state.selectedDeviceId))
            }
            platform={selected?.platform}
          />
        )}
        <div className="viewer-toolbar">
          <div className="audio-controls">
            {state.audioPlayback !== "playing" && (
              <button
                disabled={!active || !capabilities.audio}
                onClick={() => void controller.enableAudio()}
              >
                <ToolbarIcon name="sound" />
                소리 재생
              </button>
            )}
            <label title={state.audioMessage}>
              <input
                type="checkbox"
                disabled={!capabilities.audio}
                checked={state.audioMuted}
                onChange={(event) =>
                  controller.setAudioMuted(event.target.checked)
                }
              />
              <ToolbarIcon name={state.audioMuted ? "muted" : "sound"} />
              음소거
            </label>
            <span
              className="audio-status"
              role="status"
              title={state.audioMessage}
            >
              {state.audioMuted ? "음소거 중" : state.audioMessage}
            </span>
          </div>
          {view.mode === "normal" && (
            <CaptureActions
              compact={false}
              live={capture.live}
              busy={capture.busy}
              recording={capture.recording}
              onScreenshot={() => void media.screenshot()}
              onRecord={() => void media.startRecording()}
            />
          )}
          <details className="performance-info">
            <summary>성능 정보</summary>
            <div>
              표시 {performanceReport?.fps.toFixed(1) ?? "0"} fps · 수신{" "}
              {performanceReport?.received ?? 0} · 표시{" "}
              {performanceReport?.presented ?? 0} · 최신 교체{" "}
              {performanceReport?.replaced ?? 0}
              <br />
              수신 간격 p95{" "}
              {performanceReport?.receiveGapP95Ms.toFixed(1) ?? "0"} ms · 디코딩
              p95 {performanceReport?.decodeP95Ms.toFixed(1) ?? "0"} ms · 그리기
              p95 {performanceReport?.paintP95Ms.toFixed(1) ?? "0"} ms
              <br />
              표시 간격 p95{" "}
              {performanceReport?.displayGapP95Ms.toFixed(1) ?? "0"} ms / 최대{" "}
              {performanceReport?.displayGapMaxMs.toFixed(1) ?? "0"} ms · 디코더
              큐 최대 {performanceReport?.maxDecodeQueue ?? 0}
              <br />
              표시 FPS는 세션 평균이며 정지 화면에서는 낮아질 수 있습니다. 최근
              최대 256개 표본, 캔버스 그리기 기준입니다.
            </div>
          </details>
          <details className="interaction-help">
            <summary aria-label="마우스 조작 안내">?</summary>
            <p>{state.inputMessage}</p>
            <p>Esc: 기본 보기로 돌아가기</p>
            <p>PiP 창 닫기: 기본 보기로 돌아가기</p>
          </details>
        </div>
        {capture.screenshotMessage && (
          <p className="capture-message" role="status">
            {capture.screenshotMessage}
          </p>
        )}
        {capture.message &&
          !capture.recording &&
          capture.message !== capture.screenshotMessage && (
            <p className="capture-message" role="status">
              {capture.message}
            </p>
          )}
        {state.inputMessage.includes("실패") && (
          <p className="view-message" role="alert">
            {state.inputMessage}
          </p>
        )}
      </section>
    </main>
  );
}
