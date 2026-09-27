import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./palette";

/**
 * The canvas and the stylesheet must agree. A token renamed or re-lit in
 * tokens.css and not here would leave the map painting last season's room.
 */
const tokensCss = readFileSync(fileURLToPath(new URL("../app/styles/tokens.css", import.meta.url)), "utf8");

const cssName = (key: string): string => `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

describe("the map's palette", () => {
  it.each(Object.entries(TOKENS))("%s matches tokens.css", (key, value) => {
    const match = new RegExp(`${cssName(key)}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokensCss);
    expect(match, `${cssName(key)} is missing from tokens.css`).not.toBeNull();
    expect(match![1]!.toUpperCase()).toBe(value.toUpperCase());
  });
});
