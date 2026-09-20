import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WatchPredicate, type WorldState } from "@chronica/shared";
import { isWatchSatisfied } from "./watch";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("what the ruler asked to be woken for", () => {
  /**
   * The rule the whole mechanism rests on. A watch is a thing to be woken
   * *for*: a condition that was already true when the order was given has not
   * happened, and firing on it ends the order in the act of giving it. Two
   * arms guarded against this and the rest did not, so a live campaign kept
   * producing bursts that carried the world two days and did nothing.
   */
  it("never fires on a condition that was already true when the order was given", () => {
    const state = world();
    const romanHeadcount = state.material.forces
      .filter((force) => force.polityId === "rome")
      .reduce((sum, force) => sum + force.personnel.reduce((men, category) => men + category.fit, 0), 0);
    const force = state.material.forces[0]!;
    const account = state.material.accounts[0]!;
    const dead = state.characters[0]!;

    const alreadyTrue: readonly WatchPredicate[] = [
      { kind: "polity_strength_above", polityId: "rome", headcount: Math.max(0, romanHeadcount - 1) },
      { kind: "force_strength_below", forceId: force.id, headcount: 1_000_000 },
      { kind: "account_below", accountId: account.id, amount: account.balance + 1 },
      { kind: "arrears_reach", obligationId: state.material.obligations[0]?.id ?? "none", periods: 0 },
      { kind: "force_enters_province", provinceId: force.locationId },
    ];
    for (const predicate of alreadyTrue) {
      expect(isWatchSatisfied(predicate, state, state), predicate.kind).toBe(false);
    }
    void dead;
  });

  it("fires the moment the condition becomes true", () => {
    const opening = world();
    const force = opening.material.forces.find((candidate) => candidate.polityId === "rome")!;
    const elsewhere = opening.map.provinces.find((province) => province.id !== force.locationId)!;

    const moved: WorldState = {
      ...opening,
      material: {
        ...opening.material,
        forces: opening.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, locationId: elsewhere.id } : candidate)),
      },
    };
    const predicate: WatchPredicate = { kind: "force_enters_province", provinceId: elsewhere.id, polityId: "rome" };
    expect(isWatchSatisfied(predicate, opening, opening)).toBe(false);
    expect(isWatchSatisfied(predicate, opening, moved)).toBe(true);
  });

  it("wakes for a death that happens, not for one that already had", () => {
    const opening = world();
    const who = opening.characters[0]!;
    const buried: WorldState = {
      ...opening,
      characters: opening.characters.map((character) => (character.id === who.id ? { ...character, alive: false, diedAtStep: 5 } : character)),
    };
    expect(isWatchSatisfied({ kind: "character_dies", characterId: who.id }, opening, opening)).toBe(false);
    expect(isWatchSatisfied({ kind: "character_dies", characterId: who.id }, opening, buried)).toBe(true);
    // And an order given after he was already dead does not wake for it again.
    expect(isWatchSatisfied({ kind: "character_dies", characterId: who.id }, buried, buried)).toBe(false);
  });

  it("wakes when the treasury falls past the mark, not when it is already past it", () => {
    const opening = world();
    const account = opening.material.accounts.find((candidate) => candidate.balance > 100)!;
    const spent: WorldState = {
      ...opening,
      material: {
        ...opening.material,
        accounts: opening.material.accounts.map((candidate) => (candidate.id === account.id ? { ...candidate, balance: 10 } : candidate)),
      },
    };
    const predicate: WatchPredicate = { kind: "account_below", accountId: account.id, amount: 50 };
    expect(isWatchSatisfied(predicate, opening, opening)).toBe(false);
    expect(isWatchSatisfied(predicate, opening, spent)).toBe(true);
  });

  it("still answers ground changing hands by comparing who held it", () => {
    const opening = world();
    const province = opening.map.provinces.find((candidate) => candidate.controllerPolityId !== null)!;
    const taken: WorldState = {
      ...opening,
      map: {
        ...opening.map,
        provinces: opening.map.provinces.map((candidate) => (candidate.id === province.id ? { ...candidate, controllerPolityId: "rome" } : candidate)),
      },
    };
    const predicate: WatchPredicate = { kind: "province_control_changes", provinceId: province.id };
    expect(isWatchSatisfied(predicate, opening, opening)).toBe(false);
    expect(isWatchSatisfied(predicate, opening, taken)).toBe(province.controllerPolityId !== "rome");
  });
});
