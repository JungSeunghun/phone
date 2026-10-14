import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installerBundles,
  releaseVersion,
  validateVersions,
  signingConfiguration,
  releaseTargets,
  artifactName,
  validateInventory,
} from "../release-policy.mjs";
import { stageArtifact, prepareArtifacts } from "../release-artifacts.mjs";
const version = "0.1.0";
test("canonical tags and version boundaries reject shell input, leading zeros and unsupported releases", () => {
  for (const tag of [
    "desktop-v0.0.0",
    "desktop-v65535.65535.65535",
    "desktop-v0.1.0-beta.1",
    "desktop-v0.1.0-rc.9999",
  ])
    assert.ok(releaseVersion(tag));
  for (const tag of [
    "",
    "v0.1.0",
    "desktop-v01.1.0",
    "desktop-v65536.0.0",
    "desktop-v0.1.0-beta.0",
    "desktop-v0.1.0-beta.01",
    "desktop-v0.1.0+build",
    "desktop-v0.1.0\n",
    "desktop-v$(secret)",
  ])
    assert.throws(() => releaseVersion(tag));
  assert.equal(releaseVersion("desktop-v0.1.0-beta.1").prerelease, true);
  assert.equal(releaseVersion("desktop-v0.1.0").prerelease, false);
});
test("all application and lockfile versions must match the tag and corrupt or missing data fail closed", () => {
  const versions = {
    package: version,
    packageLock: version,
    packageLockRoot: version,
    tauri: version,
    cargo: version,
    cargoLock: version,
  };
  assert.equal(validateVersions("desktop-v0.1.0", versions).version, version);
  for (const field of Object.keys(versions)) {
    assert.throws(() =>
      validateVersions("desktop-v0.1.0", { ...versions, [field]: "0.1.1" }),
    );
    assert.throws(() =>
      validateVersions("desktop-v0.1.0", { ...versions, [field]: undefined }),
    );
  }
});
test("installers have explicit architecture names and unsigned versus signed configurations", () => {
  assert.equal(releaseTargets.length, 3);
  assert.equal(
    artifactName(version, "macos-arm64"),
    "Phone-Mirror-Desktop_0.1.0_macos-arm64.dmg",
  );
  assert.equal(
    artifactName(version, "windows-x64"),
    "Phone-Mirror-Desktop_0.1.0_windows-x64-setup.exe",
  );
  assert.throws(() => artifactName(version, "other"));
  assert.equal(
    signingConfiguration("macos-arm64", "unsigned", {}).bundle.macOS
      .signingIdentity,
    "-",
  );
  assert.equal(
    signingConfiguration("windows-x64", "unsigned", {}).bundle.windows
      .signCommand,
    null,
  );
  assert.throws(() => signingConfiguration("macos-arm64", "unexpected", {}));
  assert.throws(() => signingConfiguration("macos-arm64", "signed", {}));
  const apple = {
    APPLE_CERTIFICATE: "private-secret",
    APPLE_CERTIFICATE_PASSWORD: "secret",
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
    APPLE_API_ISSUER: "issuer",
    APPLE_API_KEY: "key",
    APPLE_API_PRIVATE_KEY_BASE64: "secret",
  };
  const configuration = signingConfiguration("macos-x64", "signed", apple);
  assert.ok(!JSON.stringify(configuration).includes("private-secret"));
  assert.equal(
    configuration.bundle.macOS.signingIdentity,
    apple.APPLE_SIGNING_IDENTITY,
  );
  const azure = {
    AZURE_CLIENT_ID: "id",
    AZURE_CLIENT_SECRET: "private-secret",
    AZURE_TENANT_ID: "tenant",
    WINDOWS_SIGNING_ENDPOINT: "https://wus2.codesigning.azure.net",
    WINDOWS_SIGNING_ACCOUNT: "account",
    WINDOWS_SIGNING_PROFILE: "profile",
  };
  const command = signingConfiguration("windows-x64", "signed", azure).bundle
    .windows.signCommand;
  assert.equal(command.cmd, "artifact-signing-cli");
  assert.ok(command.args.includes("%1"));
  assert.ok(!JSON.stringify(command).includes("private-secret"));
  assert.throws(() =>
    signingConfiguration("windows-x64", "signed", {
      ...azure,
      WINDOWS_SIGNING_ENDPOINT: "https://evil.example",
    }),
  );
});
test("inventory requires one bounded, canonical, checksum-bearing artifact for every platform", () => {
  const inventory = releaseTargets.map((target) => ({
    target: target.id,
    name: artifactName(version, target.id),
    size: 1,
    sha256: "a".repeat(64),
    signingMode: "unsigned",
  }));
  assert.equal(validateInventory(version, inventory).length, 3);
  for (const size of [0, -1, NaN, 1024 ** 3 + 1])
    assert.throws(() =>
      validateInventory(version, [
        { ...inventory[0], size },
        ...inventory.slice(1),
      ]),
    );
  assert.equal(
    validateInventory(version, [
      { ...inventory[0], size: 1024 ** 3 },
      ...inventory.slice(1),
    ]).length,
    3,
  );
  assert.throws(() => validateInventory(version, inventory.slice(1)));
  assert.throws(() =>
    validateInventory(version, [inventory[0], inventory[0], inventory[2]]),
  );
  assert.throws(() =>
    validateInventory(version, [
      { ...inventory[0], name: "../private.pem" },
      ...inventory.slice(1),
    ]),
  );
  assert.throws(() =>
    validateInventory(version, [
      { ...inventory[0], sha256: "bad" },
      ...inventory.slice(1),
    ]),
  );
  assert.throws(() =>
    validateInventory(version, [
      { ...inventory[0], signingMode: "signed" },
      ...inventory.slice(1),
    ]),
  );
});
test("filesystem staging and preparation detect missing, empty, duplicate or altered installers and repeated actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phone-release-test-"));
  try {
    const stages = join(directory, "stages");
    for (const target of releaseTargets) {
      const source = join(directory, target.id);
      await mkdir(source);
      await writeFile(
        join(
          source,
          target.id.endsWith("x64") && target.id.startsWith("windows")
            ? "setup.exe"
            : "setup.dmg",
        ),
        Buffer.from(target.id),
      );
      await stageArtifact({
        version,
        target: target.id,
        signingMode: "unsigned",
        sourceDirectory: source,
        outputDirectory: join(stages, target.id),
      });
    }
    const plan = await prepareArtifacts({
      version,
      tag: "desktop-v0.1.0",
      commit: "a".repeat(40),
      sourceDirectory: stages,
      outputDirectory: join(directory, "output"),
    });
    assert.equal(plan.artifacts.length, 5);
    assert.ok(plan.artifacts.some((asset) => asset.name === "SHA256SUMS.txt"));
    await prepareArtifacts({
      version,
      tag: "desktop-v0.1.0",
      commit: "a".repeat(40),
      sourceDirectory: stages,
      outputDirectory: join(directory, "output"),
    });
    await writeFile(
      join(stages, "macos-arm64", artifactName(version, "macos-arm64")),
      "altered",
    );
    await assert.rejects(() =>
      prepareArtifacts({
        version,
        tag: "desktop-v0.1.0",
        commit: "a".repeat(40),
        sourceDirectory: stages,
        outputDirectory: join(directory, "output"),
      }),
    );
    const bad = join(directory, "bad");
    await mkdir(bad);
    await assert.rejects(() =>
      stageArtifact({
        version,
        target: "macos-arm64",
        signingMode: "unsigned",
        sourceDirectory: bad,
        outputDirectory: join(directory, "bad-out"),
      }),
    );
    await writeFile(join(bad, "empty.dmg"), "");
    await assert.rejects(() =>
      stageArtifact({
        version,
        target: "macos-arm64",
        signingMode: "unsigned",
        sourceDirectory: bad,
        outputDirectory: join(directory, "bad-out"),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("workflow triggers only desktop tags, builds three installers, gates uploads and cannot publish releases", async () => {
  const { parse } = await import("yaml");
  const workflow = parse(
    await readFile(
      new URL(
        "../../../.github/workflows/desktop-release.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.on.push.tags, ["desktop-v*"]);
  assert.ok(workflow.on.workflow_dispatch);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(workflow.jobs.package.strategy.matrix.include.length, 3);
  assert.equal(workflow.jobs["release-draft"].permissions.contents, "write");
  assert.ok(workflow.jobs["release-draft"].needs.includes("package"));
  assert.match(workflow.jobs["release-draft"].if, /event_name == 'push'/);
  assert.match(workflow.jobs["release-draft"].if, /ref_type == 'tag'/);
  const allRuns = Object.values(workflow.jobs)
    .flatMap((job) => job.steps.map((step) => step.run ?? ""))
    .join("\n");
  assert.ok(!allRuns.includes("gh release create"));
  assert.ok(!allRuns.includes("--draft=false"));
  assert.match(allRuns, /upload-draft/);
  const configuration = JSON.parse(
    await readFile(
      new URL("../../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(configuration.bundle.targets, ["app", "dmg", "nsis"]);
  assert.equal(configuration.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(
    configuration.bundle.windows.webviewInstallMode.type,
    "downloadBootstrapper",
  );
});

test("CLI dry preparation stays local, rejects mismatched tags and refuses uploads outside tag workflows", async () => {
  const version = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ).version;
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const directory = await mkdtemp(join(tmpdir(), "phone-release-cli-"));
  try {
    for (const target of releaseTargets) {
      const source = join(directory, "source-" + target.id);
      await mkdir(source);
      await writeFile(join(source, "installer" + target.extension), target.id);
      await stageArtifact({
        version,
        target: target.id,
        signingMode: "unsigned",
        sourceDirectory: source,
        outputDirectory: join(directory, "stages", target.id),
      });
    }
    const script = new URL("../release.mjs", import.meta.url);
    const environment = {
      ...process.env,
      DESKTOP_RELEASE_SIGNING: "unsigned",
      GITHUB_ACTIONS: "false",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF_TYPE: "branch",
      RELEASE_COMMIT: "a".repeat(40),
      GITHUB_TOKEN: "unused-private-token",
    };
    const args = [
      fileURLToPath(script),
      "prepare",
      "--source",
      join(directory, "stages"),
      "--output",
      join(directory, "output"),
    ];
    assert.match(
      execFileSync(process.execPath, args, {
        env: environment,
        encoding: "utf8",
      }),
      /no GitHub requests/,
    );
    const blocked = [...args];
    blocked[1] = "upload-draft";
    assert.throws(
      () =>
        execFileSync(process.execPath, blocked, {
          env: environment,
          stdio: "pipe",
        }),
      (error) =>
        error.status !== 0 &&
        error.stderr.toString().includes("matching tag-push") &&
        !error.stderr.toString().includes("unused-private-token"),
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [fileURLToPath(script), "validate", "--tag", "desktop-v0.1.1"],
        { env: environment, stdio: "pipe" },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release output survives frontend dist cleanup and Mac verification reads the final DMG", async () => {
  const script = await readFile(
    new URL("../release.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    script,
    /const releaseRoot = join\(root, "\.\.", "dist", "Release"\)/,
  );
  const workflow = await readFile(
    new URL("../../../.github/workflows/desktop-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /hdiutil attach -readonly/);
  assert.match(workflow, /hdiutil detach/);
  assert.match(workflow, /path: dist\/Release\/stages/);
});

test("unsigned builds remove signing credentials, and signed builds expose only their platform credentials", async () => {
  const { buildEnvironment } = await import("../release-policy.mjs");
  const environment = {
    PATH: "tool-path",
    APPLE_CERTIFICATE: "private-apple",
    APPLE_API_PRIVATE_KEY_BASE64: "private-key",
    APPLE_API_KEY_PATH: "private-key-path",
    AZURE_CLIENT_SECRET: "private-azure",
  };
  const unsigned = buildEnvironment("macos-arm64", "unsigned", environment);
  assert.equal(unsigned.APPLE_CERTIFICATE, undefined);
  assert.equal(unsigned.AZURE_CLIENT_SECRET, undefined);
  assert.equal(unsigned.PATH, "tool-path");
  assert.equal(environment.APPLE_CERTIFICATE, "private-apple");
  const mac = buildEnvironment("macos-arm64", "signed", environment);
  assert.equal(mac.APPLE_CERTIFICATE, "private-apple");
  assert.equal(mac.APPLE_API_PRIVATE_KEY_BASE64, undefined);
  assert.equal(mac.AZURE_CLIENT_SECRET, undefined);
  const windows = buildEnvironment("windows-x64", "signed", environment);
  assert.equal(windows.AZURE_CLIENT_SECRET, "private-azure");
  assert.equal(windows.APPLE_CERTIFICATE, undefined);
});

test("Mac packaging requests an app archive alongside the DMG for signed updates", () => {
  for (const target of ["macos-arm64", "macos-x64"]) {
    assert.deepEqual(installerBundles(target, true), ["app", "dmg"]);
    assert.deepEqual(installerBundles(target, false), ["dmg"]);
  }
  assert.deepEqual(installerBundles("windows-x64", true), ["nsis"]);
  assert.deepEqual(installerBundles("windows-x64", false), ["nsis"]);
  assert.throws(() => installerBundles("unknown", true));
});
