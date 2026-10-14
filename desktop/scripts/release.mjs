import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPrivateKey, randomUUID } from "node:crypto";
import {
  installerBundles,
  releaseVersion,
  validateVersions,
  releaseTarget,
  signingConfiguration,
  buildEnvironment,
} from "./release-policy.mjs";
import { stageArtifact, prepareArtifacts } from "./release-artifacts.mjs";
import { GitHubReleaseClient, uploadDraftRelease } from "./draft-release.mjs";
import { stageUpdate, prepareUpdates } from "./application-update-release.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const releaseRoot = join(root, "..", "dist", "Release");
async function versions() {
  try {
    const [packageText, lockText, tauriText, cargo, cargoLock] =
      await Promise.all(
        [
          "package.json",
          "package-lock.json",
          "src-tauri/tauri.conf.json",
          "src-tauri/Cargo.toml",
          "src-tauri/Cargo.lock",
        ].map((path) => readFile(join(root, path), "utf8")),
      );
    const packageConfiguration = JSON.parse(packageText),
      lock = JSON.parse(lockText),
      tauri = JSON.parse(tauriText);
    const cargoPackage = cargo.match(
      /^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
    )?.[1];
    const lockedPackage = cargoLock
      .split("[[package]]")
      .find((block) => /^name = "phone-mirror-desktop"$/m.test(block));
    return {
      package: packageConfiguration.version,
      packageLock: lock.version,
      packageLockRoot: lock.packages?.[""]?.version,
      tauri: tauri.version,
      cargo: cargoPackage?.match(/^version = "([^"]+)"$/m)?.[1],
      cargoLock: lockedPackage?.match(/^version = "([^"]+)"$/m)?.[1],
    };
  } catch {
    throw new Error("Could not read desktop release versions.");
  }
}
async function context(options) {
  const allVersions = await versions();
  const tag =
    options.tag ??
    (process.env.GITHUB_EVENT_NAME === "push" &&
    process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME
      : `desktop-v${allVersions.package}`);
  const release = validateVersions(tag, allVersions);
  const signingMode = process.env.DESKTOP_RELEASE_SIGNING ?? "unsigned";
  if (!["unsigned", "signed"].includes(signingMode))
    throw new Error("DESKTOP_RELEASE_SIGNING must be unsigned or signed.");
  return { ...release, signingMode };
}
async function signing(target, mode) {
  const configuration = signingConfiguration(target, mode, process.env);
  configuration.bundle.createUpdaterArtifacts = Boolean(
    process.env.TAURI_SIGNING_PRIVATE_KEY,
  );
  const directory = join(releaseRoot, "config");
  await mkdir(directory, { recursive: true });
  const configurationPath = join(directory, `${target}.json`);
  await writeFile(
    configurationPath,
    JSON.stringify(configuration, null, 2) + "\n",
  );
  if (mode === "signed" && releaseTarget(target).bundle === "dmg") {
    if (!process.env.RUNNER_TEMP)
      throw new Error(
        "Set RUNNER_TEMP to a private signing temporary directory.",
      );
    const key = Buffer.from(process.env.APPLE_API_PRIVATE_KEY_BASE64, "base64");
    try {
      createPrivateKey(key);
    } catch {
      throw new Error("Invalid Apple notarization private key.");
    }
    const keyPath = join(
      process.env.RUNNER_TEMP,
      `phone-mirror-notary-${randomUUID()}.p8`,
    );
    await writeFile(keyPath, key, { mode: 0o600, flag: "wx" });
    process.env.APPLE_API_KEY_PATH = keyPath;
  }
  return configurationPath;
}
async function main() {
  const command = process.argv[2];
  const { values: options } = parseArgs({
    args: process.argv.slice(3),
    options: {
      tag: { type: "string" },
      target: { type: "string" },
      source: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  const release = await context(options);
  if (command === "validate") {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `version=${release.version}\ntag=${release.tag}\nprerelease=${release.prerelease}\nsigning-mode=${release.signingMode}\n`,
      );
    console.log(`Validated ${release.tag} (${release.signingMode}).`);
    return;
  }
  if (command === "package") {
    const target = releaseTarget(options.target);
    const configurationPath = await signing(target.id, release.signingMode);
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        "build",
        "--target",
        target.target,
        "--bundles",
        installerBundles(
          target.id,
          Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
        ).join(","),
        "--config",
        configurationPath,
        "--ci",
      ],
      {
        cwd: root,
        env: buildEnvironment(target.id, release.signingMode, process.env),
        stdio: "inherit",
      },
    );
    console.log(
      `Built ${release.tag} for ${target.id}; run stage to prepare release assets.`,
    );
    return;
  }
  if (command === "stage") {
    const target = releaseTarget(options.target);
    const entry = await stageArtifact({
      version: release.version,
      target: target.id,
      signingMode: release.signingMode,
      sourceDirectory: options.source
        ? resolve(options.source)
        : join(
            root,
            "src-tauri",
            "target",
            target.target,
            "release",
            "bundle",
            target.bundle,
          ),
      outputDirectory: options.output
        ? resolve(options.output)
        : join(releaseRoot, "stages", target.id),
    });
    await stageUpdate({
      version: release.version,
      target: target.id,
      sourceDirectory: join(
        root,
        "src-tauri",
        "target",
        target.target,
        "release",
        "bundle",
      ),
      outputDirectory: options.output
        ? resolve(options.output)
        : join(releaseRoot, "stages", target.id),
    });
    console.log(`Staged ${entry.name} (${entry.size} bytes).`);
    return;
  }
  if (!["prepare", "upload-draft"].includes(command))
    throw new Error("Use validate, package, stage, prepare or upload-draft.");
  const commit =
    process.env.RELEASE_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const plan = await prepareArtifacts({
    ...release,
    commit,
    sourceDirectory: options.source
      ? resolve(options.source)
      : join(releaseRoot, "stages"),
    outputDirectory: options.output
      ? resolve(options.output)
      : join(releaseRoot, "ready"),
  });
  plan.artifacts.push(
    ...(await prepareUpdates({
      version: release.version,
      sourceDirectory: options.source
        ? resolve(options.source)
        : join(releaseRoot, "stages"),
      outputDirectory: options.output
        ? resolve(options.output)
        : join(releaseRoot, "ready"),
      baseUrl: process.env.DESKTOP_UPDATE_ASSET_BASE_URL,
    })),
  );
  if (plan.signingMode !== release.signingMode)
    throw new Error(
      "Staged signing mode differs from the release configuration.",
    );
  if (command === "prepare") {
    console.log(
      `Prepared ${plan.artifacts.length} local assets; no GitHub requests were made.`,
    );
    return;
  }
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "push" ||
    process.env.GITHUB_REF_TYPE !== "tag" ||
    process.env.GITHUB_REF_NAME !== plan.tag
  )
    throw new Error("Draft uploads require the matching tag-push workflow.");
  const result = await uploadDraftRelease(
    plan,
    new GitHubReleaseClient({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
    }),
  );
  console.log(
    `Draft release ${result.releaseId} prepared. Nothing was publicly published.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Release preparation failed.",
  );
  process.exitCode = 1;
});
