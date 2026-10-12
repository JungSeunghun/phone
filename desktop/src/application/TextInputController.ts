import { validatePhoneText, type ControlInput } from "../domain/PhoneInput";
export interface TextClipboard {
  readText(): Promise<string>;
}
export class TextInputController {
  private snapshot = { clipboardBusy: false, message: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(
    private session: () => string | undefined,
    private send: (input: ControlInput, session: string) => Promise<void>,
    private clipboard: TextClipboard,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  reset() {
    this.generation++;
    this.tail = Promise.resolve();
    this.pending = 0;
    this.update({ clipboardBusy: false, message: "" });
  }
  async pasteClipboard() {
    const session = this.session(),
      generation = this.generation;
    if (!session || this.snapshot.clipboardBusy) return;
    this.update({ clipboardBusy: true, message: "" });
    try {
      const text = await this.clipboard.readText();
      if (generation === this.generation && session === this.session())
        await this.commitText(text);
    } catch {
      if (generation === this.generation && session === this.session())
        this.update({
          message:
            "클립보드 텍스트를 읽을 수 없습니다. 복사한 내용을 확인하세요.",
        });
    } finally {
      if (generation === this.generation) this.update({ clipboardBusy: false });
    }
  }
  commitText(text: string) {
    const error = validatePhoneText(text);
    if (error) {
      this.update({ message: error });
      return Promise.resolve();
    }
    return this.enqueue({ kind: "paste", text });
  }
  key(key: Extract<ControlInput, { kind: "key" }>["key"]) {
    return this.enqueue({ kind: "key", key });
  }
  private enqueue(input: ControlInput) {
    const session = this.session(),
      generation = this.generation;
    if (!session) return Promise.resolve();
    if (this.pending >= 32) {
      this.update({
        message: "폰 입력이 밀려 있습니다. 잠시 후 다시 입력하세요.",
      });
      return Promise.resolve();
    }
    this.pending++;
    // Start the first operation immediately; subsequent commits preserve order.
    const send = async () => {
      try {
        if (generation !== this.generation || session !== this.session())
          return;
        await this.send(input, session);
        if (generation === this.generation && session === this.session())
          this.update({ message: "폰에 입력을 전달했습니다." });
      } catch {
        if (generation === this.generation && session === this.session()) {
          this.reset();
          this.update({
            message: "폰 입력에 실패했습니다. 연결과 폰의 입력칸을 확인하세요.",
          });
        }
      } finally {
        if (generation === this.generation) this.pending--;
      }
    };
    const operation = this.pending === 1 ? send() : this.tail.then(send);
    this.tail = operation;
    return operation;
  }
}
