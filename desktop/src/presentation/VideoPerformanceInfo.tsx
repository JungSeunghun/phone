import type { VideoPerformanceSnapshot } from "../domain/VideoPerformance";
import { useTranslation } from "./ApplicationLanguage";

export function VideoPerformanceInfo({
  report,
  dimensions,
}: {
  report?: VideoPerformanceSnapshot;
  dimensions?: { width: number; height: number } | null;
}) {
  const translate = useTranslation();
  const milliseconds = (value?: number) => `${(value ?? 0).toFixed(1)} ms`;
  const rows = [
    ["해상도", dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"],
    ["표시 FPS", `${(report?.fps ?? 0).toFixed(1)} fps`],
    ["수신 프레임", String(report?.received ?? 0)],
    ["표시 프레임", String(report?.presented ?? 0)],
    ["최신 프레임 교체", String(report?.replaced ?? 0)],
    ["수신 간격 p95", milliseconds(report?.receiveGapP95Ms)],
    ["디코딩 p95", milliseconds(report?.decodeP95Ms)],
    ["그리기 p95", milliseconds(report?.paintP95Ms)],
    ["표시 간격 p95", milliseconds(report?.displayGapP95Ms)],
    ["표시 간격 최대", milliseconds(report?.displayGapMaxMs)],
    ["디코더 큐 최대", String(report?.maxDecodeQueue ?? 0)],
  ];
  return (
    <details className="performance-info" name="viewer-help">
      <summary>{translate("성능 정보")}</summary>
      <div className="performance-info-content">
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{translate(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p>
          {translate(
            "표시 FPS는 세션 평균이며 정지 화면에서는 낮아질 수 있습니다. 최근 최대 256개 표본, 캔버스 그리기 기준입니다.",
          )}
        </p>
      </div>
    </details>
  );
}
