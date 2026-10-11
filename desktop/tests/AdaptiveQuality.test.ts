import { it, expect } from "vitest";
import { AdaptiveQualityPolicy } from "../src/domain/AdaptiveQuality";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { FakeBackend } from "./fixtures";
const poor = { samples: 30, receiveJitterP95Ms: 160, decodeP95Ms: 5 };
const good = { samples: 30, receiveJitterP95Ms: 0, decodeP95Ms: 5 };
it("requires sustained pressure, ignores invalid and sparse input, and recovers slowly within cooldown bounds", () => {
  const policy = new AdaptiveQualityPolicy();
  expect(policy.observe(poor, 1000)).toBeUndefined();
  expect(policy.observe(poor, 2000)).toBeUndefined();
  expect(policy.observe(poor, 3000)).toBe(1);
  expect(policy.observe(poor, 3000)).toBeUndefined();
  expect(policy.observe({ ...poor, samples: 0 }, 18000)).toBeUndefined();
  expect(
    policy.observe({ ...poor, receiveJitterP95Ms: NaN }, 19000),
  ).toBeUndefined();
  for (let t = 20000; t <= 22000; t += 1000) policy.observe(poor, t);
  expect(policy.level).toBe(0);
  for (let t = 23000; t <= 61000; t += 1000) policy.observe(good, t);
  expect(policy.level).toBeGreaterThan(0);
  expect(policy.level).toBeLessThanOrEqual(2);
});
it("changes Android Wi-Fi runtime quality without overwriting preferences or restarting recording/USB", async () => {
  const backend = new FakeBackend();
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  controller.selectDevice("wifi:A");
  await controller.start();
  controller.frameRendered(886, 1920);
  for (const t of [1000, 2000, 3000])
    await controller.observeAdaptiveQuality(poor, t, true);
  expect(backend.stopSession).not.toHaveBeenCalled();
  await controller.observeAdaptiveQuality(poor, 4000, false);
  expect(backend.stopSession).toHaveBeenCalledTimes(1);
  expect(
    backend.startSession.mock.calls.at(-1)![0].settings.videoMaxDimension,
  ).toBe(1280);
  expect(controller.getSnapshot().settings.videoMaxDimension).toBe(1920);
  await controller.stop();
  controller.selectDevice("usb:A");
  await controller.start();
  controller.frameRendered(886, 1920);
  const count = backend.stopSession.mock.calls.length;
  for (const t of [10000, 11000, 12000])
    await controller.observeAdaptiveQuality(poor, t, false);
  expect(backend.stopSession).toHaveBeenCalledTimes(count);
  await controller.stop();
});
it("separates source inactivity from transit jitter and resets interval data", async () => {
  const { VideoPerformance } = await import("../src/domain/VideoPerformance");
  const statistics = new VideoPerformance();
  for (let i = 0; i < 30; i++) statistics.received(i * 1_000_000, i * 1000, 0);
  expect(statistics.takeAdaptiveSample()).toEqual({
    samples: 29,
    receiveJitterP95Ms: 0,
    decodeP95Ms: 0,
  });
  expect(statistics.takeAdaptiveSample().samples).toBe(0);
  statistics.reset();
  statistics.received(0, 0, 0);
  statistics.received(16667, 200, 0);
  expect(statistics.takeAdaptiveSample().receiveJitterP95Ms).toBeGreaterThan(
    180,
  );
  statistics.reset();
  expect(statistics.takeAdaptiveSample().samples).toBe(0);
});
it("loads legacy or corrupt adaptive settings safely and saves explicit toggles", () => {
  for (const saved of [
    undefined,
    { adaptiveQuality: "bad" },
    { adaptiveQuality: false },
  ]) {
    const storage = {
      load: () => saved,
      save: (value: unknown) => {
        expect(value).toHaveProperty("adaptiveQuality", false);
      },
    };
    const controller = new PhoneMirrorController(new FakeBackend(), storage);
    expect(controller.getSnapshot().adaptiveQuality).toBe(
      saved?.adaptiveQuality === false ? false : true,
    );
    controller.setAdaptiveQuality(false);
    controller.dispose();
  }
});
it("ignores a delayed adaptive restart after explicit disconnect", async () => {
  const backend = new FakeBackend();
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  controller.selectDevice("wifi:A");
  await controller.start();
  controller.frameRendered(886, 1920);
  let finish!: () => void;
  backend.stopSession.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  await controller.observeAdaptiveQuality(poor, 1000, false);
  await controller.observeAdaptiveQuality(poor, 2000, false);
  const update = controller.observeAdaptiveQuality(poor, 3000, false);
  await controller.stop();
  finish();
  await update;
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  expect(controller.getActiveSessionId()).toBeUndefined();
});
it("keeps the current quality tier when toggled and never raises quality under continued pressure", async () => {
  const backend = new FakeBackend();
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  controller.selectDevice("wifi:A");
  await controller.start();
  controller.frameRendered(886, 1920);
  for (const t of [1000, 2000, 3000, 18000, 19000, 20000]) {
    controller.frameRendered(886, 1920);
    await controller.observeAdaptiveQuality(poor, t, false);
  }
  expect(
    backend.startSession.mock.calls.at(-1)![0].settings.videoMaxDimension,
  ).toBe(720);
  controller.setAdaptiveQuality(false);
  controller.setAdaptiveQuality(true);
  controller.frameRendered(886, 1920);
  const starts = backend.startSession.mock.calls.length;
  for (const t of [40000, 41000, 42000])
    await controller.observeAdaptiveQuality(poor, t, false);
  expect(backend.startSession.mock.calls.length).toBe(starts);
  await controller.stop();
});
