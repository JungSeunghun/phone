import { VideoPerformance } from "../domain/VideoPerformance";
import type { VideoSink } from "../domain/PhoneMirror";
import {
  codecFromConfiguration,
  parseVideoPacket,
} from "../domain/VideoPacket";

/** Compressed Annex B stays binary; WebCodecs decodes directly into the canvas. */
export class WebVideoRenderer implements VideoSink {
  private statistics = new VideoPerformance();
  takeAdaptiveSample = () => this.statistics.takeAdaptiveSample();
  getPerformance = () => this.statistics.snapshot(performance.now());
  private pendingFrame?: VideoFrame;
  private animationFrame?: number;
  private discardPresentation() {
    if (this.animationFrame !== undefined)
      cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.pendingFrame?.close();
    this.pendingFrame = undefined;
  }
  private decoder?: VideoDecoder;
  private configuration?: Uint8Array;
  private generation = 0;
  private needsKeyFrame = true;
  constructor(
    private canvas: HTMLCanvasElement,
    private onFrame: (width: number, height: number) => void,
    private onError: (message: string) => void,
    private onReset: () => void = () => {},
  ) {}
  write(buffer: ArrayBuffer): void {
    const packet = parseVideoPacket(buffer);
    if (packet.kind === "configuration") {
      this.configuration = packet.data.slice();
      this.configure();
      return;
    }
    if (!this.decoder || !this.configuration)
      throw new Error("영상 설정이 도착하기 전에 프레임을 받았습니다.");
    this.statistics.received(
      packet.timestamp,
      performance.now(),
      this.decoder.decodeQueueSize,
    );
    if (this.decoder.decodeQueueSize > 12) this.configure();
    if (this.needsKeyFrame && !packet.keyFrame) return;
    let data = packet.data;
    if (packet.keyFrame) {
      data = new Uint8Array(this.configuration.length + packet.data.length);
      data.set(this.configuration);
      data.set(packet.data, this.configuration.length);
      this.needsKeyFrame = false;
    }
    this.statistics.submitted(packet.timestamp, performance.now());
    this.decoder!.decode(
      new EncodedVideoChunk({
        type: packet.keyFrame ? "key" : "delta",
        timestamp: packet.timestamp,
        data,
      }),
    );
  }
  private configure(): void {
    if (typeof VideoDecoder === "undefined")
      throw new Error(
        "영상 디코더가 없습니다. macOS와 Safari 또는 Windows WebView2를 업데이트하세요.",
      );
    if (this.decoder?.state !== "closed") this.decoder?.close();
    this.discardPresentation();
    this.statistics.resetDecoder();
    const token = ++this.generation;
    this.needsKeyFrame = true;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (token !== this.generation) return;
          if (
            !Number.isInteger(frame.displayWidth) ||
            !Number.isInteger(frame.displayHeight) ||
            frame.displayWidth < 1 ||
            frame.displayHeight < 1 ||
            frame.displayWidth > 8192 ||
            frame.displayHeight > 8192
          )
            throw new Error("잘못된 영상 크기입니다.");
          this.statistics.decoded(frame.timestamp, performance.now());
          if (this.pendingFrame) {
            this.pendingFrame.close();
            this.statistics.replaced();
          }
          this.pendingFrame = frame;
          if (this.animationFrame === undefined) {
            this.animationFrame = requestAnimationFrame(() => {
              if (token !== this.generation) return;
              this.animationFrame = undefined;
              const latest = this.pendingFrame;
              this.pendingFrame = undefined;
              if (!latest) return;
              try {
                const context = this.canvas.getContext("2d");
                if (!context)
                  throw new Error("영상 캔버스를 만들 수 없습니다.");
                if (
                  this.canvas.width !== latest.displayWidth ||
                  this.canvas.height !== latest.displayHeight
                ) {
                  this.canvas.width = latest.displayWidth;
                  this.canvas.height = latest.displayHeight;
                }
                const paintStarted = performance.now();
                context.drawImage(latest, 0, 0);
                this.statistics.presented(paintStarted, performance.now());
                this.onFrame(latest.displayWidth, latest.displayHeight);
              } catch {
                this.onError("영상 프레임을 표시할 수 없습니다.");
              } finally {
                latest.close();
              }
            });
          }
        } catch {
          this.onError("영상 프레임을 표시할 수 없습니다.");
        } finally {
          if (this.pendingFrame !== frame) frame.close();
        }
      },
      error: () => {
        if (token === this.generation)
          this.onError(
            "H.264 영상 디코딩에 실패했습니다. 화질을 낮추거나 시스템을 업데이트하세요.",
          );
      },
    });
    this.decoder.configure({
      codec: codecFromConfiguration(this.configuration!),
      optimizeForLatency: true,
      hardwareAcceleration: "no-preference",
    });
  }
  reset(): void {
    this.onReset();
    this.discardPresentation();
    this.statistics.reset();
    this.generation++;
    if (this.decoder?.state !== "closed") this.decoder?.close();
    this.decoder = undefined;
    this.configuration = undefined;
    this.needsKeyFrame = true;
    this.canvas
      .getContext("2d")
      ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  close(): void {
    this.reset();
  }
}
