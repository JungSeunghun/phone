import { test } from "node:test";
import assert from "node:assert/strict";
import { updateManifest } from "../application-update-release.mjs";
const entries = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"].map(
  (platform) => ({
    platform,
    name: platform + ".tar.gz",
    signature: "signed",
    version: "0.2.0",
  }),
);
test("updates include all targets and HTTPS asset URLs", () => {
  const manifest = updateManifest(
    "0.2.0",
    "https://example.org/releases/",
    entries,
  );
  assert.equal(manifest.version, "0.2.0");
  assert.equal(Object.keys(manifest.platforms).length, 3);
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://example.org/releases/darwin-aarch64.tar.gz",
  );
});
test("rejects missing, duplicate, unsigned, mismatched and insecure updates", () => {
  for (const value of [
    entries.slice(1),
    [...entries, entries[0]],
    entries.map((e) => ({ ...e, signature: "" })),
    entries.map((e) => ({ ...e, version: "0.1.0" })),
    entries.map((e) => ({ ...e, name: "../escape" })),
  ])
    assert.throws(() => updateManifest("0.2.0", "https://example.org/", value));
  for (const url of [
    "http://example.org/",
    "https://user:secret@example.org/",
    "https://example.org/#bad",
  ])
    assert.throws(() => updateManifest("0.2.0", url, entries));
});
test("filesystem update staging is repeatable and refuses changed artifacts", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { stageUpdate, prepareUpdates } =
    await import("../application-update-release.mjs");
  const root = await mkdtemp(join(tmpdir(), "mirror-update-"));
  try {
    const signature = await readFile(
      new URL(
        "../../src-tauri/tests/fixtures-updater-payload.txt.sig",
        import.meta.url,
      ),
      "utf8",
    );
    for (const target of ["macos-arm64", "macos-x64", "windows-x64"]) {
      const source = join(root, target);
      await mkdir(source);
      const file = join(
        source,
        target === "windows-x64" ? "setup.exe" : "Mirror.app.tar.gz",
      );
      await writeFile(file, "signed synthetic archive");
      await writeFile(file + ".sig", signature);
      const options = {
        version: "0.3.0",
        target,
        sourceDirectory: source,
        outputDirectory: join(root, "stages", target),
      };
      assert.equal(await stageUpdate(options), true);
      assert.equal(await stageUpdate(options), true);
      await writeFile(file, "changed archive");
      await assert.rejects(() => stageUpdate(options));
    }
    const options = {
      version: "0.3.0",
      sourceDirectory: join(root, "stages"),
      outputDirectory: join(root, "ready"),
      baseUrl: "https://example.org/releases/",
    };
    assert.equal((await prepareUpdates(options)).length, 7);
    assert.equal((await prepareUpdates(options)).length, 7);
    const entry = JSON.parse(
      await readFile(
        join(root, "stages", "macos-arm64", "update-manifest.json"),
        "utf8",
      ),
    );
    await writeFile(
      join(root, "stages", "macos-arm64", entry.name),
      "corrupted",
    );
    await assert.rejects(() => prepareUpdates(options));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
