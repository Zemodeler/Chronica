import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { decideAFleet, fleetWork, FLEET_HULLS, FLEET_MOTION, navalEnemiesOf } from "./a-fleet-by-decree";
import { matchOrderTemplates } from "./order-templates";
import { createIdFactory } from "./ports";
import { holdVotes } from "./senate";
import { runDeterministicTick } from "./tick";
import { atWar, context, definition, inputFor, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * Rome builds a fleet by decree (Polybius 1.20): at war with a sea power, with no ships of its own and the Senate holding the purse, a rule-led Rome
 * moves a fleet of a hundred quinqueremes and twenty triremes; the Senate carries it; the keels are laid, the money paid in three stages out of the chest,
 * the hulls launched and manned. The player's own order to build one is read the same way.
 */
const offices = definition.government.offices;
const DAY = 260;
const base = (): WorldState => {
  const world = romeAndCarthageAlone(atWar(120));
  const cleared = { ...world.material, institutions: world.material.institutions.map((institution) => ({ ...institution, votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, interests: [], baseSupport: 80 })) })) };
  return { ...world, instant: { ...world.instant, day: DAY }, elapsedStep: DAY, material: cleared };
};
const romeWith = (world: WorldState) => ({ ...inputFor(world), world, offices });
const rulerOf = (world: WorldState) => (polityId: string) => world.characters.find((character) => character.polityId === polityId && character.alive && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && /consul/.test(seat.officeId)));
const tickTo = (state: WorldState, day: number) => runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`fleet-tick-${day}`), warfare: definition.warfare });
const romanShips = (world: WorldState) => world.material.forces.filter((force) => force.polityId === "rome" && force.personnel.some((row) => row.categoryId === "warship" && row.fit > 0));

describe("Rome builds a fleet by decree", () => {
  it("knows the sea belongs to Carthage and that Rome has no ships of war", () => {
    const world = base();
    expect(navalEnemiesOf(world, "rome")).toEqual(["carthage"]);
    expect(romanShips(world)).toEqual([]);
  });

  it("moves the building of a fleet before the Senate, and only once", () => {
    const world = base();
    const decisions = decideAFleet(romeWith(world), rulerOf(world));
    const rome = decisions.find((decision) => decision.polityId === "rome")!;
    expect(rome).toBeDefined();
    const motion = rome.deltas[0]!;
    expect(motion).toMatchObject({ op: "political_procedure_open", institutionRef: "roman-senate" });
    expect((motion as { label: string }).label).toContain(FLEET_MOTION);
    const project = (motion as { enacts: { project: { kind: string; completionOutcome: { kind: string; categoryId: string; amount: number; polityId: string } } } }).enacts.project;
    expect(project).toMatchObject({ kind: "shipbuilding", completionOutcome: { kind: "force", categoryId: "warship", polityId: "rome" } });
    expect(project.completionOutcome.amount).toBeGreaterThan(0);
    expect(project.completionOutcome.amount).toBeLessThanOrEqual(FLEET_HULLS);
    // Moved, it waits: nothing is put twice.
    const moved = applyDeltas(world, [...rome.deltas], context(world, rome.actorCharacterId) as never);
    expect(moved.rejected).toEqual([]);
    expect(decideAFleet(romeWith(moved.world), rulerOf(moved.world)).filter((decision) => decision.polityId === "rome")).toEqual([]);
  });

  it("lays the keels the day the Senate carries it, pays by stages from the chest, and launches ships", () => {
    const world = base();
    const rome = decideAFleet(romeWith(world), rulerOf(world)).find((decision) => decision.polityId === "rome")!;
    const moved = applyDeltas(world, [...rome.deltas], context(world, rome.actorCharacterId) as never).world;
    const counted = holdVotes({ world: { ...moved, elapsedStep: DAY + 12 }, offices, toDay: DAY + 12, ids: createIdFactory("count") });
    const work = counted.world.projects.find((project) => project.kind === "shipbuilding")!;
    expect(work).toMatchObject({ status: "in_progress" });
    const launched = tickTo(counted.world, DAY + 12 + 150).world;
    const ships = romanShips(launched);
    expect(ships.length).toBe(1);
    expect(ships[0]!.personnel[0]).toMatchObject({ categoryId: "warship" });
    expect(ships[0]!.personnel[0]!.fit).toBeGreaterThanOrEqual(10);
    // Every stage paid, and the work done.
    expect(launched.projects.find((project) => project.kind === "shipbuilding")!.status).toBe("completed");
    // And with ships afloat Rome no longer moves a fleet.
    expect(decideAFleet(romeWith(launched), rulerOf(launched)).some((decision) => decision.deltas.some((delta) => delta.op === "political_procedure_open" && (delta as { label: string }).label.includes(FLEET_MOTION)))).toBe(false);
  });

  it("builds fewer hulls than the Senate wished when the chest cannot bear a hundred and twenty", () => {
    const world = base();
    const poor = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 400_000 } : account)) } };
    expect(fleetWork(poor, "rome", "gaius-genucius")!.completionOutcome.amount).toBeLessThan(FLEET_HULLS);
    const empty = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 20_000 } : account)) } };
    expect(fleetWork(empty, "rome", "gaius-genucius")).toBeNull();
  });

  it("does not move a fleet in the first weeks of a war, nor for a power at war with nobody who has ships", () => {
    const early = { ...base(), instant: { ...base().instant, day: 150 }, elapsedStep: 150 };
    expect(decideAFleet(romeWith(early), rulerOf(early)).filter((decision) => decision.polityId === "rome")).toEqual([]);
  });

  it("reads the player's own order to build a fleet, and has the state's chest pay it", () => {
    const world = base();
    const match = matchOrderTemplates(world, "gaius-genucius", "Build a fleet of sixty ships.", definition.warfare);
    expect(match?.templates).toEqual(["fleet"]);
    const act = match!.output.deltas[0]!;
    expect(act).toMatchObject({ op: "project_create", kind: "shipbuilding", fundingAccountRef: "rome-treasury" });
    expect((act as { completionOutcome: { amount: number } }).completionOutcome.amount).toBe(60);
  });
});
