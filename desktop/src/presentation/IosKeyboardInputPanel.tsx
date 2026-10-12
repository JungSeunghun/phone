import { useTranslation } from "./ApplicationLanguage";
import { useSyncExternalStore } from "react";
import type { IosKeyboardInputController } from "../application/IosKeyboardInputController";
export function IosKeyboardInputPanel({
  controller,
  targetId,
}: {
  controller: IosKeyboardInputController;
  targetId: string;
}) {
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return (
    <details className="ios-keyboard-input">
      <summary>{translate("iPhone 다국어 입력 연결")}</summary>
      <p>
        {" "}
        {translate(
          "iPhone 송출 앱의 ‘컴퓨터 키보드 입력’에 코드를 저장하세요. 설정 → 일반 → 키보드에서 Phone Mirror 키보드를 추가하고 전체 접근 허용을 켠 뒤, 폰 입력칸에서 이 키보드를 선택하세요.",
        )}{" "}
      </p>
      {state.receiverId ? (
        <>
          {state.codes.map((code, index) => (
            <label key={code}>
              {" "}
              {translate("키보드 연결 코드")} {index + 1}
              <textarea
                aria-label={translate(`키보드 연결 코드 ${index + 1}`)}
                readOnly
                value={code}
                rows={2}
              />
            </label>
          ))}
          <button disabled={state.busy} onClick={() => void controller.stop()}>
            {" "}
            {translate("iPhone 키보드 연결 종료")}{" "}
          </button>
        </>
      ) : (
        <button
          disabled={state.busy || !targetId}
          onClick={() => void controller.start(targetId)}
        >
          {" "}
          {translate("iPhone 키보드 연결 시작")}{" "}
        </button>
      )}
      <p>
        {" "}
        {translate(
          "같은 로컬 네트워크가 필요합니다. 영상은 USB로 연결해도 됩니다. 비밀번호·전화번호 칸과 외부 키보드를 차단한 앱은 지원하지 않습니다. 폰 클립보드는 변경하지 않습니다.",
        )}{" "}
      </p>
      {state.message && <p role="status">{translate(state.message)}</p>}
    </details>
  );
}
