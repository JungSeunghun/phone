import { it, expect, vi } from "vitest";
import {
  mapPhonePosition,
  MouseInputController,
} from "../src/application/MouseInputController";
const rect = { left: 10, top: 20, width: 400, height: 400 };
it("maps letterboxing, exact borders and clamps captured drag outside the image", () => {
  expect(mapPhonePosition(10, 20, rect, 100, 200)).toBeNull();
  expect(mapPhonePosition(110, 20, rect, 100, 200)).toEqual({
    x: 0,
    y: 0,
    width: 100,
    height: 200,
  });
  expect(mapPhonePosition(310, 420, rect, 100, 200)).toEqual({
    x: 99,
    y: 199,
    width: 100,
    height: 200,
  });
  expect(mapPhonePosition(1000, -1, rect, 100, 200, true)).toEqual({
    x: 99,
    y: 0,
    width: 100,
    height: 200,
  });
  expect(mapPhonePosition(NaN, 0, rect, 100, 200)).toBeNull();
  expect(mapPhonePosition(1, 1, rect, 0, 1)).toBeNull();
});
it("orders down/move/up, ignores duplicate down and cancels a drag on blur", async () => {
  const send = vi.fn(async (_input: unknown) => {});
  const mouse = new MouseInputController(send);
  const position = { x: 1, y: 1, width: 2, height: 2 };
  mouse.move(position);
  mouse.down(position);
  mouse.down(position);
  mouse.move(position);
  mouse.up(position);
  await mouse.flush();
  expect(
    send.mock.calls.map((call) => (call[0] as { action: string }).action),
  ).toEqual(["down", "move", "up"]);
  mouse.down(position);
  mouse.cancel();
  await mouse.flush();
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ action: "cancel" });
});
it("reset drops pending old-session inputs and clamps wheel bounds", async () => {
  let complete!: (value: void) => void;
  const send = vi.fn(
    (_input: unknown) =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const mouse = new MouseInputController(send);
  const point = { x: 0, y: 0, width: 1, height: 1 };
  mouse.down(point);
  mouse.move(point);
  mouse.reset();
  complete();
  await Promise.resolve();
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  const wheel = vi.fn(async (_input: unknown) => {});
  const next = new MouseInputController(wheel);
  next.scroll(point, Infinity, 1);
  next.scroll(point, 100, -100);
  await next.flush();
  expect(wheel).toHaveBeenCalledTimes(1);
  expect(wheel.mock.calls[0][0]).toMatchObject({
    horizontal: 16,
    vertical: -16,
  });
});
