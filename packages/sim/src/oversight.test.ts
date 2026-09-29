import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, WORLD_DELTA_OPS, type Office, type WorldState } from "@chronica/shared";
import { describeBreach, findWhoWouldNotice } from "./oversight";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const offices: readonly Office[] = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition).government.offices;

describe("saying what somebody actually did", () => {
  it("never puts an engine handle in a sentence a person would say", () => {
    // The old summary was the audit line -- `No active grant gives character
    // "quintus-ogulnius" propose power in the civil domain over polity "rome"`
    // -- which reached the Chronicle once, as an entry headlined "Fiscal
    // Record Grants No Spending Power to the Declared Character".
    const state = world();
    const account = state.material.accounts[0]!;
    const clause = describeBreach(
      { op: "money_transfer", fromAccountRef: account.id, toAccountRef: null, amount: 400, reason: "." },
      state,
      "Quintus Ogulnius",
    );
    expect(clause).toContain("Quintus Ogulnius");
    expect(clause).toContain("400");
    expect(clause).not.toContain("grant");
    expect(clause).not.toContain(account.id);
  });

  it("has something to say about every way the world can be changed", () => {
    // A default that said nothing would be an audit line by another route.
    const state = world();
    for (const op of WORLD_DELTA_OPS) {
      const clause = describeBreach({ op } as never, state, "Quintus Ogulnius");
      expect(clause.length, op).toBeGreaterThan(10);
      expect(clause, op).toContain("Quintus Ogulnius");
    }
  });
});

describe("who would come across it", () => {
  const breachOf = (delta: unknown) => ({ delta: delta as never, reason: "irrelevant" });

  it("gives a moved legion to the men who answer for it, and quickly", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const noticers = findWhoWouldNotice(state, offices, breachOf({ op: "force_modify", forceRef: force.id, reason: "." }), "a-stranger");
    expect(noticers.length).toBeGreaterThan(0);
    expect(noticers.map((noticer) => noticer.characterId)).toContain(force.commanderCharacterId);
    // A legion does not move without them knowing by Tuesday.
    expect(Math.min(...noticers.map((noticer) => noticer.afterDays))).toBeLessThanOrEqual(7);
  });

  it("gives money to whoever else is named on the books, and slowly", () => {
    const state = world();
    const access = state.material.accountAccess[0];
    if (access === undefined) return;
    const noticers = findWhoWouldNotice(state, offices, breachOf({ op: "money_transfer", fromAccountRef: access.accountId, toAccountRef: null, amount: 100, reason: "." }), "a-stranger");
    expect(noticers.map((noticer) => noticer.characterId)).toContain(access.characterId);
    expect(noticers[0]!.afterDays).toBeGreaterThanOrEqual(7);
  });

  it("never names the man who did it", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const noticers = findWhoWouldNotice(state, offices, breachOf({ op: "force_modify", forceRef: force.id, reason: "." }), force.commanderCharacterId);
    expect(noticers.map((noticer) => noticer.characterId)).not.toContain(force.commanderCharacterId);
  });

  it("finds nobody where nothing in the world has a live relation to it", () => {
    // This must stay possible. A world where every irregularity is always
    // caught is one where nobody would ever try anything, which empties out
    // the whole of VISION §12.
    const state = world();
    const noticers = findWhoWouldNotice(state, offices, breachOf({ op: "force_modify", forceRef: "no-such-force", reason: "." }), "a-stranger");
    expect(noticers).toEqual([]);
  });

  it("never wakes more than two people: a scandal half the republic finds is not a scandal", () => {
    const state = world();
    const account = state.material.accounts[0]!;
    const noticers = findWhoWouldNotice(state, offices, breachOf({ op: "money_transfer", fromAccountRef: account.id, toAccountRef: null, amount: 100, reason: "." }), "a-stranger");
    expect(noticers.length).toBeLessThanOrEqual(2);
  });
});
