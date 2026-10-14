import { useTranslation } from "./ApplicationLanguage";
import {
  useRef,
  useSyncExternalStore,
  useEffect,
  useMemo,
  type RefObject,
} from "react";
import { TextInputController } from "../application/TextInputController";
import type { ControlInput } from "../domain/PhoneInput";
import {
  physicalKeyboardInput,
  isPhoneLanguageShortcut,
} from "../domain/PhoneInput";
import type { PhoneKeyboardShortcutSource } from "../application/PhoneKeyboardShortcutSource";
import { TauriPhoneKeyboardShortcutSource } from "../infrastructure/TauriPhoneKeyboardShortcutSource";
import { usePhoneKeyboardShortcuts } from "./usePhoneKeyboardShortcuts";
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
export function ScreenTextInput({
  controller,
  inputRef,
  enabled,
  platform = "android",
  keyboardShortcutSource,
}: {
  controller: TextInputController;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
  platform?: "android" | "ios";
  keyboardShortcutSource?: PhoneKeyboardShortcutSource;
}) {
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const localField = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? localField;
  const source = useMemo(
    () => keyboardShortcutSource ?? new TauriPhoneKeyboardShortcutSource(),
    [keyboardShortcutSource],
  );
  const shortcuts = usePhoneKeyboardShortcuts(
    source,
    field,
    controller,
    enabled,
    platform,
  );
  const resettingForWindowBlur = useRef(false);
  const ownsFocus = () =>
    document.activeElement === field.current && document.hasFocus();
  const composing = useRef(false),
    cancelled = useRef(false),
    lastComposition = useRef<string | null>(null);
  const previewText = useRef("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const preview = (text: string) => {
    void controller.replaceComposingText(previewText.current, text);
    previewText.current = text;
  };
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clear = () => {
    clearTimeout(compositionTimer.current);
    clearTimeout(previewTimer.current);
    previewText.current = "";
    composing.current = false;
    cancelled.current = true;
    lastComposition.current = null;
    if (field.current) field.current.value = "";
  };
  useEffect(() => {
    const cancel = () => {
      resettingForWindowBlur.current = true;
      clear();
      controller.reset();
      resettingForWindowBlur.current = false;
    };
    const unsubscribe = controller.subscribe(() => {
      if (
        controller.getSnapshot().message === "" &&
        !controller.getSnapshot().clipboardBusy
      ) {
        clear();
        if (!resettingForWindowBlur.current) shortcuts.blur();
      }
    });
    window.addEventListener("blur", cancel);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", cancel);
      clearTimeout(compositionTimer.current);
      clearTimeout(previewTimer.current);
    };
  }, [controller, shortcuts.blur]);
  useEffect(() => {
    if (!enabled) clear();
  }, [enabled]);
  return (
    <>
      <textarea
        ref={field}
        aria-label={translate("다국어 직접 입력")}
        className="screen-text-input"
        tabIndex={-1}
        rows={1}
        disabled={!enabled}
        readOnly={platform === "android"}
        aria-describedby="phone-text-input-help"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => {
          clear();
          cancelled.current = false;
          shortcuts.focus();
        }}
        onBlur={() => {
          shortcuts.blur();
          clear();
          controller.reset();
        }}
        onCompositionStart={() => {
          if (platform === "android") return;
          if (!enabled || !ownsFocus()) return;
          composing.current = true;
          cancelled.current = false;
          lastComposition.current = null;
          previewText.current = "";
        }}
        onCompositionEnd={(event) => {
          if (platform === "android") return;
          composing.current = false;
          if (!enabled || !ownsFocus() || cancelled.current) {
            event.currentTarget.value = "";
            return;
          }
          const text = event.currentTarget.value || event.data;
          clearTimeout(previewTimer.current);
          preview(text);
          previewText.current = "";
          lastComposition.current = text;
          clearTimeout(compositionTimer.current);
          compositionTimer.current = setTimeout(() => {
            if (lastComposition.current === text)
              lastComposition.current = null;
          }, 0);
          event.currentTarget.value = "";
        }}
        onInput={(event) => {
          if (platform === "android") return;
          const native = event.nativeEvent as InputEvent;
          if (!enabled || !ownsFocus() || cancelled.current) return;
          if (composing.current || native.isComposing) {
            const text = event.currentTarget.value;
            clearTimeout(previewTimer.current);
            // Keep the native marked text intact. Briefly coalesce rapid IME updates,
            // but show the last syllable even when no next key commits it.
            previewTimer.current = setTimeout(() => {
              if (enabled && ownsFocus() && !cancelled.current) preview(text);
            }, 60);
            return;
          }
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
          if (!enabled || !ownsFocus() || composing.current) return;
          lastComposition.current = null;
          void controller.commitText(event.clipboardData.getData("text/plain"));
          event.currentTarget.value = "";
        }}
        onKeyDown={(event) => {
          if (!enabled || !ownsFocus()) return;
          if (platform === "android") {
            if (isPhoneLanguageShortcut(event)) {
              if (!shortcuts.handlesShortcuts.current) {
                event.preventDefault();
                if (!event.repeat)
                  void controller.physicalKey({
                    kind: "keyboard",
                    usage: 44,
                    modifiers: 2,
                  });
              }
              return;
            }
            if (
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              !event.shiftKey &&
              event.key.toLowerCase() === "v"
            ) {
              event.preventDefault();
              if (!event.repeat) void controller.pasteClipboard();
              return;
            }
            const input = physicalKeyboardInput(event);
            if (input) {
              event.preventDefault();
              void controller.physicalKey(input);
            }
            return;
          }
          if (
            !enabled ||
            !ownsFocus() ||
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          if (
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "v"
          ) {
            event.preventDefault();
            if (!event.repeat) void controller.pasteClipboard();
            return;
          }
          cancelled.current = false;
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
        <span
          role="status"
          className={
            state.message === "폰에 입력을 전달했습니다."
              ? "sr-only"
              : "screen-text-status"
          }
        >
          {translate(state.message)}
        </span>
      )}
      <span className="sr-only" id="phone-text-input-help">
        {translate(
          platform === "ios"
            ? "폰에서 입력칸을 선택한 뒤 화면을 클릭해 입력하세요. ⌘V / Ctrl+V로 붙여넣을 수 있습니다."
            : "폰 화면의 입력칸을 클릭해 입력하세요. 한·영 전환은 Caps Lock / Ctrl+Space를 사용하세요. ⌘V / Ctrl+V로 붙여넣을 수 있습니다.",
        )}
      </span>
    </>
  );
}
