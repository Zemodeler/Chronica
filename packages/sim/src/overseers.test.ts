import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, ordersUnderWay, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { assignOverseers } from "./overseers";
import { fillAppointments } from "./appointments";

/**
 * "Make it so I don't have to micromanage every project": a consul who
 * ordered a fleet had to name a man over it, or the fleet was finished into
 * nothing -- a force with no commander was never launched -- and an office of
 * admiral the Republic made stood empty for good.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "gaius-genucius";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const asPlayer = (written: readonly unknown[], state: WorldState = opening()) => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: PLAYER }, offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("overseer"), gameId: "game-overseer", orderDeltas: new Set(deltas), playerCharacterId: PLAYER,
  };
  return applyDeltas(state, deltas, context);
};
const tickTo = (state: WorldState, day: number) =>
  runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`overseer-tick-${day}`), warfare: definition.warfare, government: definition.government, playerCharacterId: PLAYER });
const army = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;

const fleetOrder = (state: WorldState) => [{
  op: "project_create", localId: "keels", kind: "shipbuilding", label: "A Roman fleet", sponsorRef: { kind: "character", id: PLAYER },
  fundingAccountRef: "rome-treasury", milestones: [{ label: "Keels laid", dueInDays: 10, costAmount: 100 }],
  completionOutcome: { kind: "force", label: "The Roman fleet", amount: 60, provinceId: army(state).locationId, polityId: null, commanderCharacterRef: null, categoryId: "warship" },
  reason: "Rome needs ships.",
}];

describe("a public work the player ordered", () => {
  it("is put in the hands of one of the Republic's officers, not the player's", () => {
    const begun = asPlayer(fleetOrder(opening()));
    expect(begun.rejected).toEqual([]);
    const project = begun.world.projects.find((candidate) => candidate.label === "A Roman fleet")!;
    expect(project.overseerCharacterId).toBeTruthy();
    expect(project.overseerCharacterId).not.toBe(PLAYER);
    const overseer = begun.world.characters.find((character) => character.id === project.overseerCharacterId)!;
    expect(overseer.polityId).toBe("rome");
    expect(WorldStateSchema.safeParse(begun.world).success).toBe(true);
  });

  it("launches its ships under the man who built them when the order named no commander", () => {
    const begun = asPlayer(fleetOrder(opening()));
    const project = begun.world.projects.find((candidate) => candidate.label === "A Roman fleet")!;
    let world = begun.world;
    for (let day = 1; day <= 12; day += 1) world = tickTo(world, day).world;
    const fleet = world.material.forces.find((force) => force.name === "The Roman fleet");
    expect(fleet).toBeDefined();
    expect(fleet).toMatchObject({ polityId: "rome", commanderCharacterId: project.overseerCharacterId });
    expect(fleet!.personnel[0]?.categoryId).toBe("warship");
  }, 30_000);

  it("says whose hands it is in, among the orders under way", () => {
    const begun = asPlayer(fleetOrder(opening()));
    const project = begun.world.projects.find((candidate) => candidate.label === "A Roman fleet")!;
    const name = begun.world.characters.find((character) => character.id === project.overseerCharacterId)!.name;
    const line = ordersUnderWay(begun.world, PLAYER, offices).find((item) => item.key === `project:${project.id}`);
    expect(line?.detail).toContain(`In ${name}'s hands.`);
  });

  it("passes to another man when its overseer dies", () => {
    const begun = asPlayer(fleetOrder(opening()));
    const project = begun.world.projects.find((candidate) => candidate.label === "A Roman fleet")!;
    const dead = project.overseerCharacterId!;
    const bereaved: WorldState = { ...begun.world, characters: begun.world.characters.map((character) => (character.id === dead ? { ...character, alive: false, diedAtStep: 0 } : character)) };
    const after = assignOverseers(bereaved, PLAYER).projects.find((candidate) => candidate.id === project.id)!;
    expect(after.overseerCharacterId).toBeTruthy();
    expect([dead, PLAYER]).not.toContain(after.overseerCharacterId);
  });
});

describe("a post made and left empty", () => {
  // What a measure making an office leaves behind (`enact.ts`, `departments.ts`): the office, and one seat never filled.
  const withAdmiral = (): WorldState => {
    const state = opening();
    return {
      ...state,
      offices: [...state.offices, {
        id: "roman-admiral", label: "Admiral of the Roman fleet", polityId: "rome", authorisedActionIds: [], sponsorableCategories: [], treasuryAccountId: null,
        treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "appointed-by-the-government", eligibilityRequirementIds: [],
      }],
      material: {
        ...state.material,
        officeSeats: [...state.material.officeSeats, {
          id: "roman-admiral-seat-0", officeId: "roman-admiral", seatIndex: 0, holderCharacterId: null, status: "vacant", vacancyCause: "never_filled",
          termStartedAtStep: null, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
        }],
      },
    };
  };

  it("is filled by the Republic with one of its own, never the player", () => {
    const made = { world: withAdmiral() };
    const seat = made.world.material.officeSeats.find((candidate) => candidate.officeId === "roman-admiral");
    expect(seat?.status).toBe("vacant");
    const filled = fillAppointments({ world: made.world, government: definition.government, toDay: 1, playerCharacterId: PLAYER });
    const now = filled.world.material.officeSeats.find((candidate) => candidate.officeId === "roman-admiral")!;
    expect(now.status).toBe("held");
    expect(now.holderCharacterId).not.toBe(PLAYER);
    expect(filled.world.characters.find((character) => character.id === now.holderCharacterId)?.polityId).toBe("rome");
    expect(filled.facts[0]?.summary).toMatch(/Admiral of the Roman fleet/);
    expect(WorldStateSchema.safeParse(filled.world).success).toBe(true);
  });

  it("is given a seat and a holder when it was made with none", () => {
    // "Admiral of the fleet" is made by need with no seat at all (`society.ts`).
    const state = opening();
    const made: WorldState = { ...state, offices: [...state.offices, {
      id: "rome:admiral", label: "Admiral of the fleet of the Roman Republic", polityId: "rome", kind: "magistracy", rank: 2, authorisedActionIds: [], sponsorableCategories: [],
      treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "rome:by-need:succession", eligibilityRequirementIds: [],
    }] };
    const filled = fillAppointments({ world: made, government: definition.government, toDay: 1, playerCharacterId: PLAYER });
    const seat = filled.world.material.officeSeats.find((candidate) => candidate.officeId === "rome:admiral");
    expect(seat?.status).toBe("held");
    expect(seat?.holderCharacterId).not.toBe(PLAYER);
    expect(WorldStateSchema.safeParse(filled.world).success).toBe(true);
  });

  it("but a post the scenario keeps empty for emergencies stays empty", () => {
    const state = opening();
    const filled = fillAppointments({ world: state, government: definition.government, toDay: 1, playerCharacterId: PLAYER });
    const dictator = filled.world.material.officeSeats.filter((seat) => seat.officeId === "roman-dictator");
    expect(dictator.every((seat) => seat.status === "vacant")).toBe(true);
  });
});
