import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReleaseFindings } from "../public-release-audit.mjs";
test("reports possible keys and media without including contents", () => {
  const key = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const findings = publicReleaseFindings("src/file.txt", Buffer.from(key));
  assert.equal(findings[0].reason, "private-key-marker");
  assert.ok(!JSON.stringify(findings).includes(key));
  assert.equal(
    publicReleaseFindings("capture.mp4", Buffer.from("video"))[0].reason,
    "media-provenance-required",
  );
  assert.equal(
    publicReleaseFindings("signing.key", Buffer.from("value"))[0].reason,
    "credential-file",
  );
});
test("allows public keys, signatures and icons but still scans source key strings", () => {
  assert.equal(
    publicReleaseFindings("updater.key.pub", Buffer.from("public")).length,
    0,
  );
  assert.equal(
    publicReleaseFindings("fixture.txt.sig", Buffer.from("signature")).length,
    0,
  );
  assert.equal(
    publicReleaseFindings(
      "desktop/src-tauri/icons/32x32.png",
      Buffer.from("icon"),
    ).length,
    0,
  );
  const token = "ghp_" + "a".repeat(36);
  assert.equal(
    publicReleaseFindings("source.ts", Buffer.from(token))[0].reason,
    "credential-token",
  );
});
