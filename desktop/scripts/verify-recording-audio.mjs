// Short synthetic AV verification only. Never captures a phone or desktop screen.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
if (process.platform !== "darwin") {
  console.log(
    "Synthetic VideoToolbox export verification requires macOS; shared muxer/AAC tests run on both platforms.",
  );
  process.exit(0);
}
const usbFixture = process.argv.includes("--ios-usb");
const root = fileURLToPath(new URL("..", import.meta.url));
const generated = join(root, "tests/generated/audio-recording");
mkdirSync(generated, { recursive: true });
const directory = mkdtempSync(join(generated, "short-"));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}
run(
  "cargo",
  [
    "test",
    "--release",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "--no-default-features",
    "--test",
    usbFixture ? "ios_usb_audio_tests" : "recording_audio_tests",
    usbFixture ? "synthetic_usb_media" : "native_synthetic_video_and_audio",
  ],
  {
    ...process.env,
    [usbFixture
      ? "PHONE_MIRROR_USB_AUDIO_VERIFY_DIRECTORY"
      : "PHONE_MIRROR_AV_VERIFY_DIRECTORY"]: directory,
  },
);
const file = join(
  directory,
  usbFixture ? "synthetic-usb-av.mp4" : "synthetic-av.mp4",
);
const info = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ]),
);
const video = info.streams.find((stream) => stream.codec_type === "video"),
  audio = info.streams.find((stream) => stream.codec_type === "audio");
assert.equal(video.codec_name, "h264");
assert.equal(audio.codec_name, "aac");
assert.equal(Number(audio.sample_rate), 48000);
assert.equal(audio.channels, 2);
assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.001);
run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
const pcm = join(directory, "decoded.pcm");
run("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "s16le", pcm]);
const bytes = readFileSync(pcm);
const frames = bytes.length / 4;
const rms = (begin, end) => {
  let sum = 0;
  let count = 0;
  for (
    let sample = Math.floor(begin * 48000);
    sample < Math.min(frames, Math.floor(end * 48000));
    sample++
  ) {
    const value = bytes.readInt16LE(sample * 4);
    sum += value * value;
    count++;
  }
  return Math.sqrt(sum / count);
};
assert.ok(rms(0, 0.07) < 100);
assert.ok(rms(0.14, 0.22) > 1000);
const onset = Array.from({ length: 150 }, (_, index) => index).find(
  (ms) => rms(ms / 1000, (ms + 2) / 1000) > 1000,
);
assert.ok(onset !== undefined && Math.abs(onset - 100) <= 15);
console.log(
  JSON.stringify({
    source: usbFixture ? "synthetic-ios-usb-delegate" : "synthetic-av",
    video: video.codec_name,
    audio: audio.codec_name,
    duration: Number(video.duration),
    decodedFrames: frames,
    toneOnsetMs: onset,
    expectedOnsetMs: 100,
    artifactDirectory: directory,
  }),
);
