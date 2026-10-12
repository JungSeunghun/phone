import { useTranslation } from "./ApplicationLanguage";
import { useRef } from "react";
import { ToolbarIcon } from "./ToolbarIcon";

export function CaptureActions({
  live,
  busy,
  recording,
  recordBlocked = false,
  compact,
  onScreenshot,
  onRecord,
}: {
  live: boolean;
  busy: boolean;
  recording: boolean;
  recordBlocked?: boolean;
  compact: boolean;
  onScreenshot: () => void;
  onRecord: () => void;
}) {
  const translate = useTranslation();

  const menu = useRef<HTMLDetailsElement>(null);
  const close = (action: () => void) => {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    action();
  };
  const actions = (
    <div className="capture-actions">
      <button disabled={!live || busy} onClick={() => close(onScreenshot)}>
        <ToolbarIcon name="capture" /> {translate("스크린샷 저장")}{" "}
      </button>
      {!recording && (
        <button
          disabled={!live || busy || recordBlocked}
          onClick={() => close(onRecord)}
        >
          <ToolbarIcon name="record" /> {translate("화면 녹화")}{" "}
        </button>
      )}
    </div>
  );
  if (!compact) return <div className="capture-controls">{actions}</div>;
  return (
    <details
      className="capture-menu"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          close(() => {});
        }
      }}
    >
      <summary
        aria-label={translate("캡처 및 녹화")}
        title={translate("캡처 및 녹화")}
      >
        <ToolbarIcon name="capture" />
      </summary>
      {actions}
    </details>
  );
}
