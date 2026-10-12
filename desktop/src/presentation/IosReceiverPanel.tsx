import { useSyncExternalStore } from "react";
import { ConnectionCodeQr } from "./ConnectionCodeQr";
import type { IosReceiverController } from "../application/IosReceiverController";
export function IosReceiverPanel({
  controller,
  onStop,
  transport = "wifi",
}: {
  controller: IosReceiverController;
  transport?: "wifi" | "usb";
  onStop?: () => Promise<void>;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return (
    <details className="wireless-panel">
      <summary>
        {transport === "usb" ? "iPhone Windows USB 수신" : "iPhone Wi-Fi 수신"}
      </summary>
      <p className="hint">
        {transport === "usb"
          ? "Windows에 Apple 기기 드라이버를 설치하고 iPhone 한 대를 USB로 연결해 신뢰를 승인하세요. Phone Mirror Sender에서 USB 코드를 저장하고 화면 방송을 시작하세요. Wi-Fi는 필요하지 않습니다."
          : "같은 Wi-Fi에서 Phone Mirror Sender로 화면과 앱 소리를 송출하세요. 화질·프레임은 iPhone 앱에서 설정합니다."}
      </p>
      {state.phase === "listening" ? (
        <>
          <button
            onClick={() =>
              void (async () => {
                await onStop?.();
                await controller.stop();
              })()
            }
          >
            {transport === "usb" ? "iPhone USB 수신 종료" : "iPhone 수신 종료"}
          </button>
          {state.codes.map((code, index) => (
            <div key={code} className="connection-code-card">
              <ConnectionCodeQr code={code} index={index + 1} />
              <label>
                연결 코드 {index + 1}
                <input
                  aria-label={`iPhone ${transport === "usb" ? "USB " : ""}연결 코드 ${index + 1}`}
                  readOnly
                  value={code}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            </div>
          ))}
          <p className="hint">
            코드는 이번 수신에만 유효합니다. 송출 후 연결된 기기에서 iPhone을
            선택하세요.
          </p>
        </>
      ) : (
        <button
          disabled={state.phase === "starting"}
          onClick={() => void controller.start()}
        >
          {transport === "usb" ? "iPhone USB 수신 시작" : "iPhone 수신 시작"}
        </button>
      )}
      <p role="status" aria-live="polite">
        {state.message}
      </p>
    </details>
  );
}
