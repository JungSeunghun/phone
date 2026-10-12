import messages from "./EnglishMessages.json";
export type ApplicationLanguage = "ko" | "en";
export const englishMessages: Readonly<Record<string, string>> = messages;
export function validApplicationLanguage(
  value: unknown,
): value is ApplicationLanguage {
  return value === "ko" || value === "en";
}
const templates = Object.entries(englishMessages)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => ({
    expression: new RegExp(
      "^" +
        key
          .split(/\{\d+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("([\\s\\S]*?)") +
        "$",
    ),
    value,
  }));
/** Translate app-owned copy only; never pass device names, user input, or codes here. */
export function translate(language: ApplicationLanguage, text: string): string {
  if (language === "ko") return text;
  const exact = Object.hasOwn(englishMessages, text)
    ? englishMessages[text]
    : undefined;
  if (exact) return exact;
  for (const { expression, value } of templates) {
    const match = expression.exec(text);
    if (match)
      return value.replace(
        /\{(\d+)\}/g,
        (_, index: string) => match[Number(index) + 1],
      );
  }
  return text;
}
