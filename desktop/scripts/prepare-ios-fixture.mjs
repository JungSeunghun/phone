import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.platform === "darwin") {
  const directory = fileURLToPath(
    new URL("../tests/generated/ios", import.meta.url),
  );
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--no-default-features",
      "--locked",
      "--test",
      "ios_tests",
      "native_synthetic_encoder_feeds_the_shared_mp4_pipeline",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PHONE_MIRROR_IOS_VERIFY_DIRECTORY: directory },
      stdio: "inherit",
    },
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
