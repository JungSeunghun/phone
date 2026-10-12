import { useTranslation } from "./ApplicationLanguage";
import { useRef, useSyncExternalStore, useEffect } from "react";
import { TextInputController } from "../application/TextInputController";
import type { ControlInput } from "../domain/PhoneInput";
const editingKeys: Record<
  string,
  Extract<ControlInput, { kind: "key" }>["key"]
> = {
  Backspace: "backspace",
  Delete: "delete",
  Enter: "enter",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
export function TextInputPanel({
  controller,
  enabled,
  platform = "android",
}: {
  controller: TextInputController;
  enabled: boolean;
  platform?: "android" | "ios";
}) {
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const field = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false),
    cancelled = useRef(false),
    lastComposition = useRef<string | null>(null);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clear = () => {
    clearTimeout(compositionTimer.current);
    composing.current = false;
    cancelled.current = true;
    lastComposition.current = null;
    if (field.current) field.current.value = "";
  };
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => {
      if (
        controller.getSnapshot().message === "" &&
        !controller.getSnapshot().clipboardBusy
      )
        clear();
    });
    window.addEventListener("blur", clear);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", clear);
      clearTimeout(compositionTimer.current);
    };
  }, [controller]);
  useEffect(() => {
    if (!enabled) clear();
  }, [enabled]);
  return (
    <div
      className="text-input-panel"
      data-phone-text-input
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "v"
        ) {
          event.preventDefault();
          if (
            enabled &&
            !event.repeat &&
            !composing.current &&
            !event.nativeEvent.isComposing
          )
            void controller.pasteClipboard();
        }
      }}
    >
      <button
        type="button"
        disabled={!enabled || state.clipboardBusy}
        onClick={() => void controller.pasteClipboard()}
        title={translate("폰 영상에 포커스가 있을 때 ⌘V / Ctrl+V")}
      >
        {" "}
        {translate("폰에 붙여넣기")}{" "}
      </button>
      <textarea
        ref={field}
        aria-label={translate("다국어 직접 입력")}
        rows={1}
        disabled={!enabled}
        placeholder={translate("폰 입력칸을 선택한 뒤 여기서 입력")}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onBlur={clear}
        onCompositionStart={() => {
          composing.current = true;
          cancelled.current = false;
          lastComposition.current = null;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (!enabled || cancelled.current) {
            event.currentTarget.value = "";
            return;
          }
          const text = event.currentTarget.value || event.data;
          lastComposition.current = text;
          clearTimeout(compositionTimer.current);
          compositionTimer.current = setTimeout(() => {
            if (lastComposition.current === text)
              lastComposition.current = null;
          }, 0);
          event.currentTarget.value = "";
          if (text) void controller.commitText(text);
        }}
        onInput={(event) => {
          const native = event.nativeEvent as InputEvent;
          if (!enabled || composing.current || native.isComposing) return;
          const text = event.currentTarget.value;
          event.currentTarget.value = "";
          if (
            lastComposition.current !== null &&
            (native.inputType === "insertFromComposition" ||
              native.inputType === "insertCompositionText" ||
              text === lastComposition.current)
          ) {
            lastComposition.current = null;
            return;
          }
          lastComposition.current = null;
          if (text) void controller.commitText(text);
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (!enabled || composing.current) return;
          lastComposition.current = null;
          void controller.commitText(event.clipboardData.getData("text/plain"));
          event.currentTarget.value = "";
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          // A new physical key begins a new commit, even if its text matches the last composition.
          lastComposition.current = null;
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
            return;
          const key = editingKeys[event.key];
          if (key) {
            event.preventDefault();
            if (platform !== "ios" || !["up", "down"].includes(key))
              void controller.key(key);
          }
        }}
      />
      {state.message && (
        <span role="status" className="text-input-status">
          {translate(state.message)}
        </span>
      )}
      <span className="text-input-help">
        {platform === "ios"
          ? translate(
              "Phone Mirror 키보드 선택 시 전송 · 조합 확정 시 전송 · 위·아래 이동 제외",
            )
          : translate("Android 7 이상 · 조합 확정 시 전송 · 폰 클립보드 변경")}
      </span>
    </div>
  );
}
