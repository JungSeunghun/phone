import { expect, test } from "@playwright/test";
test("sustains animated H264 playback with and without recording", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/tests/browser/layout.html");
  const metrics = await page.evaluate(async () => {
    const rendererModule = "/src/infrastructure/WebVideoRenderer.ts";
    const captureModule = "/src/infrastructure/CanvasMediaCapture.ts";
    const { WebVideoRenderer } = await import(
      /* @vite-ignore */ rendererModule
    );
    const { CanvasMediaCapture } = await import(
      /* @vite-ignore */ captureModule
    );
    const source = document.createElement("canvas");
    source.width = 1920;
    source.height = 886;
    const context = source.getContext("2d")!,
      errors: string[] = [];
    const chunks: { data: Uint8Array; timestamp: number; key: boolean }[] = [];
    const encoder = new VideoEncoder({
      output(chunk) {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({
          data,
          timestamp: chunk.timestamp,
          key: chunk.type === "key",
        });
      },
      error(error) {
        errors.push(error.message);
      },
    });
    encoder.configure({
      codec: "avc1.42002a",
      width: 1920,
      height: 886,
      framerate: 60,
      bitrate: 8000000,
      latencyMode: "realtime",
      avc: { format: "annexb" },
    });
    for (let i = 0; i < 180; i++) {
      context.fillStyle = `hsl(${i * 3},70%,30%)`;
      context.fillRect(0, 0, 1920, 886);
      context.fillStyle = "white";
      context.fillRect((i * 19) % 1800, 100, 100, 600);
      const frame = new VideoFrame(source, {
        timestamp: Math.round((i * 1000000) / 60),
      });
      encoder.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
      if (i % 8 === 7) await encoder.flush();
    }
    await encoder.flush();
    encoder.close();
    const first = chunks[0].data;
    let end = first.length;
    for (let i = 0; i + 4 < first.length; i++) {
      const len =
        first[i] === 0 && first[i + 1] === 0
          ? first[i + 2] === 1
            ? 3
            : first[i + 2] === 0 && first[i + 3] === 1
              ? 4
              : 0
          : 0;
      if (len && [1, 5].includes(first[i + len] & 31)) {
        end = i;
        break;
      }
    }
    function packet(bytes: Uint8Array, flags: bigint) {
      const data = new Uint8Array(12 + bytes.length),
        view = new DataView(data.buffer);
      view.setBigUint64(0, flags);
      view.setUint32(8, bytes.length);
      data.set(bytes, 12);
      return data.buffer;
    }
    const results = [];
    for (const recording of [false, true]) {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const times: number[] = [],
        queue: number[] = [],
        delays: number[] = [],
        sent = new Map<number, number>();
      let currentTimestamp = 0;
      const renderer = new WebVideoRenderer(
        canvas,
        () => {
          const now = performance.now();
          times.push(now);
          delays.push(now - (sent.get(currentTimestamp) ?? now));
        },
        (message: string) => errors.push(message),
      );
      renderer.write(packet(first.slice(0, end), 1n << 62n));
      const decoder = (renderer as unknown as { decoder: VideoDecoder })
          .decoder,
        ctx = canvas.getContext("2d")!,
        draw = ctx.drawImage.bind(ctx);
      ctx.drawImage = ((frame: VideoFrame, x: number, y: number) => {
        currentTimestamp = frame.timestamp;
        draw(frame, x, y);
      }) as typeof ctx.drawImage;
      let capture: { stop(): Promise<Blob> } | undefined;
      const started = performance.now();
      for (let i = 0; i < chunks.length; i++) {
        const wait = started + (i * 1000) / 60 - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const chunk = chunks[i];
        sent.set(chunk.timestamp, performance.now());
        renderer.write(
          packet(
            chunk.data,
            BigInt(chunk.timestamp) | (chunk.key ? 1n << 61n : 0n),
          ),
        );
        queue.push(decoder.decodeQueueSize);
        if (recording && i === 4)
          capture = new CanvasMediaCapture(canvas).record(() =>
            errors.push("Recording failed"),
          );
      }
      await decoder.flush();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const report = renderer.getPerformance();
      const output = capture ? await capture.stop() : undefined;
      const gaps = times
        .slice(1)
        .map((time, i) => time - times[i])
        .sort((a, b) => a - b);
      delays.sort((a, b) => a - b);
      results.push({
        recording,
        replaced: report.replaced,
        received: times.length,
        sent: chunks.length,
        fps: ((times.length - 1) * 1000) / (times.at(-1)! - times[0]),
        gapP95: gaps[Math.floor(gaps.length * 0.95)],
        gapMax: Math.max(...gaps),
        decodePaintP95: delays[Math.floor(delays.length * 0.95)],
        maxQueue: Math.max(...queue),
        recordedBytes: output?.size ?? 0,
      });
      renderer.close();
      canvas.remove();
    }
    return { results, errors };
  });
  console.log("VIDEO_PERFORMANCE", JSON.stringify(metrics));
  expect(metrics.errors).toEqual([]);
  for (const result of metrics.results) {
    expect(result.received + result.replaced).toBe(result.sent);
    expect(result.maxQueue).toBeLessThanOrEqual(12);
  }
  expect(metrics.results[1].recordedBytes).toBeGreaterThan(0);
});
