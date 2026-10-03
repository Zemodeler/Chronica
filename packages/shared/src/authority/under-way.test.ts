import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { ordersUnderWay } from "./under-way";
import { ProjectSchema } from "../world/project";
import { GenericEntitySchema } from "../world/generic-entity";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const consul = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};

const project = (state: WorldState, sponsorId: string, overrides: Record<string, unknown> = {}) => ProjectSchema.parse({
  id: "levy", kind: "recruitment", sponsorEntityRef: { kind: "character", id: sponsorId }, label: "Raising the First New Legion",
  status: "in_progress",
  milestones: [{ id: "enrol", label: "Enrolment in Latium", requiredAtElapsedOffset: 18, costAmount: 0, status: "pending" }],
  startedAtStep: state.elapsedStep,
  ...overrides,
});

describe("what the player's orders are doing", () => {
  it("shows a project of theirs with its next step and when", () => {
    const state = world();
    const player = consul(state);
    const items = ordersUnderWay({ ...state, projects: [project(state, player.id)] }, player.id, offices, clock);
    const levy = items.find((item) => item.key === "project:levy");
    expect(levy).toMatchObject({ label: "Raising the First New Legion", stalled: false });
    expect(levy!.detail).toBe("Next: enrolment in Latium, in 18 days.");
  });

  it("marks one whose step is overdue as wanting the player's word", () => {
    const state = world();
    const player = consul(state);
    // A month on, and the enrolment due after eighteen days has not happened.
    const later: WorldState = { ...state, elapsedStep: state.elapsedStep + 30, instant: { ...state.instant, day: state.instant.day + 30 } };
    const levy = ordersUnderWay({ ...later, projects: [project(state, player.id)] }, player.id, offices, clock).find((item) => item.key === "project:levy")!;
    expect(levy.stalled).toBe(true);
    expect(levy.detail).toContain("overdue");
  });

  it("marks one whose money will not cover the next step", () => {
    const state = world();
    const player = consul(state);
    const costly = project(state, player.id, {
      milestones: [{ id: "enrol", label: "Enrolment in Latium", requiredAtElapsedOffset: 18, costAmount: 500, status: "pending" }],
    });
    const short: WorldState = { ...state, material: { ...state.material, accounts: state.material.accounts.map((account) => account.owner.kind === "character" && account.owner.id === player.id ? { ...account, balance: 0 } : account) } };
    const levy = ordersUnderWay({ ...short, projects: [costly] }, player.id, offices, clock).find((item) => item.key === "project:levy")!;
    expect(levy.stalled).toBe(true);
    expect(levy.detail).toContain("will not cover");
  });

  it("shows what an order set them to doing", () => {
    const state = world();
    const player = consul(state);
    const pursuit = GenericEntitySchema.parse({
      id: "pursuit-1", kind: "pursuit", label: "Defending Sicily", ownerRef: { kind: "character", id: player.id },
      attributes: { order: "Defend Sicily.", sinceDay: state.elapsedStep }, provinceId: null, createdAtStep: state.elapsedStep,
    });
    const items = ordersUnderWay({ ...state, genericEntities: [...state.genericEntities, pursuit] }, player.id, offices, clock);
    expect(items.find((item) => item.key === "pursuit:pursuit-1")?.label).toBe("Defending Sicily");
  });

  it("does not show a man another man's undertakings", () => {
    const state = world();
    const player = consul(state);
    const stranger = state.characters.find((character) => character.polityId !== player.polityId)!;
    const theirs = project(state, stranger.id, { id: "their-levy", label: "A levy in secret" });
    const items = ordersUnderWay({ ...state, projects: [theirs] }, player.id, offices, clock);
    expect(items.some((item) => item.label.includes("secret"))).toBe(false);
  });
});


it("shows a crossing and its assembly as one operation", () => {
  const state = world(); const player = consul(state);
  const army = state.material.forces.find((force) => force.id === "roman-field-army")!;
  const fleet = state.material.forces.find((force) => force.id === "allied-greek-hulls")!;
  const shore = army.locationId;
  const crossing = project(state, player.id, { id: "crossing", kind: "crossing", label: "Cross to Messana", completionOutcome: { kind: "force_move", label: "Arrives", forceId: army.id, provinceId: "sic-q659z", fleetIds: [fleet.id], embarkProvinceId: shore } });
  const march = project(state, player.id, { id: "assembly-march", kind: "march", completionOutcome: { kind: "force_move", label: "Assemble", forceId: army.id, provinceId: shore } });
  const sailing = project(state, player.id, { id: "assembly-sailing", kind: "sailing", completionOutcome: { kind: "force_move", label: "Assemble", forceId: fleet.id, provinceId: shore } });
  const items = ordersUnderWay({ ...state, projects: [crossing, march, sailing] }, player.id, offices, clock);
  expect(items.filter((item) => item.kind === "march")).toHaveLength(1);
  expect(items.find((item) => item.key === "march:crossing")?.detail).toContain("assembling");
});
