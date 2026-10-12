import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { FakeBackend } from "./fixtures";
it("displays embedded canvas, transport options and drives start/stop through the backend", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  expect(screen.getByLabelText("폰 영상")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("연결된 기기"), "wifi:A");
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "연결 종료" }));
  expect(backend.stopSession).toHaveBeenCalledTimes(1);
});

it("enables capture only after a real frame and drives screenshot and recording buttons", async () => {
  const { MediaCaptureController } =
    await import("../src/application/MediaCaptureController");
  const { vi } = await import("vitest");
  const { act } = await import("@testing-library/react");
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  const source = {
    screenshot: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    record: vi.fn(() => ({
      stop: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
    })),
  };
  const store = { save: vi.fn(async () => "/saved") };
  const media = new MediaCaptureController(source, store);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} mediaController={media} />);
  expect(screen.getByRole("button", { name: "스크린샷 저장" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => controller.frameRendered(886, 1920));
  await userEvent.click(screen.getByRole("button", { name: "스크린샷 저장" }));
  expect(store.save).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "화면 녹화" }));
  expect(source.record).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "연결 종료" }));
  expect(store.save).toHaveBeenCalledTimes(2);
});

it("keeps the same canvas and session while switching views, exits on Escape and disconnect", async () => {
  const { WindowPresentationController } =
    await import("../src/application/WindowPresentationController");
  const { vi } = await import("vitest");
  const { act } = await import("@testing-library/react");
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  const windowBackend = {
    setMode: vi.fn(async (mode: "normal" | "fullscreen" | "pip") => mode),
  };
  const presentation = new WindowPresentationController(windowBackend);
  await controller.refreshDevices();
  render(
    <PhoneMirrorApp
      controller={controller}
      windowPresentationController={presentation}
    />,
  );
  expect(screen.getByRole("button", { name: "전체 화면" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => controller.frameRendered(886, 1920));
  const canvas = screen.getByLabelText("폰 영상");
  await userEvent.click(screen.getByRole("button", { name: "전체 화면" }));
  expect(document.querySelector("main")).toHaveClass("view-fullscreen");
  await userEvent.keyboard("{Escape}");
  expect(document.querySelector("main")).toHaveClass("view-normal");
  await userEvent.click(screen.getByRole("button", { name: "PiP" }));
  expect(document.querySelector("main")).toHaveClass("view-pip");
  expect(screen.getByLabelText("폰 영상")).toBe(canvas);
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  expect(backend.stopSession).not.toHaveBeenCalled();
  await act(async () => {
    await controller.stop();
  });
  expect(document.querySelector("main")).toHaveClass("view-normal");
});

it("hides the redundant play action and keeps a reachable settings toggle during video", async () => {
  const { act } = await import("@testing-library/react");
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => {
    controller.frameRendered(886, 1920);
    controller.setAudioMessage("컴퓨터에서 폰 소리 재생 중", "playing");
  });
  expect(
    screen.queryByRole("button", { name: "소리 재생" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "설정 열기" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await userEvent.click(screen.getByRole("button", { name: "설정 열기" }));
  expect(screen.getByRole("button", { name: "설정 닫기" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await userEvent.click(screen.getByRole("button", { name: "연결 종료" }));
  expect(screen.getByRole("button", { name: "소리 재생" })).toBeDisabled();
});

it("presents iPhone USB trust instructions and disables unsupported controls while keeping capture and views", async () => {
  const { act } = await import("@testing-library/react");
  const backend = new FakeBackend();
  backend.devices = [
    {
      ...backend.devices[0],
      identity: "ios:phone",
      id: "usb:ios:phone",
      name: "iPhone",
      platform: "ios",
    },
  ];
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  expect(screen.getByText(/이 컴퓨터를 신뢰/)).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "연결 중 폰 화면 켜두기" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => controller.frameRendered(320, 640));
  expect(screen.getByText("iPhone · 보기 전용")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "소리 재생" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "스크린샷 저장" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "화면 녹화" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "전체 화면" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "PiP" })).toBeEnabled();
  await act(async () => controller.stop());
});

it("presents Windows USB sender instructions and leaves sender video settings on the phone", async () => {
  const { usbDevice } = await import("./fixtures");
  const backend = new FakeBackend();
  backend.devices = [
    {
      ...usbDevice,
      id: "usb:ios-usb:mock",
      identity: "ios-usb:mock",
      name: "USB iPhone",
      platform: "ios",
      capabilities: { audio: true, control: false, keepScreenAwake: false },
    },
  ];
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  expect(
    screen.getByText(/USB 송출 앱에서 화면 방송을 시작하세요/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("화질")).toBeDisabled();
  expect(screen.getByLabelText("프레임")).toBeDisabled();
  expect(
    screen.getByText(/화질과 프레임은 iPhone 송출 앱에서 설정/),
  ).toBeInTheDocument();
});

it("combines device, transport and receiving status and explains locked video settings", async () => {
  const { act, within } = await import("@testing-library/react");
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
  act(() => controller.frameRendered(886, 1920));
  const summary = screen.getByRole("group", { name: "연결 정보" });
  expect(summary).toHaveTextContent(backend.devices[0].name);
  expect(summary).toHaveTextContent("USB");
  expect(within(summary).getByText("화면 수신 중")).toBeInTheDocument();
  expect(screen.queryByText("내 폰 화면")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "설정 열기" }));
  expect(screen.getByRole("button", { name: "설정 닫기" })).toHaveTextContent(
    "설정",
  );
  expect(screen.getByLabelText("화질")).toHaveAccessibleDescription(
    /연결을 종료/,
  );
  expect(screen.getByLabelText("프레임")).toHaveAccessibleDescription(
    /연결을 종료/,
  );
  await userEvent.click(screen.getByRole("button", { name: "연결 종료" }));
  expect(screen.getByLabelText("화질")).toBeEnabled();
  expect(screen.queryByText(/연결을 종료하면 화질/)).not.toBeInTheDocument();
});

for (const mode of ["fullscreen", "pip"] as const) {
  it(`starts capture and recording within ${mode} without replacing the session`, async () => {
    const { act } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    const { MediaCaptureController } =
      await import("../src/application/MediaCaptureController");
    const { WindowPresentationController } =
      await import("../src/application/WindowPresentationController");
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    const source = {
      screenshot: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
      record: vi.fn(() => ({
        stop: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
      })),
    };
    const store = { save: vi.fn(async () => "/saved") };
    const media = new MediaCaptureController(source, store);
    const presentation = new WindowPresentationController({
      setMode: vi.fn(async (mode) => mode),
    });
    await controller.refreshDevices();
    render(
      <PhoneMirrorApp
        controller={controller}
        mediaController={media}
        windowPresentationController={presentation}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "폰 화면 보기" }));
    act(() => controller.frameRendered(320, 640));
    await act(async () => presentation.setMode(mode));
    await userEvent.click(screen.getByLabelText("캡처 및 녹화"));
    await userEvent.click(
      screen.getByRole("button", { name: "스크린샷 저장" }),
    );
    expect(store.save).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByLabelText("캡처 및 녹화"));
    await userEvent.click(screen.getByRole("button", { name: "화면 녹화" }));
    expect(source.record).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "녹화 종료 및 저장" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "녹화 종료 및 저장" }),
    );
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(presentation.getSnapshot().mode).toBe(mode);
    expect(backend.startSession).toHaveBeenCalledTimes(1);
    await act(async () => controller.stop());
  });
}

