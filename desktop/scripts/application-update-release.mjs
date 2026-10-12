import { readdir, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { join, basename } from "node:path";
import { sha256 } from "./release-artifacts.mjs";
import { releaseVersion } from "./release-policy.mjs";
const platforms = {
  "macos-arm64": "darwin-aarch64",
  "macos-x64": "darwin-x86_64",
  "windows-x64": "windows-x86_64",
};
export function updateManifest(version, baseUrl, entries) {
  releaseVersion(`desktop-v${version}`);
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.hash ||
    base.search
  )
    throw Error("Update assets require a plain HTTPS base URL.");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  if (
    entries.length !== 3 ||
    new Set(entries.map((e) => e.platform)).size !== 3
  )
    throw Error("All three signed updater platforms are required.");
  const result = {
    version,
    notes: `Phone Mirror Desktop ${version}`,
    platforms: {},
  };
  for (const entry of entries) {
    if (
      !Object.values(platforms).includes(entry.platform) ||
      entry.version !== version ||
      !/^[A-Za-z0-9_.-]+$/.test(entry.name) ||
      !entry.signature.trim()
    )
      throw Error("Invalid signed updater artifact.");
    result.platforms[entry.platform] = {
      url: new URL(entry.name, base).href,
      signature: entry.signature,
    };
  }
  return result;
}
async function writeIdentical(path, bytes) {
  try {
    if (sha256(await readFile(path)) !== sha256(bytes))
      throw Error("Existing updater artifact has different content.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, bytes, { flag: "wx" });
  }
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw Error("Updater artifacts must not be symbolic links.");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
export async function stageUpdate({
  version,
  target,
  sourceDirectory,
  outputDirectory,
}) {
  releaseVersion(`desktop-v${version}`);
  if (!Object.hasOwn(platforms, target)) throw Error("Invalid updater target.");
  const extension = target === "windows-x64" ? ".exe" : ".app.tar.gz";
  const paths = await files(sourceDirectory);
  const candidates = paths.filter(
    (path) => path.endsWith(extension) && paths.includes(path + ".sig"),
  );
  if (candidates.length === 0) return false;
  if (candidates.length !== 1)
    throw Error("Expected one signed updater archive.");
  const path = candidates[0],
    info = await lstat(path);
  if (info.size < 1 || info.size > 512 * 1024 * 1024)
    throw Error("Invalid updater archive size.");
  const bytes = await readFile(path),
    signature = (await readFile(path + ".sig", "utf8")).trim();
  if (!signature) throw Error("Missing updater signature.");
  const name = `Phone-Mirror-Desktop_${version}_${target}_update${extension}`;
  await mkdir(outputDirectory, { recursive: true });
  await writeIdentical(join(outputDirectory, name), bytes);
  await writeIdentical(
    join(outputDirectory, name + ".sig"),
    Buffer.from(signature + "\n"),
  );
  await writeIdentical(
    join(outputDirectory, "update-manifest.json"),
    Buffer.from(
      JSON.stringify(
        {
          version,
          platform: platforms[target],
          name,
          signature,
          sha256: sha256(bytes),
        },
        null,
        2,
      ) + "\n",
    ),
  );
  return true;
}
export async function prepareUpdates({
  version,
  sourceDirectory,
  outputDirectory,
  baseUrl,
}) {
  const paths = await files(sourceDirectory),
    manifests = paths.filter(
      (path) => basename(path) === "update-manifest.json",
    );
  if (!manifests.length) return [];
  if (!baseUrl)
    throw Error(
      "Set DESKTOP_UPDATE_ASSET_BASE_URL for signed update releases.",
    );
  const entries = await Promise.all(
    manifests.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  const manifest = updateManifest(version, baseUrl, entries),
    artifacts = [];
  for (const entry of entries) {
    const candidates = paths.filter((path) => basename(path) === entry.name);
    if (candidates.length !== 1)
      throw Error("Missing or duplicate updater archive.");
    const bytes = await readFile(candidates[0]);
    if (sha256(bytes) !== entry.sha256)
      throw Error("Updater checksum mismatch.");
    for (const [name, value] of [
      [entry.name, bytes],
      [entry.name + ".sig", Buffer.from(entry.signature + "\n")],
    ])
      artifacts.push({ name, bytes: value, sha256: sha256(value) });
  }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  artifacts.push({ name: "latest.json", bytes, sha256: sha256(bytes) });
  await mkdir(outputDirectory, { recursive: true });
  for (const artifact of artifacts)
    await writeIdentical(join(outputDirectory, artifact.name), artifact.bytes);
  return artifacts;
}
