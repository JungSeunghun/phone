import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { uploadDraftRelease, GitHubReleaseClient } from "../draft-release.mjs";
const tag = "desktop-v0.1.0",
  commit = "a".repeat(40);
const bytes = Buffer.from("artifact");
const asset = {
  name: "SHA256SUMS.txt",
  bytes,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const plan = {
  tag,
  commit,
  version: "0.1.0",
  prerelease: false,
  signingMode: "unsigned",
  artifacts: [asset],
};
function mock() {
  const calls = [];
  let release;
  const assets = [];
  return {
    calls,
    assets,
    setRelease(value) {
      release = value;
    },
    get release() {
      return release;
    },
    async verifyTag(t, c) {
      calls.push(["verifyTag", t, c]);
    },
    async findRelease() {
      calls.push(["find"]);
      return release;
    },
    async createRelease(payload) {
      calls.push(["create", payload]);
      release = { id: 1, ...payload };
      return release;
    },
    async getRelease() {
      calls.push(["get"]);
      return release;
    },
    async listAssets() {
      return assets;
    },
    async uploadAsset(_id, file) {
      calls.push(["upload", file.name]);
      const item = {
        name: file.name,
        digest: "sha256:" + file.sha256,
        state: "uploaded",
        size: file.bytes.length,
      };
      assets.push(item);
      return item;
    },
  };
}
test("creates only a draft and reruns leave identical assets untouched", async () => {
  const client = mock();
  await uploadDraftRelease(plan, client);
  assert.equal(client.release.draft, true);
  assert.equal(client.release.make_latest, "false");
  assert.equal(client.release.target_commitish, commit);
  assert.match(client.release.body, /unsigned/);
  await uploadDraftRelease(plan, client);
  assert.equal(
    client.calls.filter(([method]) => method === "create").length,
    1,
  );
  assert.equal(
    client.calls.filter(([method]) => method === "upload").length,
    1,
  );
});
test("published releases, mismatched commits or corrupted asset digests are never changed", async () => {
  for (const release of [
    { id: 1, draft: false, tag_name: tag, target_commitish: commit },
    { id: 1, draft: true, tag_name: tag, target_commitish: "b".repeat(40) },
  ]) {
    const client = mock();
    client.setRelease(release);
    await assert.rejects(() => uploadDraftRelease(plan, client));
    assert.ok(
      !client.calls.some(([method]) => ["create", "upload"].includes(method)),
    );
  }
  const client = mock();
  await uploadDraftRelease(plan, client);
  client.assets[0].digest = "sha256:" + "b".repeat(64);
  await assert.rejects(() => uploadDraftRelease(plan, client));
  assert.equal(
    client.calls.filter(([method]) => method === "upload").length,
    1,
  );
});
test("failures or external publication stop uploads and do not publish or delete anything", async () => {
  const client = mock();
  client.uploadAsset = async () => {
    throw new Error("simulated network failure");
  };
  await assert.rejects(() => uploadDraftRelease(plan, client));
  assert.equal(client.release.draft, true);
  const late = mock();
  late.getRelease = async () => ({ ...late.release, draft: false });
  await assert.rejects(() => uploadDraftRelease(plan, late));
  assert.ok(!late.calls.some(([method]) => method === "upload"));
  const wrong = mock();
  wrong.verifyTag = async () => {
    throw new Error("tag does not exist");
  };
  await assert.rejects(() => uploadDraftRelease(plan, wrong));
  assert.ok(!wrong.calls.some(([method]) => method === "create"));
});
test("GitHub adapter paginates drafts and resolves annotated tags before writing", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push([url, options]);
    const path = new URL(url).pathname;
    let data;
    if (path.endsWith("/git/ref/tags/" + tag))
      data = { object: { type: "tag", sha: "b".repeat(40) } };
    else if (path.endsWith("/git/tags/" + "b".repeat(40)))
      data = { object: { type: "commit", sha: commit } };
    else if (new URL(url).searchParams.get("page") === "1")
      data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        tag_name: "other-" + i,
        draft: true,
      }));
    else data = [{ id: 101, tag_name: tag, draft: true }];
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const client = new GitHubReleaseClient({
    repository: "owner/repo",
    token: "mock-token",
    fetch,
  });
  await client.verifyTag(tag, commit);
  assert.equal((await client.findRelease(tag)).id, 101);
  assert.ok(calls.every(([, options]) => options.method === "GET"));
  assert.throws(
    () =>
      new GitHubReleaseClient({
        repository: "../evil",
        token: "mock-token",
        fetch,
      }),
  );
});
test("API errors and aborts remain bounded and never expose authentication or server body", async () => {
  const client = new GitHubReleaseClient({
    repository: "owner/repo",
    token: "private-token",
    fetch: async () => new Response("private-token secret", { status: 403 }),
  });
  await assert.rejects(
    () => client.findRelease(tag),
    (error) =>
      !error.message.includes("private-token") &&
      !error.message.includes("secret"),
  );
  const cancelled = new AbortController();
  cancelled.abort();
  const aborted = new GitHubReleaseClient({
    repository: "owner/repo",
    token: "mock",
    signal: cancelled.signal,
    fetch: async (_url, options) => {
      options.signal.throwIfAborted();
    },
  });
  await assert.rejects(() => aborted.findRelease(tag));
});
