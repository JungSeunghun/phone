import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
test("updater private keys are available only to installer packaging steps", async () => {
  const configuration = parse(
    await readFile(
      new URL(
        "../../../.github/workflows/desktop-release.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const job = configuration.jobs.package;
  assert.equal(job.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(job.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, undefined);
  const steps = job.steps.filter((step) => step.env?.TAURI_SIGNING_PRIVATE_KEY);
  assert.deepEqual(
    steps.map((step) => step.name),
    ["Build Mac installer", "Build Windows installer"],
  );
  for (const step of steps) {
    assert.match(step.run, /release\.mjs package/);
    assert.ok(step.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD);
  }
});
