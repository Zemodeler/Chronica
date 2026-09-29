import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readYourStanding } from "./standing";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const seatedConsul = (state: WorldState): string =>
  state.material.officeSeats.find((s) => s.status === "held" && s.holderCharacterId !== null)!.holderCharacterId!;

describe("what a person holds", () => {
  it("tells an officeholder what their office actually lets them do", () => {
    // describeAuthority has produced these phrases since the authority index
    // was written and only ever written them into prompts.
    const state = world();
    const standing = readYourStanding(state, seatedConsul(state), offices);
    expect(standing.powers.length).toBeGreaterThan(0);
    expect(standing.seats.length).toBeGreaterThan(0);
    expect(standing.nothing).toBeNull();
  });

  it("never hands the player an entity id", () => {
    const state = world();
    const standing = readYourStanding(state, seatedConsul(state), offices);
    const said = [
      ...standing.powers.flatMap((p) => [...p.powers, p.domain, p.overLabel]),
      ...standing.seats.flatMap((s) => [s.officeLabel, s.polityLabel, s.termLabel ?? ""]),
      ...standing.holdings.flatMap((h) => [h.title, h.territoryLabel, h.controlLabel, h.incomeLabel]),
    ];
    for (const line of said) {
      expect(line).not.toMatch(/\[[a-z0-9-]+\]/);
      expect(line).not.toMatch(/\d+\s*\/\s*100\b/);
    }
  });

  it("says so when a scenario has not written you into the seat you claim", () => {
    // The councils seat almost everyone the scenario names; take them out, so
    // somebody holds nothing at all.
    const opening = world();
    const state: WorldState = { ...opening, material: { ...opening.material, officeSeats: opening.material.officeSeats.filter((s) => s.officeId !== "roman-senator") } };
    const citizen = state.characters.find(
      (c) => c.alive && !state.material.officeSeats.some((s) => s.status === "held" && s.holderCharacterId === c.id),
    )!;
    const office = offices[0]!;
    const claiming: WorldState = {
      ...state,
      characters: state.characters.map((c) => (c.id === citizen.id ? { ...c, officeId: office.id } : c)),
    };
    const seat = readYourStanding(claiming, citizen.id, offices).seats.find((s) => s.claimed);
    expect(seat).toBeDefined();
    expect(seat!.termLabel).toContain("has not written you into this seat");
  });

  it("gives a man with nothing a true answer rather than an empty panel", () => {
    // Manius Curius holds no office and commands nothing; take away the Sabine
    // farm the scenario gives him and he has nothing written down at all.
    const opening = world();
    const state: WorldState = {
      ...opening,
      material: {
        ...opening.material,
        holdings: opening.material.holdings.filter((h) => h.legalHolderCharacterId !== "manius-curius"),
        // And his seat in the Senate.
        officeSeats: opening.material.officeSeats.filter((s) => s.holderCharacterId !== "manius-curius"),
      },
    };
    const standing = readYourStanding(state, "manius-curius", offices);
    expect(standing.nothing).toBe("You hold no office, and no land that anyone has written down.");
  });

  it("does not call spending your own money a power", () => {
    // Every character carries a fiscal grant over their own purse. Counted as
    // authority it would tell a man with nothing that he holds one power.
    const state = world();
    const commander = state.characters.find((c) => state.material.forces.some((f) => f.commanderCharacterId === c.id))!;
    const powers = readYourStanding(state, commander.id, offices).powers;
    expect(powers.length).toBeGreaterThan(0);
    for (const power of powers) expect(power.overLabel).not.toContain("'s purse");
  });

  it("still counts authority over somebody else's treasury", () => {
    const state = world();
    const powers = readYourStanding(state, seatedConsul(state), offices).powers;
    expect(powers.some((p) => p.overLabel.includes("treasury"))).toBe(true);
  });

  it("holds land in words, never in basis points", () => {
    const state = world();
    const holder = state.material.holdings[0];
    if (holder === undefined) return;
    const shaky: WorldState = {
      ...state,
      material: {
        ...state.material,
        holdings: state.material.holdings.map((h) => (h.id === holder.id ? { ...h, physicalControlBps: 1_000 } : h)),
      },
    };
    const read = readYourStanding(shaky, holder.legalHolderCharacterId, offices).holdings.find((h) => h.id === holder.id);
    expect(read?.controlLabel).toBe("yours in law only");
  });

  it("counts what arrives from a holding, not what is levied", () => {
    const state = world();
    const source = state.material.incomeSources.find((s) => s.originKind === "holding");
    if (source === undefined) return;
    const holding = state.material.holdings.find((h) => h.id === source.originId);
    if (holding === undefined) return;
    const income = (bps: number): string =>
      readYourStanding(
        { ...state, material: { ...state.material, incomeSources: state.material.incomeSources.map((s) => (s.id === source.id ? { ...s, collectionRateBps: bps } : s)) } },
        holding.legalHolderCharacterId, offices,
      ).holdings.find((h) => h.id === holding.id)!.incomeLabel;
    expect(income(0)).toBe("Nothing is coming in from it.");
    expect(income(10_000)).not.toBe(income(5_000));
  });
});
