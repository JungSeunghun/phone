import { it, expect } from "vitest";
import {
  validWirelessAddress,
  validMirrorSettings,
} from "../src/domain/PhoneMirror";
it("validates both IP families, exact port boundaries and rejects coercible values", () => {
  for (const address of [
    "1.2.3.4:1",
    "255.255.255.255:65535",
    "[::1]:1",
    "[2001:db8::1]:65535",
  ])
    expect(validWirelessAddress(address), address).toBe(true);
  for (const address of [
    "",
    "1.2.3.4:0",
    "1.2.3.4:65536",
    "01.2.3.4:1",
    "256.1.1.1:1",
    "host:1",
    "1.2.3.4:+1",
    "[1.2.3.4]:1",
    "[:::1]:1",
    "[::1]:１２",
    "1.2.3.4:1;reboot",
  ])
    expect(validWirelessAddress(address), address).toBe(false);
});
it("accepts only the shared supported quality and frame rate values", () => {
  for (const size of [720, 1280, 1920, 2560, 3840])
    for (const fps of [15, 30, 60])
      expect(
        validMirrorSettings({
          videoMaxDimension: size,
          videoMaxFrameRate: fps,
          keepScreenAwake: true,
        }),
      ).toBe(true);
  for (const value of [
    undefined,
    {},
    { videoMaxDimension: 0, videoMaxFrameRate: 60, keepScreenAwake: true },
    { videoMaxDimension: 1920, videoMaxFrameRate: 61, keepScreenAwake: true },
    { videoMaxDimension: "1920", videoMaxFrameRate: 60, keepScreenAwake: true },
  ])
    expect(validMirrorSettings(value)).toBe(false);
});