it("groups connection and video settings and keeps manual Android input collapsed", async () => {
  const { within } = await import("@testing-library/react");
  const backend = new FakeBackend();
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  const connection = screen.getByRole("region", { name: "기기 연결" });
  const video = screen.getByRole("region", { name: "화면 설정" });
  expect(
    within(connection).getByLabelText("연결이 끊기면 자동 재연결"),
  ).toBeInTheDocument();
  expect(
    within(video).getByLabelText("Android Wi-Fi 자동 화질"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: /Galaxy · USB · 사용 가능/ }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByText("Android Wi-Fi 연결", { exact: true }),
  );
  expect(
    screen.getByRole("button", { name: "Android QR 페어링 시작" }),
  ).toBeVisible();
  expect(screen.getByLabelText("페어링 주소")).not.toBeVisible();
  await userEvent.click(screen.getByText("코드·주소로 연결", { exact: true }));
  expect(screen.getByLabelText("페어링 주소")).toBeVisible();
  await userEvent.type(screen.getByLabelText("페어링 주소"), "1.2.3.4:0");
  await userEvent.type(screen.getByLabelText("6자리 페어링 코드"), "12345");
  expect(screen.getByRole("button", { name: /^페어링$/ })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText("페어링 주소"));
  await userEvent.clear(screen.getByLabelText("6자리 페어링 코드"));
  await userEvent.type(screen.getByLabelText("페어링 주소"), "1.2.3.4:65535");
  await userEvent.type(screen.getByLabelText("6자리 페어링 코드"), "123456");
  expect(screen.getByRole("button", { name: /^페어링$/ })).toBeEnabled();
  await userEvent.click(screen.getByText("코드·주소로 연결", { exact: true }));
  await userEvent.click(screen.getByText("코드·주소로 연결", { exact: true }));
  expect(screen.getByLabelText("페어링 주소")).toHaveValue("1.2.3.4:65535");
  expect(backend.pairDevice).not.toHaveBeenCalled();
  expect(backend.startSession).not.toHaveBeenCalled();
});
