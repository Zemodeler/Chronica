import { describe, expect, it } from "vitest";
import { chronicleHeadline, humanizeIdentifiers, humanizeRefusalReason, stripEngineJargon, titleCase, ORDER_NOUNS } from "./voice";
import { WORKFLOW_IDS } from "../workflows/registry";
import { INVOKE_DEFINED_ACTION_TOOL, RECORD_REFUSAL_AFTERMATH_TOOL } from "../gm/tools";

describe("ORDER_NOUNS", () => {
  const validActionIds = new Set([...WORKFLOW_IDS, INVOKE_DEFINED_ACTION_TOOL, RECORD_REFUSAL_AFTERMATH_TOOL]);

  it("keys every entry to a real, currently-registered action id", () => {
    // Guards against the class of bug where an action id is renamed in its
    // workflow definition but a hardcoded copy of the old id survives here,
    // silently rotting: the chronicle then falls back to a humanized id
    // instead of the intended noun phrase, forever, with no error.
    const staleKeys = Object.keys(ORDER_NOUNS).filter((key) => !validActionIds.has(key));
    expect(staleKeys).toEqual([]);
  });
});

describe("humanizeIdentifiers", () => {
  it("turns an engine identifier into ordinary words", () => {
    expect(humanizeIdentifiers("sponsors a council_deliberation procedure")).toBe("sponsors a council deliberation procedure");
  });

  it("removes a leaked hyphenated internal identifier rather than presenting it as a decision", () => {
    expect(humanizeIdentifiers("senate-war-account-step6")).toBe("the proposed measure");
  });

  it("leaves proper names and ordinary prose alone", () => {
    expect(humanizeIdentifiers("Lucius Aemilius Barbula opened a debate")).toBe("Lucius Aemilius Barbula opened a debate");
  });
});

describe("stripEngineJargon", () => {
  it("removes the vocabulary of the machine from a reader-facing sentence", () => {
    const out = stripEngineJargon('Workflow "call_vote" cannot be applied to the current world state.');
    expect(out).not.toMatch(/workflow|world state|call_vote/i);
    expect(out).toContain("call vote");
  });
});

describe("humanizeRefusalReason", () => {
  it("restates an inapplicable action without naming the engine", () => {
    expect(humanizeRefusalReason('Workflow "call_vote" cannot be applied to the current world state.'))
      .toBe("circumstances as they stood did not admit it");
  });

  it("keeps an authority refusal's own in-world reason", () => {
    expect(humanizeRefusalReason("Refused: a consul may not appoint a dictator alone."))
      .toBe("a consul may not appoint a dictator alone");
  });

  it("does not leak a guessed character id into the Chronicle", () => {
    expect(humanizeRefusalReason('No character exists with the id "roman-field-army".'))
      .toBe("the name found no match in the rolls");
  });
});

describe("chronicleHeadline", () => {
  it("never cuts a word in half", () => {
    const long = "Hieron II formed a public goal to secure Syracuse against the Mamertine hold on Messana, while the Mamertine spokesman formed one of his own";
    const headline = chronicleHeadline(long);
    expect(headline.split(" ").length).toBeLessThanOrEqual(9);
    // Every word of the headline is a whole word of the source.
    const sourceWords = new Set(long.replace(/[,.]/g, "").toLowerCase().split(" "));
    for (const word of headline.toLowerCase().split(" ")) expect(sourceWords.has(word)).toBe(true);
  });

  it("never ends on a hanging joining word", () => {
    expect(chronicleHeadline("The senate deliberated at length upon the question of the")).not.toMatch(/\b(of|the|upon)$/i);
  });

  it("carries no identifier into a title", () => {
    expect(chronicleHeadline("Lucius sponsors a council_deliberation procedure")).not.toContain("_");
  });

  it("does not turn a leaked hyphenated id into a headline", () => {
    expect(chronicleHeadline("The senate-war-account-step6 refused")).not.toMatch(/senate-war-account-step6|step6/i);
  });
});

describe("titleCase", () => {
  it("capitalises a headline without shouting its joining words", () => {
    expect(titleCase("a new council deliberation opens")).toBe("A New Council Deliberation Opens");
  });

  it("leaves a proper name as written", () => {
    expect(titleCase("hieron II turns toward messana")).toBe("Hieron II Turns Toward Messana");
  });
});

describe("a schema complaint quoted back by the Game Master", () => {
  // The regression this guards: "The battle attempt was refused because the
  // defendingForceIds array was empty; no battle was started." reaching a
  // reader as the account of what happened.
  const raw = "The battle attempt was refused because the defendingForceIds array was empty; no battle was started.";

  it("carries no camelCase field name onto the page", () => {
    const out = stripEngineJargon(raw);
    expect(out).not.toContain("defendingForceIds");
    expect(out).not.toMatch(/[a-z][A-Z]/);
  });

  it("says what it means: no one was there to fight", () => {
    expect(stripEngineJargon(raw)).toContain("no one stood against them");
  });

  it("leaves a proper name in mixed case alone", () => {
    expect(humanizeIdentifiers("Hieron II and Lucius Aemilius Barbula")).toBe("Hieron II and Lucius Aemilius Barbula");
  });
});
