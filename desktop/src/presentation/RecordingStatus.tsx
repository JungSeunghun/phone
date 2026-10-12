import { useTranslation } from "./ApplicationLanguage";
import { formatRecordingTime } from "../domain/RecordingTime";
import { ToolbarIcon } from "./ToolbarIcon";
export function RecordingStatus({
  recording,
  elapsedSeconds,
  busy,
  onStop,
  paused = false,
  pauseBusy = false,
  onPause,
  onResume,
}: {
  recording: boolean;
  elapsedSeconds: number;
  busy: boolean;
  onStop: () => void;
  paused?: boolean;
  pauseBusy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
}) {
  const translate = useTranslation();

  if (!recording) return null;
  return (
    <div
      className="recording-status"
      data-paused={paused}
      role="group"
      aria-label={translate("녹화 조작")}
    >
      <span className="recording-dot" aria-hidden="true" />
      <span>{paused ? translate("녹화 일시 정지") : translate("녹화 중")}</span>
      <time aria-label={translate("녹화 경과 시간")}>
        {formatRecordingTime(elapsedSeconds)}
      </time>
      {onPause && onResume && (
        <button
          className="recording-pause"
          aria-label={
            paused ? translate("녹화 재개") : translate("녹화 일시 정지")
          }
          title={paused ? translate("녹화 재개") : translate("녹화 일시 정지")}
          disabled={busy || pauseBusy}
          onClick={paused ? onResume : onPause}
        >
          {paused ? "▶" : "Ⅱ"}
        </button>
      )}
      <button
        className="recording-stop"
        aria-label={translate("녹화 종료 및 저장")}
        title={translate("녹화 종료 및 저장")}
        disabled={busy}
        onClick={onStop}
      >
        <ToolbarIcon name="stop" />
        <span>{translate("종료")}</span>
      </button>
    </div>
  );
}
