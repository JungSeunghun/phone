import { it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MediaCaptureController } from "../src/application/MediaCaptureController";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { WindowPresentationController } from "../src/application/WindowPresentationController";
import { FakeBackend } from "./fixtures";
function fixture() {
  let now = 0,
    tick = () => {};
  const recording = {
    stop: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };
  const source = {
    screenshot: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    record: vi.fn(() => recording),
  };
  const store = {
    save: vi.fn(async (_blob: unknown): Promise<string | null> => "/saved"),
  };
  const controller = new MediaCaptureController(source, store, {
    now: () => now,
    repeat: (fn) => {
      tick = fn;
      return () => {
        tick = () => {};
      };
    },
  });
  controller.setLive(true);
  controller.startRecording();
  return {
    controller,
    source,
    store,
    recording,
    advance: (value: number) => {
      now = value;
      tick();
    },
  };
}
it("captures repeatedly while recording, preserves elapsed time and captures while paused", async () => {
  const f = fixture();
  f.advance(1100);
  await f.controller.screenshot();
  await f.controller.screenshot();
  expect(f.source.screenshot).toHaveBeenCalledTimes(2);
  expect(f.recording.stop).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({
    recording: true,
    elapsedSeconds: 1,
    busy: false,
  });
  await f.controller.pauseRecording();
  f.advance(5100);
  await f.controller.screenshot();
  expect(f.controller.getSnapshot()).toMatchObject({
    recording: true,
    paused: true,
    elapsedSeconds: 1,
  });
  expect(f.source.screenshot).toHaveBeenCalledTimes(3);
  await f.controller.finish();
});
it("serializes save dialogs while stopping immediately and keeps busy until both saves complete", async () => {
  const f = fixture();
  let finishShot!: (path: string | null) => void,
    finishVideo!: (path: string | null) => void;
  f.store.save
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finishShot = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finishVideo = r;
        }),
    );
  const shot = f.controller.screenshot();
  await Promise.resolve();
  expect(f.store.save).toHaveBeenCalledTimes(1);
  await f.controller.screenshot();
  expect(f.source.screenshot).toHaveBeenCalledTimes(1);
  const stop = f.controller.stopRecording();
  expect(f.recording.stop).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(f.store.save).toHaveBeenCalledTimes(1);
  finishShot(null);
  await shot;
  await Promise.resolve();
  expect(f.controller.getSnapshot().busy).toBe(true);
  expect(f.store.save).toHaveBeenCalledTimes(2);
  f.controller.startRecording();
  expect(f.source.record).toHaveBeenCalledTimes(1);
  finishVideo("/video.mp4");
  await stop;
  expect(f.controller.getSnapshot()).toMatchObject({
    recording: false,
    busy: false,
    message: "저장했습니다: /video.mp4",
  });
});
it("screenshot cancel, encoding and persistence failure do not stop recording", async () => {
  const f = fixture();
  f.store.save.mockResolvedValueOnce(null);
  await f.controller.screenshot();
  expect(f.controller.getSnapshot().screenshotMessage).toContain("취소");
  f.source.screenshot.mockRejectedValueOnce(Error("encode"));
  await f.controller.screenshot();
  expect(f.controller.getSnapshot().screenshotMessage).toContain("실패");
  f.store.save.mockRejectedValueOnce(Error("storage"));
  await f.controller.screenshot();
  expect(f.controller.getSnapshot()).toMatchObject({
    recording: true,
    busy: false,
  });
  expect(f.recording.stop).not.toHaveBeenCalled();
  await f.controller.screenshot();
  expect(f.controller.getSnapshot().screenshotMessage).toContain(
    "저장했습니다",
  );
  await f.controller.finish();
});
it("shutdown waits for capture encoding and save, finishes video once, and rejects new captures", async () => {
  const f = fixture();
  let encoded!: (blob: Blob) => void;
  f.source.screenshot.mockImplementationOnce(
    () =>
      new Promise((r) => {
        encoded = r;
      }),
  );
  const shot = f.controller.screenshot();
  const finish = f.controller.finish();
  await f.controller.screenshot();
  expect(f.source.screenshot).toHaveBeenCalledTimes(1);
  expect(f.recording.stop).toHaveBeenCalledTimes(1);
  encoded(new Blob(["png"], { type: "image/png" }));
  await Promise.all([shot, finish]);
  expect(f.store.save.mock.calls.map(([blob]) => (blob as Blob).type)).toEqual([
    "image/png",
    "video/mp4",
  ]);
  expect(f.controller.getSnapshot()).toMatchObject({
    busy: false,
    recording: false,
    live: false,
  });
});
for (const mode of ["normal", "fullscreen", "pip"] as const)
  it(`keeps capture enabled and result visible during recording in ${mode}`, async () => {
    const f = fixture();
    const mirror = new PhoneMirrorController(new FakeBackend());
    const presentation = new WindowPresentationController({
      setMode: async (value) => value,
    });
    await mirror.refreshDevices();
    await mirror.start();
    mirror.frameRendered(100, 200);
    render(
      <PhoneMirrorApp
        controller={mirror}
        mediaController={f.controller}
        windowPresentationController={presentation}
      />,
    );
    await act(async () => {
      await presentation.setMode(mode);
    });
    if (mode !== "normal")
      fireEvent.click(screen.getByLabelText("캡처 및 녹화"));
    const button = screen.getByRole("button", { name: "스크린샷 저장" });
    expect(button).toBeEnabled();
    let saved!: (path: string | null) => void;
    f.store.save.mockImplementationOnce(
      () =>
        new Promise((r) => {
          saved = r;
        }),
    );
    fireEvent.click(button);
    await waitFor(() => expect(f.store.save).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "녹화 종료 및 저장" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "녹화 일시 정지" }),
    ).toBeEnabled();
    await act(async () => {
      saved("/during-recording.png");
    });
    expect(
      screen.getByText("저장했습니다: /during-recording.png"),
    ).toBeVisible();
    expect(f.recording.stop).not.toHaveBeenCalled();
    await act(async () => {
      await f.controller.finish();
      await mirror.stop();
    });
  });

