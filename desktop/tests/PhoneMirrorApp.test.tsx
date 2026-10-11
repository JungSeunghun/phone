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
