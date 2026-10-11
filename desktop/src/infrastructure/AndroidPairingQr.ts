import { encodeQrImage } from "./ConnectionCodeQr";
export function createAndroidPairingQr(payload: string): string {
  if (!/^WIFI:T:ADB;S:studio-[a-f0-9]{32};P:[a-f0-9]{32};;$/.test(payload))
    throw Error("잘못된 Android QR 페어링 코드입니다.");
  return encodeQrImage(payload);
}
