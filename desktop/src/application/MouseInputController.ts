import type { ControlInput, PhonePosition } from "../domain/PhoneInput";
export function mapPhonePosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
  clamp = false,
): PhonePosition | null {
  if (
    ![
      clientX,
      clientY,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      width,
      height,
    ].every(Number.isFinite) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  const scale = Math.min(rect.width / width, rect.height / height),
    left = rect.left + (rect.width - width * scale) / 2,
    top = rect.top + (rect.height - height * scale) / 2;
  const x = (clientX - left) / scale,
    y = (clientY - top) / scale;
  if (!clamp && (x < 0 || y < 0 || x > width || y > height)) return null;
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(x))),
    y: Math.max(0, Math.min(height - 1, Math.floor(y))),
    width,
    height,
  };
}
export class MouseInputController {
  private position?: PhonePosition;
  private generation = 0;
  private queue: ControlInput[] = [];
  private worker?: Promise<void>;
  constructor(
    private send: (input: ControlInput) => Promise<void>,
    private onError: () => void = () => {},
  ) {}
  down(position: PhonePosition) {
    if (this.position) return;
    this.position = position;
    this.enqueue({ kind: "touch", action: "down", ...position });
  }
  move(position: PhonePosition) {
    if (!this.position) return;
    this.position = position;
    this.enqueue({ kind: "touch", action: "move", ...position });
  }
  up(position: PhonePosition) {
    if (!this.position) return;
    this.position = undefined;
    this.enqueue({ kind: "touch", action: "up", ...position });
  }
  cancel() {
    if (!this.position) return;
    const position = this.position;
    this.position = undefined;
    this.enqueue({ kind: "touch", action: "cancel", ...position });
  }
  back() {
    this.cancel();
    this.enqueue({ kind: "back" });
  }
  scroll(position: PhonePosition, horizontal: number, vertical: number) {
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return;
    this.enqueue({
      kind: "scroll",
      ...position,
      horizontal: Math.max(-16, Math.min(16, horizontal)),
      vertical: Math.max(-16, Math.min(16, vertical)),
    });
  }
  private enqueue(input: ControlInput) {
    if (this.queue.length >= 32) {
      this.queue = this.queue.filter(
        (value) => value.kind === "touch" && value.action !== "move",
      );
      if (input.kind === "touch" && input.action === "move") return;
      if (this.queue.length >= 32) return;
    }
    this.queue.push(input);
    if (!this.worker) this.worker = this.drain();
  }
  private async drain() {
    const token = this.generation;
    try {
      while (token === this.generation && this.queue.length) {
        await this.send(this.queue.shift()!);
      }
    } catch {
      if (token === this.generation) {
        this.queue = [];
        this.position = undefined;
        this.onError();
      }
    } finally {
      if (token === this.generation) this.worker = undefined;
    }
  }
  reset() {
    this.generation++;
    this.queue = [];
    this.position = undefined;
    this.worker = undefined;
  }
  async flush() {
    await this.worker;
  }
}
