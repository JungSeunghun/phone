import { expect, type Page } from "@playwright/test";
/** Preserve the actual clipboard payload: Windows may convert LF to CRLF. */
export async function writeClipboardFixture(page: Page, text: string) {
  const actual = await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
    return navigator.clipboard.readText();
  }, text);
  // Permit the native newline convention, while verifying every other character.
  expect(actual.replace(/\r\n/g, "\n")).toBe(text.replace(/\r\n/g, "\n"));
  return actual;
}
