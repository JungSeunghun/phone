import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PhoneMirrorController } from "../application/PhoneMirrorController";
import {
  mapPhonePosition,
  MouseInputController,
} from "../application/MouseInputController";
import { WebAudioPlayer } from "../infrastructure/WebAudioPlayer";
export function usePhoneInteraction(controller: PhoneMirrorController) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const mouse = useMemo(
    () =>
      new MouseInputController(
        (input) => controller.sendControl(input),
        () =>
          controller.setInputMessage(
            "폰 입력에 실패했습니다. 연결을 확인하세요.",
          ),
      ),
    [controller],
  );
  useEffect(() => {
    const detach = controller.attachAudioSink(
      new WebAudioPlayer((message, status) =>
        controller.setAudioMessage(message, status),
      ),
    );
    const blur = () => mouse.cancel();
    window.addEventListener("blur", blur);
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().phase !== "live") mouse.reset();
    });
    return () => {
      mouse.reset();
      unsubscribe();
      window.removeEventListener("blur", blur);
      detach();
    };
  }, [controller, mouse]);
  const position = (
    event: {
      clientX: number;
      clientY: number;
      currentTarget: HTMLCanvasElement;
    },
    clamp = false,
  ) =>
    state.phase === "live" &&
    controller.getCapabilities().control &&
    state.dimensions
      ? mapPhonePosition(
          event.clientX,
          event.clientY,
          event.currentTarget.getBoundingClientRect(),
          state.dimensions.width,
          state.dimensions.height,
          clamp,
        )
      : null;
  return {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const point = position(event);
      if (point) {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        mouse.down(point);
      }
    },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = position(event, true);
      if (point) mouse.move(point);
    },
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = position(event, true);
      if (point) mouse.up(point);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => mouse.cancel(),
    onLostPointerCapture: () => mouse.cancel(),
    onContextMenu: (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (position(event)) mouse.back();
    },
    onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => {
      const point = position(event);
      if (point) {
        event.preventDefault();
        const unit =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
        mouse.scroll(
          point,
          (-event.deltaX * unit) / 100,
          (-event.deltaY * unit) / 100,
        );
      }
    },
  };
}
