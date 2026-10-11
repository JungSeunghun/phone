import { createRoot } from "react-dom/client";
import jsQR from "jsqr";
import { IosReceiverController } from "../../src/application/IosReceiverController";
import { IosReceiverPanel } from "../../src/presentation/IosReceiverPanel";
import "../../src/presentation/styles.css";
const transport =
  new URLSearchParams(location.search).get("transport") === "usb"
    ? "usb"
    : "wifi";
const code = `${transport === "usb" ? "PMU1|27483" : "PMW1|192.168.0.44:43315"}|${"ab".repeat(32)}`;
(
  window as unknown as { decodeConnectionQr: () => Promise<string | undefined> }
).decodeConnectionQr = async () => {
  const source = document.querySelector<HTMLImageElement>(
    ".connection-code-qr img",
  )!;
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height)?.data;
};
createRoot(document.getElementById("root")!).render(
  <main>
    <IosReceiverPanel
      transport={transport}
      controller={
        new IosReceiverController(
          {
            start: async () => ({
              receiverId: "qr-fixture",
              port: 27483,
              codes: [code],
            }),
            stop: async () => {},
          },
          transport,
        )
      }
    />
  </main>,
);
