import { useEffect, useState, useSyncExternalStore } from "react";
import type { ConnectionDiagnosticsController } from "../application/ConnectionDiagnosticsController";
import type { PhoneDevice } from "../domain/PhoneMirror";
import { validWirelessAddress } from "../domain/PhoneMirror";
export function ConnectionDiagnosticsPanel({
  controller,
  selectedDevice,
}: {
  controller: ConnectionDiagnosticsController;
  selectedDevice?: PhoneDevice;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [platform, setPlatform] = useState<"android" | "ios">(
    selectedDevice?.platform ?? "android",
  );
  const [transport, setTransport] = useState<"usb" | "wifi">(
    selectedDevice?.endpoint.transport ?? "usb",
  );
  const [address, setAddress] = useState("");
  useEffect(() => {
    if (state.phase === "running") return;
    setPlatform(selectedDevice?.platform ?? "android");
    setTransport(selectedDevice?.endpoint.transport ?? "usb");
    setAddress(
      selectedDevice && validWirelessAddress(selectedDevice.endpoint.address)
        ? selectedDevice.endpoint.address
        : "",
    );
  }, [selectedDevice?.id]);
  const running = state.phase === "running";
  return (
    <details className="connection-diagnostics">
      <summary>연결 문제 진단</summary>
      <p className="hint">
        연결 종료·재페어링 없이 점검합니다. 진단 결과에 연결 키나 원본 로그를
        포함하지 않습니다.
      </p>
      <label>
        진단할 폰
        <select
          aria-label="진단할 폰"
          disabled={running}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as "android" | "ios")}
        >
          <option value="android">Android</option>
          <option value="ios">iPhone</option>
        </select>
      </label>
      <label>
        진단 연결 방식
        <select
          aria-label="진단 연결 방식"
          disabled={running}
          value={transport}
          onChange={(e) => setTransport(e.target.value as "usb" | "wifi")}
        >
          <option value="usb">USB</option>
          <option value="wifi">Wi-Fi</option>
        </select>
      </label>
      {platform === "android" && transport === "wifi" && (
        <label>
          연결 주소 (선택)
          <input
            aria-label="진단 연결 주소"
            value={address}
            maxLength={128}
            disabled={running}
            placeholder="192.168.0.12:37123"
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
      )}
      <button
        disabled={running}
        onClick={() => {
          const request: {
            platform: "android" | "ios";
            transport: "usb" | "wifi";
            identifier?: string;
            address?: string;
          } = { platform, transport };
          if (
            selectedDevice &&
            (selectedDevice.platform ?? "android") === platform &&
            selectedDevice.endpoint.transport === transport
          )
            request.identifier = selectedDevice.endpoint.identifier;
          if (platform === "android" && transport === "wifi" && address)
            request.address = address;
          void controller.run(request);
        }}
      >
        {state.phase === "done" || state.phase === "error"
          ? "다시 진단"
          : "연결 진단 시작"}
      </button>
      {running && (
        <button
          disabled={state.cancelBusy}
          onClick={() => void controller.cancel()}
        >
          진단 취소
        </button>
      )}
      <p role="status">{state.message}</p>
      {state.report && (
        <ul aria-label="연결 진단 결과">
          {state.report.checks.map((check) => (
            <li key={check.code} data-status={check.status}>
              <strong>{check.title}</strong>
              <span>
                {check.status === "passed"
                  ? "점검 통과"
                  : check.status === "failed"
                    ? "문제 확인"
                    : "확인 필요"}
              </span>
              <p>{check.message}</p>
              {check.action && <p>{check.action}</p>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
