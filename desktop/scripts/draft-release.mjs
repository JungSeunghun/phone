import { releaseVersion } from "./release-policy.mjs";
import { sha256 } from "./release-artifacts.mjs";
function assertDraft(release, plan) {
  if (
    !release ||
    release.draft !== true ||
    release.tag_name !== plan.tag ||
    release.target_commitish !== plan.commit
  )
    throw new Error("Refusing to modify a published or mismatched release.");
}
export async function uploadDraftRelease(plan, client) {
  const parsed = releaseVersion(plan.tag);
  if (
    parsed.version !== plan.version ||
    parsed.prerelease !== plan.prerelease ||
    !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(plan.commit) ||
    !["unsigned", "signed"].includes(plan.signingMode) ||
    !Array.isArray(plan.artifacts) ||
    !plan.artifacts.length
  )
    throw new Error("Invalid release plan.");
  for (const artifact of plan.artifacts)
    if (
      !/^[A-Za-z0-9_.-]+$/.test(artifact.name) ||
      !artifact.bytes.length ||
      sha256(artifact.bytes) !== artifact.sha256
    )
      throw new Error("Invalid release upload artifact.");
  await client.verifyTag(plan.tag, plan.commit);
  let release = await client.findRelease(plan.tag);
  if (release) assertDraft(release, plan);
  else
    release = await client.createRelease({
      tag_name: plan.tag,
      target_commitish: plan.commit,
      name: `Phone Mirror Desktop ${plan.version}`,
      draft: true,
      prerelease: plan.prerelease,
      make_latest: "false",
      body: `Desktop installers (${plan.signingMode}).\n\nSource commit: ${plan.commit}\n\nDraft only: review before manually publishing. macOS 14+; Android requires Platform Tools. Windows iPhone USB requires Apple Devices; iPhone sender is distributed separately. Windows native execution and iPhone real-device validation are not established by this draft.\n\n${plan.signingMode === "unsigned" ? "Unsigned test packages: macOS uses ad-hoc signing without notarization; Windows has no publisher signature." : "Signed packages: macOS Developer ID/notarization and Windows Artifact Signing are verified by packaging jobs."}`,
    });
  assertDraft(release, plan);
  const existing = await client.listAssets(release.id);
  for (const artifact of plan.artifacts) {
    assertDraft(await client.getRelease(release.id), plan);
    const matches = existing.filter((asset) => asset.name === artifact.name);
    if (matches.length > 1)
      throw new Error("Duplicate release assets require review.");
    if (matches.length === 1) {
      if (
        matches[0].state !== "uploaded" ||
        matches[0].size !== artifact.bytes.length ||
        matches[0].digest !== "sha256:" + artifact.sha256
      )
        throw new Error(
          "Existing release asset differs or has no verifiable digest.",
        );
      continue;
    }
    const uploaded = await client.uploadAsset(release.id, artifact);
    if (
      uploaded.state !== "uploaded" ||
      uploaded.size !== artifact.bytes.length ||
      uploaded.digest !== "sha256:" + artifact.sha256
    )
      throw new Error("Uploaded release asset could not be verified.");
  }
  return { releaseId: release.id, draft: true };
}
export class GitHubReleaseClient {
  constructor({ repository, token, fetch = globalThis.fetch, signal }) {
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split("/").some((part) => part === "." || part === "..") ||
      typeof token !== "string" ||
      !token
    )
      throw new Error("Invalid GitHub release configuration.");
    this.repository = repository;
    this.token = token;
    this.fetch = fetch;
    this.signal = signal;
  }
  async request(path, { method = "GET", body, upload = false } = {}) {
    const signal = this.signal
      ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    let response;
    try {
      response = await this.fetch(
        `https://${upload ? "uploads" : "api"}.github.com/repos/${this.repository}/${path}`,
        {
          method,
          signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": upload
              ? "application/octet-stream"
              : "application/json",
          },
          body:
            body === undefined
              ? undefined
              : upload
                ? body
                : JSON.stringify(body),
        },
      );
    } catch {
      throw new Error("GitHub request failed or was cancelled.");
    }
    if (!response.ok)
      throw new Error(`GitHub request failed (HTTP ${response.status}).`);
    return response.json();
  }
  async pages(path) {
    const values = [];
    for (let page = 1; page <= 20; page++) {
      const response = await this.request(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(response))
        throw new Error("Invalid GitHub list response.");
      values.push(...response);
      if (response.length < 100) return values;
    }
    throw new Error("GitHub pagination limit reached.");
  }
  async verifyTag(tag, commit) {
    releaseVersion(tag);
    let reference = await this.request(
      `git/ref/tags/${encodeURIComponent(tag)}`,
    );
    for (let depth = 0; depth < 4; depth++) {
      if (reference.object?.type === "commit") {
        if (reference.object.sha !== commit)
          throw new Error("Remote tag does not match the built commit.");
        return;
      }
      if (
        reference.object?.type !== "tag" ||
        !/^[a-f0-9]{40}$/.test(reference.object.sha)
      )
        break;
      reference = await this.request(`git/tags/${reference.object.sha}`);
    }
    throw new Error("Invalid or unsupported remote release tag.");
  }
  async findRelease(tag) {
    const matches = (await this.pages("releases")).filter(
      (release) => release.tag_name === tag,
    );
    if (matches.length > 1)
      throw new Error("Multiple matching releases require review.");
    return matches[0];
  }
  createRelease(payload) {
    if (payload.draft !== true)
      throw new Error("Only draft creation is supported.");
    return this.request("releases", { method: "POST", body: payload });
  }
  getRelease(id) {
    return this.request(`releases/${Number(id)}`);
  }
  listAssets(id) {
    return this.pages(`releases/${Number(id)}/assets`);
  }
  uploadAsset(id, artifact) {
    return this.request(
      `releases/${Number(id)}/assets?name=${encodeURIComponent(artifact.name)}`,
      { method: "POST", body: artifact.bytes, upload: true },
    );
  }
}
