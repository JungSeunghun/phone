import { it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FirstConnectionGuide } from "../src/presentation/FirstConnectionGuide";
it("explains Android and iPhone setup without connecting or requesting permissions", () => {
  render(<FirstConnectionGuide />);
  expect(screen.getByText(/USB 디버깅을 켜고/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("처음 연결할 방식"), {
    target: { value: "android-wifi" },
  });
  expect(
    screen.getByText(/페어링 포트와 연결 포트는 다릅니다/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("처음 연결할 방식"), {
    target: { value: "ios-usb" },
  });
  expect(screen.getByText(/Windows USB는/)).toBeInTheDocument();
  expect(screen.getByText(/iPhone 실기기 검증은 아직/)).toBeInTheDocument();
});
