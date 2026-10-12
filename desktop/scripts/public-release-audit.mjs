import { execFileSync } from "node:child_process";
import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
export function publicReleaseFindings(path, bytes) {
  const reasons = new Set();
  if (
    /(^|\/)(\.env(?:\..*)?|[^/]+\.(?:p12|p8|key|mobileprovision))$/.test(
      path,
    ) &&
    !path.endsWith(".env.example")
  )
    reasons.add("credential-file");
  if (
    /\.(?:mp4|mov|mkv|h264|wav|aac|jpe?g|png)$/i.test(path) &&
    !path.startsWith("desktop/src-tauri/icons/")
  )
    reasons.add("media-provenance-required");
  if (bytes.length > 10 * 1024 * 1024) reasons.add("large-blob-review");
  else {
    const text = bytes.toString("utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
      reasons.add("private-key-marker");
    if (
      /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}/.test(
        text,
      )
    )
      reasons.add("credential-token");
    for (const candidate of text
      .split(/[\s"']+/)
      .filter((value) => /^[A-Za-z0-9+/=]{80,}$/.test(value))) {
      const decoded = Buffer.from(candidate, "base64").toString("utf8");
      if (/untrusted comment: minisign encrypted secret key/i.test(decoded))
        reasons.add("private-signing-key");
    }
  }
  return [...reasons].map((reason) => ({ path, reason }));
}
async function main() {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const git = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  const findings = [],
    seen = new Set();
  let workingFiles = 0,
    historyBlobs = 0;
  for (const path of git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString()
    .split("\0")
    .filter(Boolean)) {
    try {
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink()) {
        findings.push({
          scope: "working",
          path,
          reason: "symbolic-link-review",
        });
        continue;
      }
      if (!info.isFile()) continue;
      const bytes =
        info.size > 10 * 1024 * 1024
          ? Buffer.alloc(10 * 1024 * 1024 + 1)
          : await readFile(join(root, path));
      findings.push(
        ...publicReleaseFindings(path, bytes).map((finding) => ({
          ...finding,
          scope: "working",
        })),
      );
      workingFiles++;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const commit of git(["rev-list", "--all"])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)) {
    for (const record of git([
      "ls-tree",
      "-r",
      "--format=%(objectname) %(path)",
      "-z",
      commit,
    ])
      .toString()
      .split("\0")
      .filter(Boolean)) {
      const space = record.indexOf(" "),
        object = record.slice(0, space),
        path = record.slice(space + 1),
        identity = object + " " + path;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const size = Number(git(["cat-file", "-s", object]).toString());
      const bytes =
        size > 10 * 1024 * 1024
          ? Buffer.alloc(10 * 1024 * 1024 + 1)
          : git(["cat-file", "blob", object]);
      findings.push(
        ...publicReleaseFindings(path, bytes).map((finding) => ({
          ...finding,
          scope: "history",
        })),
      );
      historyBlobs++;
    }
  }
  const output = join(
    root,
    "desktop",
    "src-tauri",
    "target",
    "public-release-audit",
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        workingFiles,
        historyBlobs,
        findings,
        limitations:
          "Pattern-based review aid; not a guarantee that all secrets or identifying data are absent.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Public release audit: ${workingFiles} working files, ${historyBlobs} historical blobs, ${findings.length} findings. Details remain in ignored target output; no file contents are reported.`,
  );
  if (findings.length) process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      "Public release audit failed. No source contents were printed.",
    );
    process.exitCode = 1;
  });
