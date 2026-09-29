import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readTheBooks } from "./books";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const consul = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};

describe("the books, as the person holding them can read them", () => {
  it("adds up to the surplus the engine was already computing and never showing", () => {
    const books = readTheBooks(world(), null);
    expect(books.totalIncome).toBe(books.income.reduce((sum, line) => sum + line.monthly, 0));
    expect(books.totalExpenditure).toBe(books.expenditure.reduce((sum, line) => sum + line.monthly, 0));
    expect(books.surplus).toBe(books.totalIncome - books.totalExpenditure);
  });

  it("puts things under the headings §7 is written in", () => {
    const state = world();
    const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
    const books = readTheBooks(state, seat.holderCharacterId, offices);
    const headings = [...books.income, ...books.expenditure].map((line) => line.label);
    // Whatever the scenario happens to hold, it is described in words rather
    // than in the engine's own enum.
    for (const heading of headings) expect(heading).not.toContain("_");
  });

  it("does not show a private man the government's books", () => {
    // The same `seesAccount` the world slice uses, so what the player is shown
    // and what the model is told can never drift apart.
    const state = world();
    const seated = new Set(state.material.officeSeats.filter((s) => s.status === "held").map((s) => s.holderCharacterId));
    const priv = state.characters.find((character) => character.alive && !seated.has(character.id));
    if (priv === undefined) return;
    const theirs = readTheBooks(state, priv.id, offices);
    expect(theirs.theirGovernments).toBe(false);
    expect(theirs.accounts.every((account) => !account.label.endsWith("treasury"))).toBe(true);
  });

  it("names an army's account by the army, never by its id", () => {
    // The consul's treasury listed "roman-field-army's purse": every owner
    // was looked up among the characters, and a force fell back to its id.
    const state = world();
    const chest = state.material.accounts.find((account) => account.owner.kind === "force");
    expect(chest, "the scenario gives an army a chest").toBeDefined();
    const force = state.material.forces.find((candidate) => candidate.id === chest!.owner.id)!;
    const line = readTheBooks(state, null).accounts.find((account) => account.id === chest!.id)!;
    expect(line.label).toContain(force.name.replace(/^the\s+/i, ""));
    expect(line.label).not.toContain(force.id);
    expect(line.label).not.toContain("'s purse");
  });

  it("names no account by an id, whoever owns it", () => {
    const state = world();
    const ids = new Set([...state.material.accounts.map((account) => account.owner.id), ...state.material.accounts.map((account) => account.id)]);
    for (const account of readTheBooks(state, null).accounts) {
      for (const id of ids) expect(account.label, `${account.label} contains ${id}`).not.toMatch(new RegExp(`(^|[^A-Za-z])${id}([^A-Za-z]|$)`));
    }
  });

  it("tells whoever opens the treasury how hard its taxes press, and a private man nothing", () => {
    const state = world();
    const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
    const governing = readTheBooks(state, seat.holderCharacterId, offices);
    if (governing.theirGovernments) {
      expect(governing.pressure?.inWords).toMatch(/complaint|resented|pressing|more than the land/);
      expect(governing.lands).not.toBeNull();
    }
    const seated = new Set(state.material.officeSeats.filter((s) => s.status === "held").map((s) => s.holderCharacterId));
    const priv = state.characters.find((character) => character.alive && !seated.has(character.id));
    if (priv === undefined) return;
    const theirs = readTheBooks(state, priv.id, offices);
    expect(theirs.pressure).toBeNull();
    expect(theirs.lands).toBeNull();
  });

  it("lists only the reader's own power's provinces among its lands", () => {
    const state = world();
    const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
    const holder = state.characters.find((character) => character.id === seat.holderCharacterId)!;
    const books = readTheBooks(state, holder.id, offices);
    const ours = new Set(state.map.provinces.filter((province) => province.controllerPolityId === holder.polityId).map((province) => province.id));
    for (const land of books.lands ?? []) expect(ours.has(land.id)).toBe(true);
    for (const land of books.lands ?? []) expect(land.order).toMatch(/orderly|uneasy|restless|disorder/);
  });

  it("names each payment that has fallen behind, rather than one sum", () => {
    const state = world();
    const behind: WorldState = {
      ...state,
      material: { ...state.material, obligations: state.material.obligations.map((obligation, index) => (index === 0 ? { ...obligation, arrears: 400, missedPeriods: 2 } : obligation)) },
    };
    const books = readTheBooks(behind, null);
    expect(books.behind[0]).toMatchObject({ arrears: 400, missedPeriods: 2, label: state.material.obligations[0]!.label });
  });

  it("counts what actually arrives, not what was levied", () => {
    const state = world();
    const source = state.material.incomeSources[0];
    if (source === undefined) return;
    const full: WorldState = { ...state, material: { ...state.material, incomeSources: [{ ...source, collectionRateBps: 10_000 }] } };
    const half: WorldState = { ...state, material: { ...state.material, incomeSources: [{ ...source, collectionRateBps: 5_000 }] } };
    expect(readTheBooks(half, null).totalIncome).toBeLessThan(readTheBooks(full, null).totalIncome);
  });

  it("says what is owed and unpaid, because a surplus over arrears is not a surplus", () => {
    const state = world();
    expect(state.material.obligations.length).toBeGreaterThan(0);
    const behind: WorldState = {
      ...state,
      material: { ...state.material, obligations: state.material.obligations.map((obligation) => ({ ...obligation, arrears: 40 })) },
    };
    expect(readTheBooks(behind, null).arrears).toBeGreaterThan(0);
  });

  it("gives a power that has an economy an economy to read", () => {
    // This scenario opened with nine personal purses, no treasury anywhere,
    // no income and nothing owed -- so a war cost nobody anything and §7 had
    // no subject at all.
    const books = readTheBooks(world(), null);
    expect(books.totalIncome).toBeGreaterThan(0);
    expect(books.totalExpenditure).toBeGreaterThan(0);
    expect(books.income.map((line) => line.label)).toContain("Taxes");
    // Every heading is a word a reader would use, including the one added to
    // the income enum last: an unlabelled kind falls through as its own id and
    // "tribute" appeared in the panel in lowercase beside "Taxes".
    for (const line of [...books.income, ...books.expenditure]) expect(line.label[0]).toBe(line.label[0]!.toUpperCase());
    expect(books.expenditure.map((line) => line.label)).toContain("Army pay");
  });

  it("keeps a consul's own purse out of the treasury, and the treasury out of his purse", () => {
    // The strongbox and the ledger stand opened one table that added the
    // Republic's treasury and the consul's fortune into one surplus.
    const state = world();
    const holder = consul(state);
    const own = readTheBooks(state, holder.id, offices, "own");
    const kept = readTheBooks(state, holder.id, offices, "kept");
    const all = readTheBooks(state, holder.id, offices, "all");
    expect(own.accounts.length).toBeGreaterThan(0);
    for (const account of own.accounts) {
      expect(state.material.accounts.find((candidate) => candidate.id === account.id)!.owner).toEqual({ kind: "character", id: holder.id });
    }
    const ownIds = new Set(own.accounts.map((account) => account.id));
    expect(kept.accounts.some((account) => ownIds.has(account.id))).toBe(false);
    expect(own.accounts.length + kept.accounts.length).toBe(all.accounts.length);
    expect(own.theirGovernments).toBe(false);
    expect(own.lands).toBeNull();
    expect(own.pressure).toBeNull();
  });
});
