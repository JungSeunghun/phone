import { useTranslation } from "./ApplicationLanguage";
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
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return (
    <details className="wireless-panel">
      <summary>
        {transport === "usb"
          ? translate("iPhone Windows USB 수신")
          : translate("iPhone Wi-Fi 수신")}
      </summary>
      <ol className="connection-steps">
        {(transport === "usb"
          ? [
              "Windows에 Apple 기기 드라이버를 설치하세요.",
              "iPhone 한 대를 USB로 연결하고 ‘이 컴퓨터를 신뢰’를 승인하세요.",
              "수신을 시작하고 Phone Mirror Sender에 USB 코드를 저장하세요.",
              "Phone Mirror Sender에서 화면 방송을 시작하세요.",
            ]
          : [
              "iPhone과 컴퓨터를 같은 Wi-Fi에 연결하세요.",
              "수신을 시작하고 Phone Mirror Sender에 연결 QR 또는 코드를 저장하세요.",
              "Phone Mirror Sender에서 화면 방송을 시작하세요.",
            ]
        ).map((step) => (
          <li key={step}>{translate(step)}</li>
        ))}
      </ol>
      <p className="hint">
        {transport === "usb" && (
          <>{translate("USB 수신에는 Wi-Fi가 필요하지 않습니다.")} </>
        )}
        {translate(
          "화면과 앱 소리를 받습니다. 화질과 프레임은 iPhone 송출 앱에서 설정하세요.",
        )}
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
            {transport === "usb"
              ? translate("iPhone USB 수신 종료")
              : translate("iPhone 수신 종료")}
          </button>
          {state.codes.map((code, index) => (
            <div key={code} className="connection-code-card">
              <ConnectionCodeQr code={code} index={index + 1} />
              <label>
                {" "}
                {translate("연결 코드")} {index + 1}
                <input
                  aria-label={translate(
                    `iPhone ${transport === "usb" ? "USB " : ""}연결 코드 ${index + 1}`,
                  )}
                  readOnly
                  value={code}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            </div>
          ))}
          <p className="hint">
            {" "}
            {translate(
              "코드는 이번 수신에만 유효합니다. 송출 후 연결된 기기에서 iPhone을 선택하세요.",
            )}{" "}
          </p>
        </>
      ) : state.phase === "stopError" || state.phase === "stopping" ? (
        <button
          disabled={state.phase === "stopping"}
          onClick={() => void controller.stop()}
        >
          {" "}
          {translate("수신 종료 다시 시도")}{" "}
        </button>
      ) : (
        <button
          disabled={state.phase === "starting"}
          onClick={() => void controller.start()}
        >
          {transport === "usb"
            ? translate("iPhone USB 수신 시작")
            : translate("iPhone 수신 시작")}
        </button>
      )}
      <p role="status" aria-live="polite">
        {translate(state.message)}
      </p>
    </details>
  );
}