it("a late screenshot result cannot overwrite video finalization failure", async () => {
  const f = fixture();
  let encoded!: (blob: Blob) => void;
  f.source.screenshot.mockImplementationOnce(
    () =>
      new Promise((r) => {
        encoded = r;
      }),
  );
  f.recording.stop.mockRejectedValueOnce(Error("finalize"));
  const shot = f.controller.screenshot(),
    stop = f.controller.stopRecording();
  await Promise.resolve();
  encoded(new Blob(["png"], { type: "image/png" }));
  await Promise.all([shot, stop]);
  expect(f.controller.getSnapshot().message).toBe("녹화 저장에 실패했습니다.");
  expect(f.controller.getSnapshot().screenshotMessage).toContain(
    "저장했습니다",
  );
});

it("validates PNG size boundaries without interrupting the recording", async () => {
  const f = fixture();
  for (const size of [0, 1, 256 * 1024 * 1024, 256 * 1024 * 1024 + 1]) {
    const blob = new Blob(["png"], { type: "image/png" });
    // Simulated sizes avoid allocating hundreds of MiB just to check the policy.
    Object.defineProperty(blob, "size", { value: size });
    f.source.screenshot.mockResolvedValueOnce(blob);
    const before = f.store.save.mock.calls.length;
    await f.controller.screenshot();
    expect(f.store.save.mock.calls.length - before).toBe(
      size === 0 || size > 256 * 1024 * 1024 ? 0 : 1,
    );
    expect(f.controller.getSnapshot()).toMatchObject({
      recording: true,
      busy: false,
      screenshotBusy: false,
    });
  }
  expect(f.recording.stop).not.toHaveBeenCalled();
  await f.controller.finish();
});

it("recovers from a synchronous capture exception without leaving shutdown busy", async () => {
  const f = fixture();
  f.source.screenshot.mockImplementationOnce(() => {
    throw Error("capture unavailable");
  });
  await f.controller.screenshot();
  expect(f.controller.getSnapshot().recording).toBe(true);
  await f.controller.finish();
  expect(f.controller.getSnapshot().busy).toBe(false);
});
it("a synchronous recording finalization failure does not retain an old finalization task", async () => {
  const f = fixture();
  f.recording.stop.mockImplementationOnce(() => {
    throw Error("finalize unavailable");
  });
  await f.controller.stopRecording();
  f.controller.startRecording();
  await f.controller.stopRecording();
  expect(f.recording.stop).toHaveBeenCalledTimes(2);
  expect(f.controller.getSnapshot()).toMatchObject({
    recording: false,
    busy: false,
  });
});
