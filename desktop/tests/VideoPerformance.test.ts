import { expect, it } from "vitest";
import { VideoPerformance } from "../src/domain/VideoPerformance";
it("measures stages with bounded samples and ignores invalid/backward times", () => {
  const stats = new VideoPerformance();
  stats.received(1, 100, 2);
  stats.decoded(1, 104);
  stats.presented(105, 106);
  stats.received(2, 116, 3);
  stats.decoded(2, 120);
  stats.presented(121, 122);
  const report = stats.snapshot(1100);
  expect(report.received).toBe(2);
  expect(report.presented).toBe(2);
  expect(report.decodeP95Ms).toBe(4);
  expect(report.paintP95Ms).toBe(1);
  expect(report.maxDecodeQueue).toBe(3);
  stats.received(3, NaN, Infinity);
  stats.decoded(2, 90);
  stats.presented(80, 70);
  expect(stats.snapshot(1100)).toEqual(report);
  for (let i = 0; i < 1000; i++) {
    stats.received(100 + i, 1200 + i, 1);
    stats.decoded(100 + i, 1201 + i);
    stats.presented(1202 + i, 1203 + i);
  }
  expect(stats.snapshot(3000).sampleCount).toBeLessThanOrEqual(256);
  stats.reset();
  expect(stats.snapshot(3000).received).toBe(0);
});
it("separates replaced display frames from compressed input drops and recovers timing", () => {
  const stats = new VideoPerformance();
  stats.received(1, 0, 1);
  stats.replaced();
  stats.resetDecoder();
  stats.decoded(1, 10);
  expect(stats.snapshot(1000).decodeP95Ms).toBe(0);
  expect(stats.snapshot(1000).replaced).toBe(1);
});
