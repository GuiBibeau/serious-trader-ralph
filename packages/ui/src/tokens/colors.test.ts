import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type ColorToken, colors, cssVar } from "./colors";

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

describe("tokens.css mirrors colors.ts", () => {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) declarations.set(name, value.trim());
  }

  for (const token of Object.keys(colors) as ColorToken[]) {
    test(`${token} matches ${cssVar[token]}`, () => {
      expect(declarations.get(cssVar[token])).toBe(colors[token]);
    });
  }
});
