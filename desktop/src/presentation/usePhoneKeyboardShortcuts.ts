import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { TextInputController } from "../application/TextInputController";
import type { PhoneKeyboardShortcutSource } from "../application/PhoneKeyboardShortcutSource";

let focusGeneration = Date.now() * 1000;
const nextGeneration = () =>
  (focusGeneration = Math.max(focusGeneration + 1, Date.now() * 1000));

export function usePhoneKeyboardShortcuts(
  source: PhoneKeyboardShortcutSource,
  field: RefObject<HTMLTextAreaElement | null>,
  controller: TextInputController,
  enabled: boolean,
  platform: "android" | "ios",
) {
  const handlesShortcuts = useRef(false);
  const generation = useRef(0);
  const setFocus = useCallback(
    (active: boolean) => {
      generation.current = nextGeneration();
      void source.setFocus(generation.current, active).catch(() => {
        handlesShortcuts.current = false;
      });
    },
    [source],
  );
  const blur = useCallback(() => setFocus(false), [setFocus]);
  const focus = useCallback(() => {
    if (handlesShortcuts.current && enabled && platform === "android")
      setFocus(true);
  }, [setFocus, enabled, platform]);
  useEffect(() => {
    if (!enabled || platform !== "android") {
      blur();
      return;
    }
    let alive = true;
    let dispose: (() => void) | undefined;
    void source
      .subscribe((eventGeneration) => {
        // The native source already restricts events to the foreground app. An OS
        // input-source popup may temporarily clear document.hasFocus(), while the
        // phone field remains the active element.
        if (
          alive &&
          handlesShortcuts.current &&
          eventGeneration === generation.current &&
          document.activeElement === field.current
        ) {
          void controller.physicalKey({
            kind: "keyboard",
            usage: 44,
            modifiers: 2,
          });
        }
      })
      .then((subscription) => {
        if (!alive) {
          subscription.dispose();
          return;
        }
        dispose = subscription.dispose;
        handlesShortcuts.current = subscription.handlesShortcuts;
        if (document.activeElement === field.current && document.hasFocus())
          focus();
      })
      .catch(() => {
        if (alive) handlesShortcuts.current = false;
      });
    return () => {
      alive = false;
      handlesShortcuts.current = false;
      blur();
      dispose?.();
    };
  }, [source, field, controller, enabled, platform, focus, blur]);
  return { handlesShortcuts, focus, blur };
}
