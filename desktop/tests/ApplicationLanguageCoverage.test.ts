import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { englishMessages } from "../src/domain/ApplicationLanguage";

it("has English translations for every app-owned Korean frontend message", () => {
  const missing = new Set<string>();
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.tsx?$/.test(path)) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        let text: string | undefined;
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isJsxText(node)
        )
          text = node.text.replace(/\s+/g, " ").trim();
        if (ts.isTemplateExpression(node)) {
          text = node.head.text;
          node.templateSpans.forEach((span, index) => {
            text += `{${index}}` + span.literal.text;
          });
        }
        if (
          text &&
          /[가-힣]/.test(text) &&
          text !== "한국어" &&
          text !== "언어 / Language" &&
          !Object.hasOwn(englishMessages, text)
        )
          missing.add(text);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan("src");
  expect([...missing]).toEqual([]);
});

it("keeps all interpolation placeholders in translated messages", () => {
  for (const [key, value] of Object.entries(englishMessages)) {
    expect(value.trim()).not.toBe("");
    expect(value.match(/\{\d+\}/g)?.sort() ?? []).toEqual(
      key.match(/\{\d+\}/g)?.sort() ?? [],
    );
  }
});
