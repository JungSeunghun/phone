import { useEffect, useState, useSyncExternalStore } from "react";
import type { ApplicationUpdateController } from "../application/ApplicationUpdateController";
export function ApplicationUpdatePanel({
  controller,
}: {
  controller: ApplicationUpdateController;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [endpoint, setEndpoint] = useState("");
  const working = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  useEffect(() => {
    void controller.initialize();
    const timer = setInterval(() => {
      void controller.tick();
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [controller]);
  return (
    <section aria-label="앱 업데이트">
      <h2>앱 업데이트</h2>
      <p>현재 버전 {state.version}</p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={state.automatic}
          onChange={(event) => controller.setAutomatic(event.target.checked)}
        />
        자동으로 새 버전 확인
      </label>
      <button
        disabled={working || state.phase === "unconfigured"}
        onClick={() => void controller.check()}
      >
        업데이트 확인
      </button>
      {state.phase === "available" && (
        <>
          <p>새 버전 {state.nextVersion}</p>
          <p className="hint">{state.notes}</p>
          <button onClick={() => void controller.install()}>
            업데이트하고 다시 시작
          </button>
        </>
      )}
      {state.phase === "downloading" && (
        <progress
          aria-label="업데이트 다운로드"
          max={100}
          value={state.percent}
        />
      )}
      {["checking", "downloading"].includes(state.phase) && (
        <button onClick={() => void controller.cancel()}>업데이트 취소</button>
      )}
      <p role="status" className="hint">
        {state.message}
      </p>
      <details>
        <summary>업데이트 배포 주소</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void controller.setEndpoint(endpoint);
          }}
        >
          <label>
            HTTPS 업데이트 주소
            <input
              type="url"
              placeholder={state.endpoint || "https://…/latest.json"}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              disabled={working}
            />
          </label>
          <button disabled={working || !endpoint.trim()}>주소 저장</button>
        </form>
        <p className="hint">
          Phone Mirror 서명 키로 서명된 업데이트만 설치합니다.
        </p>
      </details>
    </section>
  );
}
