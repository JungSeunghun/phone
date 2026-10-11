import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createConnectionCodeQr } from "../src/infrastructure/ConnectionCodeQr";
import { IosReceiverPanel } from "../src/presentation/IosReceiverPanel";
import { IosReceiverController } from "../src/application/IosReceiverController";
const key = "ab".repeat(32);
it("encodes exact USB/Wi-Fi payloads and rejects invalid or oversized codes", () => {
  expect(createConnectionCodeQr(`PMU1|1|${key}`.padStart(256, " "))).toBe(
    createConnectionCodeQr(`PMU1|1|${key}`),
  );
  for (const code of [
    `PMU1|1|${key}`,
    `PMU1|65535|${key}`,
    `PMW1|192.168.0.44:43315|${key}`,
    `PMW1|[::1]:65535|${key}`,
  ]) {
    const result = createConnectionCodeQr(code);
    expect(result).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(result.split(",")[1])).toContain(
      'fill="#ffffff"',
    );
  }
  for (const code of [
    "",
    `PMU1|0|${key}`,
    `PMU1|65536|${key}`,
    `PMU1|1.0|${key}`,
    `PMU1|1|bad`,
    `PMW1|evil.example:1|${key}`,
    "x".repeat(257),
  ])
    expect(() => createConnectionCodeQr(code)).toThrow();
});
it.each(["usb", "wifi"] as const)(
  "displays a %s QR only during the active receiver and rotates it on restart",
  async (transport) => {
    let starts = 0;
    const backend = {
      start: vi.fn(async () => ({
        receiverId: String(++starts),
        port: 27483,
        codes: [
          `${transport === "usb" ? "PMU1|27483" : "PMW1|127.0.0.1:27483"}|${(starts === 1 ? "ab" : "cd").repeat(32)}`,
        ],
      })),
      stop: vi.fn(async () => {}),
    };
    render(
      <IosReceiverPanel
        controller={new IosReceiverController(backend, transport)}
        transport={transport}
      />,
    );
    fireEvent.click(
      screen.getByText(
        transport === "usb" ? "iPhone Windows USB 송출" : "iPhone Wi-Fi 송출",
      ),
    );
    const startLabel =
      transport === "usb" ? "iPhone USB 수신 시작" : "iPhone 수신 시작";
    fireEvent.click(screen.getByText(startLabel));
    const image = await screen.findByRole("img", {
      name: "iPhone 연결 QR 코드 1",
    });
    const original = image.getAttribute("src");
    fireEvent.click(
      screen.getByText(
        transport === "usb" ? "iPhone USB 수신 종료" : "iPhone 수신 종료",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: "iPhone 연결 QR 코드 1" }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByText(startLabel));
    expect(
      (
        await screen.findByRole("img", { name: "iPhone 연결 QR 코드 1" })
      ).getAttribute("src"),
    ).not.toBe(original);
  },
);

it("keeps manual input available if QR validation fails", async () => {
  const controller = new IosReceiverController({
    start: async () => ({
      receiverId: "invalid",
      port: 1,
      codes: ["broken-code"],
    }),
    stop: async () => {},
  });
  render(<IosReceiverPanel controller={controller} />);
  fireEvent.click(screen.getByText("iPhone Wi-Fi 송출"));
  fireEvent.click(screen.getByText("iPhone 수신 시작"));
  expect(await screen.findByLabelText("iPhone 연결 코드 1")).toHaveValue(
    "broken-code",
  );
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText(/QR 코드를 만들 수 없습니다/)).toBeVisible();
});
