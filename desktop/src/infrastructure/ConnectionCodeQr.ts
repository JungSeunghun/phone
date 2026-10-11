import QRCode from "qrcode";
import { validWirelessAddress } from "../domain/PhoneMirror";
/** Pure local encoding: the connection secret never leaves the app. */
export function createConnectionCodeQr(input: string): string {
  const parts = input.trim().split("|");
  if (
    new TextEncoder().encode(input).length > 256 ||
    parts.length !== 3 ||
    !/^[a-fA-F0-9]{64}$/.test(parts[2]) ||
    !(parts[0] === "PMW1"
      ? validWirelessAddress(parts[1])
      : parts[0] === "PMU1" &&
        /^\d+$/.test(parts[1]) &&
        Number(parts[1]) >= 1 &&
        Number(parts[1]) <= 65535)
  )
    throw new Error("잘못된 iPhone 연결 코드입니다.");
  return encodeQrImage(input.trim());
}

/** Shared local renderer; callers validate their own connection protocol. */
export function encodeQrImage(payload: string): string {
  const { modules } = QRCode.create(payload, {
    errorCorrectionLevel: "M",
  });
  const size = modules.size + 8;
  const dots: string[] = [];
  for (let row = 0; row < modules.size; row++)
    for (let column = 0; column < modules.size; column++)
      if (modules.get(row, column))
        dots.push(`M${column + 4} ${row + 4}h1v1h-1z`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="256" height="256" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h${size}v${size}H0z"/><path fill="#000000" d="${dots.join("")}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
