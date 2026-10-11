import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  artifactName,
  releaseTarget,
  releaseVersion,
  validateInventory,
} from "./release-policy.mjs";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
async function boundedFile(path) {
  const information = await lstat(path);
  if (
    !information.isFile() ||
    information.size < 1 ||
    information.size > 1024 ** 3
  )
    throw new Error("Invalid installer file size or type.");
  return readFile(path);
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Release artifacts must not be symbolic links.");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
async function writeIdentical(path, bytes) {
  try {
    if (sha256(await readFile(path)) !== sha256(bytes))
      throw new Error("Existing release artifact has different content.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, bytes, { flag: "wx" });
  }
}
export async function stageArtifact({
  version,
  target,
  signingMode,
  sourceDirectory,
  outputDirectory,
}) {
  releaseVersion(`desktop-v${version}`);
  const configuration = releaseTarget(target);
  if (!["unsigned", "signed"].includes(signingMode))
    throw new Error("Invalid release signing mode.");
  const candidates = (await files(sourceDirectory)).filter((path) =>
    path.endsWith(configuration.extension),
  );
  if (candidates.length !== 1)
    throw new Error("Expected exactly one installer for the selected target.");
  const bytes = await boundedFile(candidates[0]);
  const entry = {
    target,
    name: artifactName(version, target),
    size: bytes.length,
    sha256: sha256(bytes),
    signingMode,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeIdentical(join(outputDirectory, entry.name), bytes);
  await writeIdentical(
    join(outputDirectory, "artifact-manifest.json"),
    Buffer.from(JSON.stringify(entry, null, 2) + "\n"),
  );
  return entry;
}
export async function prepareArtifacts({
  version,
  tag,
  commit,
  sourceDirectory,
  outputDirectory,
}) {
  const release = releaseVersion(tag);
  if (
    release.version !== version ||
    !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)
  )
    throw new Error("Invalid release source version or commit.");
  const manifests = (await files(sourceDirectory)).filter(
    (path) =>
      path.endsWith("/artifact-manifest.json") ||
      path.endsWith("\\artifact-manifest.json"),
  );
  const entries = await Promise.all(
    manifests.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  const inventory = validateInventory(version, entries);
  const paths = await files(sourceDirectory);
  const artifacts = [];
  for (const entry of inventory) {
    const candidates = paths.filter(
      (path) =>
        path.endsWith("/" + entry.name) || path.endsWith("\\" + entry.name),
    );
    if (candidates.length !== 1)
      throw new Error("Missing or duplicated staged installer.");
    const bytes = await boundedFile(candidates[0]);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
      throw new Error("Staged installer checksum mismatch.");
    artifacts.push({ name: entry.name, bytes, sha256: entry.sha256 });
  }
  const manifest = {
    schemaVersion: 1,
    tag,
    version,
    commit,
    signingMode: inventory[0].signingMode,
    artifacts: inventory,
  };
  for (const [name, bytes] of [
    [
      "SHA256SUMS.txt",
      Buffer.from(
        inventory.map((entry) => `${entry.sha256}  ${entry.name}\n`).join(""),
      ),
    ],
    [
      "release-manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    ],
  ])
    artifacts.push({ name, bytes, sha256: sha256(bytes) });
  await mkdir(outputDirectory, { recursive: true });
  for (const artifact of artifacts)
    await writeIdentical(join(outputDirectory, artifact.name), artifact.bytes);
  return { ...release, commit, signingMode: manifest.signingMode, artifacts };
}
