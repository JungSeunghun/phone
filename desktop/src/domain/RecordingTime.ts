export interface RecordingClock {
  now(): number;
  repeat(callback: () => void, milliseconds: number): () => void;
}
export function formatRecordingTime(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) return "00:00";
  seconds = Math.min(seconds, 359999);
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
