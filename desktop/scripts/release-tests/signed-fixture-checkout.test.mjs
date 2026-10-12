import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
test("Windows text checkout preserves the exact bytes of the signed payload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mirror-checkout-"));
  const path = "desktop/src-tauri/tests/fixtures-updater-payload.txt";
  const payload = await readFile(
    new URL(
      "../../src-tauri/tests/fixtures-updater-payload.txt",
      import.meta.url,
    ),
  );
  let attributes = "";
  try {
    attributes = await readFile(
      new URL("../../../.gitattributes", import.meta.url),
      "utf8",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const git = (args) =>
    execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    await mkdir(join(directory, "desktop/src-tauri/tests"), {
      recursive: true,
    });
    await writeFile(join(directory, path), payload);
    await writeFile(join(directory, ".gitattributes"), attributes);
    git(["init", "-q"]);
    git(["-c", "core.autocrlf=false", "add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    const checkout = join(directory, "windows") + "/";
    git([
      "-c",
      "core.autocrlf=true",
      "checkout-index",
      "--all",
      "--force",
      "--prefix=" + checkout,
    ]);
    assert.deepEqual(await readFile(join(checkout, path)), payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
