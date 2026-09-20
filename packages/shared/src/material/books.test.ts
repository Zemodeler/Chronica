import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readTheBooks } from "./books";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

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
});
