import { useTranslation } from "./ApplicationLanguage";
import {
  diagnosticSummary,
  type DiagnosticSummaryStore,
} from "../domain/DiagnosticSummary";
import { TauriDiagnosticSummaryStore } from "../infrastructure/TauriDiagnosticSummaryStore";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConnectionDiagnosticsController } from "../application/ConnectionDiagnosticsController";
import type { PhoneDevice } from "../domain/PhoneMirror";
import { validWirelessAddress } from "../domain/PhoneMirror";
export function ConnectionDiagnosticsPanel({
  controller,
  selectedDevice,
  summaryStore = new TauriDiagnosticSummaryStore(),
}: {
  controller: ConnectionDiagnosticsController;
  selectedDevice?: PhoneDevice;
  summaryStore?: DiagnosticSummaryStore;
}) {
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [exportMessage, setExportMessage] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const saving = useRef(false),
    mounted = useRef(true),
    currentReport = useRef(state.report);
  currentReport.current = state.report;
  useEffect(() => {
    setExportMessage("");
  }, [state.report]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function saveSummary() {
    if (saving.current || !state.report || !state.reportTarget) return;
    saving.current = true;
    setExportBusy(true);
    setExportMessage("");
    const report = state.report;
    try {
      const saved = await summaryStore.save(
        diagnosticSummary(report, state.reportTarget),
      );
      if (mounted.current && currentReport.current === report)
        setExportMessage(
          saved
            ? "진단 요약을 저장했습니다."
            : "진단 요약 저장을 취소했습니다.",
        );
    } catch {
      if (mounted.current && currentReport.current === report)
        setExportMessage("진단 요약을 저장하지 못했습니다. 다시 시도하세요.");
    } finally {
      saving.current = false;
      if (mounted.current) setExportBusy(false);
    }
  }
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
      <summary>{translate("연결 문제 진단")}</summary>
      <p className="hint">
        {" "}
        {translate(
          "연결 종료·재페어링 없이 점검합니다. 진단 결과에 연결 키나 원본 로그를 포함하지 않습니다.",
        )}{" "}
      </p>
      <label>
        {" "}
        {translate("진단할 폰")}{" "}
        <select
          aria-label={translate("진단할 폰")}
          disabled={running}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as "android" | "ios")}
        >
          <option value="android">Android</option>
          <option value="ios">iPhone</option>
        </select>
      </label>
      <label>
        {" "}
        {translate("진단 연결 방식")}{" "}
        <select
          aria-label={translate("진단 연결 방식")}
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
          {" "}
          {translate("연결 주소 (선택)")}{" "}
          <input
            aria-label={translate("진단 연결 주소")}
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
          ? translate("다시 진단")
          : translate("연결 진단 시작")}
      </button>
      {running && (
        <button
          disabled={state.cancelBusy}
          onClick={() => void controller.cancel()}
        >
          {" "}
          {translate("진단 취소")}{" "}
        </button>
      )}
      <p role="status">{translate(state.message)}</p>
      {state.report && (
        <>
          <button disabled={exportBusy} onClick={() => void saveSummary()}>
            {" "}
            {translate("진단 요약 저장")}{" "}
          </button>
          <p className="hint">
            {" "}
            {translate(
              "점검 코드·결과·연결 종류만 저장합니다. 기기 식별자, IP 주소, 입력 내용, 화면과 원본 로그는 포함하지 않습니다.",
            )}{" "}
          </p>
          <p role="status">{translate(exportMessage)}</p>
        </>
      )}
      {state.report && (
        <ul aria-label={translate("연결 진단 결과")}>
          {state.report.checks.map((check) => (
            <li key={check.code} data-status={check.status}>
              <strong>{translate(check.title)}</strong>
              <span>
                {check.status === "passed"
                  ? translate("점검 통과")
                  : check.status === "failed"
                    ? translate("문제 확인")
                    : translate("확인 필요")}
              </span>
              <p>{translate(check.message)}</p>
              {check.action && <p>{translate(check.action)}</p>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
