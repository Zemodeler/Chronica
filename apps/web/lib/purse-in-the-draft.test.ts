import { describe, expect, it } from "vitest";
import { purseInTheDraft } from "./purse-in-the-draft";

describe("the purse the draft names", () => {
  it("is the purse the character will open with, not the one the model asked for", () => {
    const draft = "You are Statius Mettius, with the garrison of the town and 30000 drachmae of your own.";
    expect(purseInTheDraft(draft, 30000, 2500)).toBe("You are Statius Mettius, with the garrison of the town and 2,500 drachmae of your own.");
  });

  it("reads a sum written with commas too", () => {
    expect(purseInTheDraft("A purse of 30,000 and a name.", 30000, 2500)).toBe("A purse of 2,500 and a name.");
  });

  it("leaves a draft alone when the purse was not changed", () => {
    expect(purseInTheDraft("A purse of 2500.", 2500, 2500)).toBe("A purse of 2500.");
    expect(purseInTheDraft(null, 30000, 2500)).toBeNull();
  });
});
