// Short synthetic sender/USB-daemon/recording verification. No Apple service or phone is opened.
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
if (process.platform !== "darwin") {
  console.log(
    "Swift synthetic sender verification requires macOS; Rust USB tests also run on Windows.",
  );
  process.exit(0);
}
const root = fileURLToPath(new URL("..", import.meta.url));
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r.stdout.trim();
}
run("cargo", [
  "build",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--locked",
  "--no-default-features",
  "--example",
  "ios_usb_mock_receiver",
]);
run("swift", ["build", "--package-path", "../ios", "--product", "SenderMock"]);
const senderDirectory = run("swift", [
  "build",
  "--package-path",
  "../ios",
  "--show-bin-path",
]);
const generated = join(root, "tests/generated/windows-usb");
mkdirSync(generated, { recursive: true });
const directory = mkdtempSync(join(generated, "short-"));
const code = join(directory, "connection-code.txt");
const children = [];
function launch(command, args) {
  let output = "";
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      status === 0 ? resolve(output) : reject(Error(output));
    });
  });
  void done.catch(() => {});
  return done;
}
try {
  const receiver = launch(
    join(root, "src-tauri/target/debug/examples/ios_usb_mock_receiver"),
    [directory],
  );
  const deadline = Date.now() + 3000;
  while (!existsSync(code) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(existsSync(code), "synthetic code not ready");
  const sender = launch(join(senderDirectory, "SenderMock"), [code]);
  console.log((await receiver).trim());
  console.log((await sender).trim());
  const file = join(directory, "synthetic-windows-usb.mp4");
  const info = JSON.parse(
    run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file]),
  );
  const video = info.streams.find((s) => s.codec_type === "video"),
    audio = info.streams.find((s) => s.codec_type === "audio");
  assert.equal(video.codec_name, "h264");
  assert.equal(audio.codec_name, "aac");
  assert.equal(Number(audio.sample_rate), 48000);
  assert.equal(audio.channels, 2);
  assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.001);
  run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  const pcm = join(directory, "decoded.pcm");
  run("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-map",
    "0:a:0",
    "-f",
    "s16le",
    pcm,
  ]);
  const bytes = readFileSync(pcm);
  const frames = bytes.length / 4;
  const rms = (start, end) => {
    let sum = 0,
      count = 0;
    for (
      let i = Math.floor(start * 48000);
      i < Math.min(frames, Math.floor(end * 48000));
      i++
    ) {
      const v = bytes.readInt16LE(i * 4);
      sum += v * v;
      count++;
    }
    return Math.sqrt(sum / count);
  };
  assert.ok(rms(0, 0.07) < 100);
  assert.ok(rms(0.165, 0.175) > 1000);
  const onset = Array.from({ length: 150 }, (_, i) => i).find(
    (ms) => rms(ms / 1000, (ms + 2) / 1000) > 1000,
  );
  assert.ok(onset !== undefined && Math.abs(onset - 100) <= 15);
  console.log(
    JSON.stringify({
      source: "simulated-usbmux-with-Swift-USB-listener",
      video: video.codec_name,
      audio: audio.codec_name,
      duration: Number(video.duration),
      toneOnsetMs: onset,
      artifactDirectory: directory,
    }),
  );
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  rmSync(code, { force: true });
}
