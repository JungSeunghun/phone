import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationLanguageController } from "../src/application/ApplicationLanguageController";
import { translate, englishMessages } from "../src/domain/ApplicationLanguage";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { FakeBackend } from "./fixtures";

describe("application language", () => {
  it.each([undefined, null, "", "ja", 12, {}, "EN"])(
    "defaults safely for invalid saved language %j",
    (value) => {
      const preferences = new ApplicationLanguageController({
        load: () => value,
        save: vi.fn(),
      });
      expect(preferences.getSnapshot().language).toBe("ko");
    },
  );
  it("handles corrupt storage, repeated selection, and failed saves", () => {
    const save = vi.fn(() => {
      throw new Error("disk unavailable");
    });
    const preferences = new ApplicationLanguageController({
      load: () => {
        throw new Error("corrupt");
      },
      save,
    });
    preferences.select("en");
    preferences.select("en");
    preferences.select("ja");
    expect(preferences.getSnapshot().language).toBe("en");
    expect(preferences.getSnapshot().saveFailed).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("restores both supported languages and persists a change", () => {
    let saved: unknown = "en";
    const storage = {
      load: () => saved,
      save: (value: string) => {
        saved = value;
      },
    };
    const preferences = new ApplicationLanguageController(storage);
    expect(preferences.getSnapshot().language).toBe("en");
    preferences.select("ko");
    expect(
      new ApplicationLanguageController(storage).getSnapshot().language,
    ).toBe("ko");
  });
  it("translates messages and parameters without interpreting device text", () => {
    expect(translate("en", "연결된 기기")).toBe("Connected devices");
    expect(translate("ko", "연결된 기기")).toBe("연결된 기기");
    expect(translate("en", "저장했습니다: /한글/영상.mp4")).toBe(
      "Saved: /한글/영상.mp4",
    );
    expect(translate("en", "unknown device name")).toBe("unknown device name");
    expect(
      Object.values(englishMessages).every((value) => value.trim().length > 0),
    ).toBe(true);
  });
  it("switches all panels immediately and preserves an active session and canvas", async () => {
    const backend = new FakeBackend();
    const controller = new PhoneMirrorController(backend);
    const language = new ApplicationLanguageController({
      load: () => "ko",
      save: vi.fn(),
    });
    await controller.refreshDevices();
    render(
      <PhoneMirrorApp controller={controller} languageController={language} />,
    );
    await userEvent.selectOptions(
      screen.getByLabelText("언어 / Language"),
      "en",
    );
    expect(document.documentElement.lang).toBe("en");
    expect(
      screen.getByRole("button", { name: "View phone screen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Android Wi-Fi connection")).toBeInTheDocument();
    expect(screen.getByText("App updates")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "View phone screen" }),
    );
    act(() => controller.frameRendered(886, 1920));
    const canvas = screen.getByLabelText("Phone video");
    await userEvent.click(
      screen.getByRole("button", { name: "Open settings" }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText("언어 / Language"),
      "ko",
    );
    expect(screen.getByLabelText("폰 영상")).toBe(canvas);
    expect(backend.startSession).toHaveBeenCalledTimes(1);
    expect(backend.stopSession).not.toHaveBeenCalled();
  });
});

it("uses the current language when a delayed save finishes after switching", async () => {
  const { ConnectionDiagnosticsController } =
    await import("../src/application/ConnectionDiagnosticsController");
  const { ConnectionDiagnosticsPanel } =
    await import("../src/presentation/ConnectionDiagnosticsPanel");
  const { ApplicationLanguageProvider } =
    await import("../src/presentation/ApplicationLanguage");
  const diagnostics = new ConnectionDiagnosticsController(
    {
      run: async () => ({ elapsedMilliseconds: 0, checks: [] }),
      cancel: async () => {},
    },
    () => "test",
  );
  const language = new ApplicationLanguageController({
    load: () => "en",
    save: vi.fn(),
  });
  let finish!: (value: boolean) => void;
  render(
    <ApplicationLanguageProvider controller={language}>
      <ConnectionDiagnosticsPanel
        controller={diagnostics}
        summaryStore={{
          save: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        }}
      />
    </ApplicationLanguageProvider>,
  );
  await act(() => diagnostics.run({ platform: "android", transport: "usb" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Save diagnostic summary" }),
  );
  act(() => language.select("ko"));
  await act(async () => {
    finish(true);
  });
  expect(screen.getByText("진단 요약을 저장했습니다.")).toBeInTheDocument();
});

it("preserves recording and reconnect settings through repeated language changes", async () => {
  const { MediaCaptureController } =
    await import("../src/application/MediaCaptureController");
  const backend = new FakeBackend();
  const controller = new PhoneMirrorController(backend);
  const stop = vi.fn(async () => new Blob(["video"]));
  const record = vi.fn(() => ({ stop }));
  const media = new MediaCaptureController(
    { screenshot: async () => new Blob(), record },
    { save: async () => "/saved" },
  );
  const language = new ApplicationLanguageController();
  await controller.refreshDevices();
  render(
    <PhoneMirrorApp
      controller={controller}
      mediaController={media}
      languageController={language}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => controller.frameRendered(320, 640));
  await userEvent.click(screen.getByRole("button", { name: "화면 녹화" }));
  for (const value of ["en", "ko", "en"] as const)
    act(() => language.select(value));
  expect(media.getSnapshot().recording).toBe(true);
  expect(controller.getSnapshot().autoReconnect).toBe(true);
  expect(
    screen.getByRole("button", { name: "Stop and save recording" }),
  ).toBeInTheDocument();
  expect(record).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
});
