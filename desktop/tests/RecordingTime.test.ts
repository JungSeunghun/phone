import { it, expect } from "vitest";
import { formatRecordingTime } from "../src/domain/RecordingTime";
it("formats minute/hour boundaries and rejects invalid values", () => {
  for (const [seconds, text] of [
    [0, "00:00"],
    [59, "00:59"],
    [60, "01:00"],
    [3599, "59:59"],
    [3600, "01:00:00"],
    [359999, "99:59:59"],
    [360000, "99:59:59"],
  ] as const)
    expect(formatRecordingTime(seconds)).toBe(text);
  for (const seconds of [-1, NaN, Infinity, 1.5])
    expect(formatRecordingTime(seconds)).toBe("00:00");
});
