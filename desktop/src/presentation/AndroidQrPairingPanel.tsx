import { useSyncExternalStore, useMemo } from "react";
import type { AndroidQrPairingController } from "../application/AndroidQrPairingController";
import { createAndroidPairingQr } from "../infrastructure/AndroidPairingQr";
export function AndroidQrPairingPanel({
  controller,
  disabled = false,
}: {
  controller: AndroidQrPairingController;
  disabled?: boolean;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const image = useMemo(() => {
    try {
      return state.payload ? createAndroidPairingQr(state.payload) : undefined;
    } catch {
      return undefined;
    }
  }, [state.payload]);
  return (
    <section aria-label="Android QR 페어링">
      <p className="hint">
        Android 11 이상: 같은 Wi-Fi에서 개발자 옵션 → 무선 디버깅 → QR 코드로
        기기 페어링을 여세요. 기본 카메라 앱 대신 이 스캐너를 사용하세요.
      </p>
      {["starting", "waiting", "cancelling", "cancelError"].includes(
        state.phase,
      ) ? (
        <button
          disabled={state.phase === "cancelling"}
          onClick={() => void controller.cancel()}
        >
          Android QR 페어링 취소
        </button>
      ) : (
        <button disabled={disabled} onClick={() => void controller.start()}>
          Android QR 페어링 시작
        </button>
      )}
      {image && (
        <figure className="connection-code-qr">
          <img
            src={image}
            width={256}
            height={256}
            alt="Android Wi-Fi 페어링 QR 코드"
          />
          <figcaption>
            스캔하면 해당 기기를 자동으로 페어링하고 연결합니다.
          </figcaption>
        </figure>
      )}
      {state.payload && !image && (
        <p>
          QR 표시 실패: 취소 후 새 QR을 만들거나 아래 페어링 코드를 사용하세요.
        </p>
      )}
      <p role="status" aria-live="polite">
        {state.message}
      </p>
    </section>
  );
}
