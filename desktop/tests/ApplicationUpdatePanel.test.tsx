import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { ApplicationUpdateController } from "../src/application/ApplicationUpdateController";
import { ApplicationUpdatePanel } from "../src/presentation/ApplicationUpdatePanel";
it("shows availability and invokes installation only on button action", async () => {
  const backend = {
    configuration: async () => ({ version: "0.1.0", configured: true }),
    check: async () => ({ version: "0.2.0", notes: "New features" }),
    install: vi.fn(async () => {}),
    cancel: async () => {},
  };
  const controller = new ApplicationUpdateController(
    backend,
    { getItem: () => null, setItem: () => {} },
    () => false,
  );
  render(<ApplicationUpdatePanel controller={controller} />);
  await screen.findByText("새 버전 0.2.0");
  expect(backend.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("업데이트하고 다시 시작"));
  await waitFor(() => expect(backend.install).toHaveBeenCalledOnce());
});
it("explains an unconfigured server and rejects invalid addresses", async () => {
  const controller = new ApplicationUpdateController(
    {
      configuration: async () => ({ version: "0.1.0", configured: false }),
      check: vi.fn(),
      install: vi.fn(),
      cancel: async () => {},
    },
    { getItem: () => null, setItem: () => {} },
    () => false,
  );
  render(<ApplicationUpdatePanel controller={controller} />);
  await screen.findByText(/배포 주소를 등록/);
  expect(screen.getByText("업데이트 확인")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("HTTPS 업데이트 주소"), {
    target: { value: "http://example.org/" },
  });
  fireEvent.submit(screen.getByText("주소 저장").closest("form")!);
  await screen.findByText(/HTTPS 주소를 입력/);
});
