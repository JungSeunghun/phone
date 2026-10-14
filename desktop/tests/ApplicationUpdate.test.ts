import { describe, it, expect, vi } from "vitest";
import { ApplicationUpdateController } from "../src/application/ApplicationUpdateController";
const candidate = { version: "0.2.0", notes: "변경 사항" };
function fixture(configured = true) {
  const backend = {
    configuration: vi.fn(async () => ({
      version: "0.1.0",
      configured,
      endpoint: undefined as string | undefined,
    })),
    check: vi.fn(async () => candidate),
    install: vi.fn(async (_progress: (value: number) => void) => {}),
    cancel: vi.fn(async () => {}),
  };
  const storage = {
    getItem: vi.fn(() => null as string | null),
    setItem: vi.fn(),
  };
  let busy = false;
  const controller = new ApplicationUpdateController(
    backend,
    storage,
    () => busy,
    () => 0,
  );
  return {
    controller,
    backend,
    storage,
    setBusy: (value: boolean) => (busy = value),
  };
}
describe("application updates", () => {
  it("reports missing distribution", async () => {
    const f = fixture(false);
    await f.controller.initialize();
    await f.controller.check();
    expect(f.controller.getSnapshot().phase).toBe("unconfigured");
    expect(f.backend.check).not.toHaveBeenCalled();
  });
  it("checks automatically but installs only when requested and idle", async () => {
    const f = fixture();
    await f.controller.initialize();
    expect(f.controller.getSnapshot().phase).toBe("available");
    expect(f.backend.install).not.toHaveBeenCalled();
    f.setBusy(true);
    await f.controller.install();
    expect(f.backend.install).not.toHaveBeenCalled();
    f.setBusy(false);
    await f.controller.install();
    expect(f.backend.install).toHaveBeenCalledOnce();
  });
  it("loads disabled and corrupt preferences", async () => {
    const f = fixture();
    f.storage.getItem.mockReturnValue("false");
    await f.controller.initialize();
    expect(f.backend.check).not.toHaveBeenCalled();
    const g = fixture();
    g.storage.getItem.mockReturnValue("broken");
    await g.controller.initialize();
    expect(g.backend.check).toHaveBeenCalledOnce();
    g.controller.setAutomatic(false);
    expect(g.storage.setItem).toHaveBeenCalledWith(
      "phone-mirror-auto-update",
      "false",
    );
  });
  it("deduplicates and ignores callbacks after cancellation", async () => {
    const f = fixture();
    let resolve!: (value: typeof candidate) => void;
    f.backend.check.mockImplementation(() => new Promise((r) => (resolve = r)));
    const first = f.controller.initialize();
    await vi.waitFor(() => expect(f.backend.check).toHaveBeenCalled());
    await f.controller.check();
    expect(f.backend.check).toHaveBeenCalledOnce();
    await f.controller.cancel();
    resolve(candidate);
    await first;
    expect(f.controller.getSnapshot().phase).toBe("idle");
  });
  it("checks on 24 hour boundary and retries errors", async () => {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.tick(86_399_999);
    expect(f.backend.check).toHaveBeenCalledOnce();
    await f.controller.tick(86_400_000);
    expect(f.backend.check).toHaveBeenCalledTimes(2);
    f.backend.check.mockRejectedValueOnce(new Error("offline"));
    await f.controller.check();
    expect(f.controller.getSnapshot().message).toContain("offline");
    await f.controller.check();
    expect(f.controller.getSnapshot().phase).toBe("available");
  });
});
it("stops cancellation at the installation boundary and ignores invalid progress", async () => {
  const f = fixture();
  await f.controller.initialize();
  let finish!: () => void;
  f.backend.install.mockImplementation(
    (progress) =>
      new Promise((resolve) => {
        progress(NaN);
        finish = resolve;
      }),
  );
  const installation = f.controller.install();
  expect(f.controller.getSnapshot().percent).toBe(0);
  f.backend.cancel.mockImplementation(async () => false as never);
  await f.controller.cancel();
  expect(f.controller.getSnapshot().phase).toBe("installing");
  finish();
  await installation;
});
it("holds terminal check responses until cancellation is acknowledged", async () => {
  const f = fixture();
  let resolveCheck!: (value: typeof candidate) => void;
  let resolveCancel!: () => void;
  f.backend.check.mockImplementation(
    () => new Promise((resolve) => (resolveCheck = resolve)),
  );
  f.backend.cancel.mockImplementation(
    () => new Promise((resolve) => (resolveCancel = resolve)),
  );
  const checking = f.controller.initialize();
  await vi.waitFor(() => expect(f.backend.check).toHaveBeenCalledOnce());
  const cancelling = f.controller.cancel();
  const repeated = f.controller.cancel();
  resolveCheck(candidate);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.controller.getSnapshot().phase).toBe("checking");
  expect(f.backend.cancel).toHaveBeenCalledOnce();
  await f.controller.install();
  expect(f.backend.install).not.toHaveBeenCalled();
  resolveCancel();
  await Promise.all([checking, cancelling, repeated]);
  expect(f.controller.getSnapshot().phase).toBe("idle");
});
it("retains installation failure when cancellation arrives after install began", async () => {
  const f = fixture();
  await f.controller.initialize();
  let rejectInstall!: (error: Error) => void;
  let resolveCancel!: (value: never) => void;
  f.backend.install.mockImplementation(
    () => new Promise((_, reject) => (rejectInstall = reject)),
  );
  f.backend.cancel.mockImplementation(
    () => new Promise((resolve) => (resolveCancel = resolve)),
  );
  const installing = f.controller.install();
  const cancelling = f.controller.cancel();
  rejectInstall(new Error("install failed"));
  await Promise.resolve();
  await Promise.resolve();
  resolveCancel(false as never);
  await Promise.all([installing, cancelling]);
  expect(f.controller.getSnapshot().phase).toBe("error");
  expect(f.controller.getSnapshot().message).toContain("install failed");
});

it.each([
  "https://updates.example.org/latest.json",
  "https://github.com/JungSeunghun/phone/releases/latest/download/latest.json",
])("uses the official feed and preserves saved override %s", async (custom) => {
  const endpoint =
    "https://github.com/JungSeunghun/phone-mirror/releases/latest/download/latest.json";
  const f = fixture();
  f.backend.configuration.mockResolvedValue({
    version: "0.2.1",
    configured: true,
    endpoint,
  });
  await f.controller.initialize();
  expect(f.controller.getSnapshot().endpoint).toBe(endpoint);
  expect(f.backend.check).toHaveBeenCalledWith(endpoint);
  const g = fixture();
  g.storage.getItem.mockImplementation((key?: string) =>
    key === "phone-mirror-update-endpoint" ? custom : null,
  );
  g.backend.configuration.mockResolvedValue({
    version: "0.2.1",
    configured: true,
    endpoint,
  });
  await g.controller.initialize();
  expect(g.controller.getSnapshot().endpoint).toBe(custom);
  expect(g.backend.check).toHaveBeenCalledWith(custom);
});
