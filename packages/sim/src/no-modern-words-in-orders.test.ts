import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modernWordsIn } from "@chronica/shared";

/**
 * The words the player reads, made by the rules of the orders (docs/economy.md, "Orders, calls and consequences"), are of the age: no modern words in the files that
 * write them. (The list of the older files is `no-modern-words.test.ts`; this is the orders' own.)
 */
const FILES = [
  "./usurpation.ts",
  "./stance.ts",
  "./supply-plan.ts",
  "./order-templates.ts",
  "./order-by-rule.ts",
];

describe("no modern words in what the orders say", () => {
  it("has none in the words of the usurpation, the supply plan, the templates and the rule's answers", () => {
    const found = FILES.flatMap((file) => modernWordsIn(readFileSync(new URL(file, import.meta.url), "utf8")).map((word) => `${file}: ${word}`));
    expect(found).toEqual([]);
  });
});
