import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { answerEngagement, engagementDecision } from "./engagement-decisions";

/**
 * Armies do not fight until an order says so, and once they do they fight
 * until one side is beaten (docs/plans/battles-that-last.md). Legio I stood
 * beside Hieron's army for a season and nothing happened; then, for a day,
 * any two enemies fought the moment they met, whatever their orders said.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = "punic-italy-latium";

/** Hieron's army brought to Latium, beside the consul's, with the two powers at war. */
function facing(options: { readonly hieronCaution?: number; readonly syracusans?: number } = {}): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const moved: WorldState = {
    ...opening,
    characters: opening.characters.map((character) => (character.id === "hieron-ii" && options.hieronCaution !== undefined
      ? { ...character, mind: { ...character.mind, temperament: { ...character.mind.temperament, caution: options.hieronCaution } } }
      : character)),
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force) => (force.id !== "syracusan-army" ? force : {
        ...force,
        locationId: LATIUM,
        ...(options.syracusans === undefined ? {} : { personnel: [{ ...force.personnel[0]!, fit: options.syracusans }], authorizedStrength: options.syracusans }),
      })),
    },
  };
  return as("gaius-genucius", [{
    op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "syracuse", terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Messana.",
  }], moved).world;
}

function as(actor: string, written: readonly unknown[], state: WorldState) {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`engage-${actor}-${state.elapsedStep}`), gameId: "game-engage", orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
}

const attack = (state: WorldState, posture = "offer_battle") => as("gaius-genucius", [{
  op: "force_engage", forceRef: "roman-field-army", targetForceRef: "syracusan-army", posture, tactic: null, reason: "Bring Hieron to battle.",
}], state);

function days(state: WorldState, count: number): { world: WorldState; kinds: string[] } {
  let world = state;
  const kinds: string[] = [];
  for (let step = 0; step < count; step += 1) {
    const day = world.elapsedStep + 1;
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: day }, toDay: day, ids: createIdFactory(`engage-tick-${day}`), warfare: definition.warfare });
    world = ticked.world;
    kinds.push(...ticked.factProposals.map((fact) => fact.kind));
  }
  return { world, kinds };
}

const fitOf = (world: WorldState, id: string): number => world.material.forces.find((force) => force.id === id)!.personnel.reduce((sum, group) => sum + group.fit, 0);
const where = (world: WorldState, id: string): string => world.material.forces.find((force) => force.id === id)!.locationId;

describe("enemy armies on the same ground", () => {
  it("face each other, and nobody is hurt, until an order is given", () => {
    const start = facing();
    const before = fitOf(start, "syracusan-army");
    const after = days(start, 3);
    expect(after.kinds.filter((kind) => kind === "armies_facing")).toHaveLength(1);
    expect(after.kinds).not.toContain("battle");
    expect(fitOf(after.world, "syracusan-army")).toBe(before);
    expect(after.world.engagements.filter((engagement) => engagement.status === "facing")).toHaveLength(1);
  });
});

describe("an order to attack", () => {
  it("opens an engagement that a cautious defender meets by keeping to his camp", () => {
    const ordered = attack(facing({ hieronCaution: 70 }));
    expect(ordered.rejected).toEqual([]);
    const engagement = ordered.world.engagements.find((candidate) => candidate.status === "open")!;
    expect(engagement).toMatchObject({ provinceId: LATIUM, rounds: 1, pitchedRounds: 0, seeking: "battle" });
    expect(ordered.world.engagements.some((candidate) => candidate.status === "facing")).toBe(false);
    expect(WorldStateSchema.safeParse(ordered.world).success).toBe(true);
  });

  it("goes on, a round a day, and ends only when one side is beaten or gone", () => {
    const ordered = attack(facing({ hieronCaution: 70 }));
    const later = days(ordered.world, 40);
    const engagement = later.world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement.status).toBe("ended");
    expect(engagement.winner).toBe("attacker");
    // Refusing day after day costs the men their heart: the camp is given up, or the battle taken.
    expect(later.kinds.some((kind) => kind === "skirmish")).toBe(true);
    expect(where(later.world, "syracusan-army") !== LATIUM || fitOf(later.world, "syracusan-army") < fitOf(ordered.world, "syracusan-army")).toBe(true);
  });

  it("is a pitched battle on the first day when the defender is a man to take it", () => {
    const ordered = attack(facing({ hieronCaution: 20 }));
    const engagement = ordered.world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement.pitchedRounds).toBe(1);
  });

  it("only harasses when it was not an order to bring on a battle", () => {
    const ordered = attack(facing({ hieronCaution: 20 }), "defend");
    const engagement = ordered.world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement).toMatchObject({ seeking: "harass", pitchedRounds: 0 });
  });

  it("finds a starving defender unable to refuse", () => {
    const hungry = facing({ hieronCaution: 90 });
    const starving: WorldState = { ...hungry, material: { ...hungry.material, forces: hungry.material.forces.map((force) => (force.id === "syracusan-army" ? { ...force, provisionStatus: "critical" as const } : force)) } };
    const engagement = attack(starving).world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement.pitchedRounds).toBe(1);
  });
});

describe("hold", () => {
  const hold = (state: WorldState, value: boolean) => as("gaius-genucius", [{ op: "force_modify", forceRef: "roman-field-army", hold: value, reason: "Hold." }], state).world;

  it("keeps an army from starting a battle, whoever orders it", () => {
    const refused = attack(hold(facing(), true));
    expect(refused.rejected[0]?.reason).toMatch(/orders to hold/);
    expect(attack(hold(hold(facing(), true), false)).rejected).toEqual([]);
  });

  it("breaks off a fight already begun, when the attackers are put on it", () => {
    const begun = attack(facing({ hieronCaution: 70 })).world;
    const held = days(hold(begun, true), 1);
    const engagement = held.world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement).toMatchObject({ status: "ended", endedBy: "broken_off", winner: null });
  });
});

describe("outnumbered three to one", () => {
  it("falls back without orders, if it has a road", () => {
    const ordered = attack(facing({ syracusans: 600 }));
    const engagement = ordered.world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement).toMatchObject({ status: "ended", endedBy: "withdrew", winner: "attacker" });
    expect(where(ordered.world, "syracusan-army")).not.toBe(LATIUM);
  });
});

describe("supply in the standoff", () => {
  const through = (world: WorldState, id: string): number => world.material.forces.find((force) => force.id === id)!.provisionedThroughStep;

  it("pens the side attacked in its camp, where the country no longer feeds it, while the attacker eats", () => {
    // Five days' bread each, and harried rather than offered battle, so the fight stays a standoff.
    const lean = facing({ hieronCaution: 70 });
    const shortOfBread: WorldState = { ...lean, material: { ...lean.material, forces: lean.material.forces.map((force) => ({ ...force, provisionedThroughStep: lean.elapsedStep + 5 })) } };
    const begun = attack(shortOfBread, "defend").world;
    const later = days(begun, 12);
    expect(later.world.engagements.find((engagement) => engagement.openedByForceId === "roman-field-army")?.status).toBe("open");
    // The consul's bread is renewed from his own country; Hieron's is not, and he goes short.
    expect(through(later.world, "roman-field-army")).toBeGreaterThan(begun.elapsedStep + 12);
    expect(through(later.world, "syracusan-army")).toBe(begun.elapsedStep + 5);
    expect(later.world.material.forces.find((force) => force.id === "syracusan-army")!.provisionStatus).not.toBe("provisioned");
  });

  it("feeds the winners on the camp the losers left", () => {
    const start = facing({ syracusans: 600 });
    const won = attack(start);
    expect(through(won.world, "roman-field-army")).toBeGreaterThanOrEqual(start.elapsedStep + 12);
    expect(won.world.material.forces.find((force) => force.id === "roman-field-army")!.provisionStatus).toBe("provisioned");
  });
});

describe("turning points", () => {
  // Hieron is the player here; the consul attacks him.
  const asNpc = (written: readonly unknown[], state: WorldState, player: string) => {
    const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
    return applyDeltas(state, deltas, {
      now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
      terrains: definition.map.terrains, ids: createIdFactory(`turn-${state.elapsedStep}`), gameId: "game-turn", orderDeltas: new Set(deltas), playerCharacterId: player,
    });
  };
  const offer = (state: WorldState) => asNpc([{ op: "force_engage", forceRef: "roman-field-army", targetForceRef: "syracusan-army", posture: "offer_battle", tactic: null, reason: "Battle." }], state, "hieron-ii");
  const tickAs = (state: WorldState, player: string) => {
    const day = state.elapsedStep + 1;
    return runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`turn-tick-${day}`), warfare: definition.warfare, playerCharacterId: player });
  };

  it("stops the player's fight on battle offered, and asks him", () => {
    const offered = offer(facing({ hieronCaution: 70 })).world;
    const engagement = offered.engagements.find((candidate) => candidate.status === "open")!;
    expect(engagement.awaiting?.kind).toBe("battle_offered");
    expect(engagement.rounds).toBe(0);
    const decision = engagementDecision(offered, "hieron-ii", definition.warfare)!;
    expect(decision.options.map((option) => option.label)).toEqual(["Come out and fight", "Keep to the camp", "Fall back by night"]);
    // Nothing is fought while it waits.
    const waited = tickAs(offered, "hieron-ii").world;
    expect(waited.engagements.find((candidate) => candidate.id === engagement.id)!.rounds).toBe(0);
  });

  it("fights the battle the day after he says to come out", () => {
    const offered = offer(facing({ hieronCaution: 70 })).world;
    const answered = answerEngagement(offered, "hieron-ii", "fight-fight", offered.elapsedStep + 1).world;
    const next = tickAs(answered, "hieron-ii").world;
    const engagement = next.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement.pitchedRounds).toBe(1);
  });

  it("keeps to the camp when he answers with an order instead", () => {
    const offered = offer(facing({ hieronCaution: 70 })).world;
    const answered = answerEngagement(offered, "hieron-ii", null, offered.elapsedStep + 1).world;
    const engagement = answered.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;
    expect(engagement).toMatchObject({ awaiting: null, playerStance: "refuse" });
    const next = tickAs(answered, "hieron-ii").world;
    expect(next.engagements.find((candidate) => candidate.id === engagement.id)!).toMatchObject({ pitchedRounds: 0, rounds: 1 });
  });

  it("slips away by night when he chooses to fall back", () => {
    const offered = offer(facing({ hieronCaution: 70 })).world;
    const answered = answerEngagement(offered, "hieron-ii", "fight-fall-back", offered.elapsedStep + 1);
    expect(where(answered.world, "syracusan-army")).not.toBe(LATIUM);
    expect(answered.facts[0]?.kind).toBe("force_withdrew");
  });

  it("names the NPC commander when battle is offered to him, so he is brought to decide", () => {
    const ordered = attack(facing({ hieronCaution: 70 }));
    expect(ordered.world.engagements.find((candidate) => candidate.status === "open")!.asked).toContain("npc:offered");
    const told = ordered.factProposals.find((fact) => fact.kind === "engagement_turning_point");
    expect(told?.affectedRefs).toContainEqual({ kind: "character", id: "hieron-ii" });
    expect(told?.summary).toMatch(/must choose/);
  });
});

describe("forcing the issue", () => {
  const manoeuvre = (state: WorldState, kind: string, force = "roman-field-army", target = "syracusan-army") => as("gaius-genucius", [{
    op: "force_engage", forceRef: force, targetForceRef: target, posture: "offer_battle", tactic: null, manoeuvre: kind, reason: "Force it.",
  }], state);
  const engagementOf = (world: WorldState) => world.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army")!;

  it("storms a camp that would not give battle", () => {
    const stormed = manoeuvre(facing({ hieronCaution: 90 }), "storm_camp");
    expect(engagementOf(stormed.world).pitchedRounds).toBe(1);
    expect(stormed.factProposals.some((fact) => fact.kind === "camp_stormed")).toBe(true);
    // The rampart was for that day only.
    expect(stormed.world.structures.some((structure) => structure.id.startsWith("rampart-"))).toBe(false);
  });

  it("attacks by night, and it either catches the camp unready or miscarries", () => {
    const night = manoeuvre(facing({ hieronCaution: 90 }), "night_attack");
    const told = night.factProposals.find((fact) => fact.kind === "night_attack")!;
    expect(told.summary).toMatch(/unready|miscarried/);
    expect(engagementOf(night.world).manoeuvre).toBeNull();
  });

  it("provokes: the country burns, the refusers lose heart faster, and their general his standing", () => {
    const start = facing({ hieronCaution: 90 });
    const plain = attack(start).world;
    const provoked = manoeuvre(start, "provoke").world;
    const morale = (world: WorldState) => world.material.forces.find((force) => force.id === "syracusan-army")!.moraleBps;
    const food = (world: WorldState) => world.material.provinceMaterial.find((row) => row.provinceId === LATIUM)!.foodSecurityBps;
    const standing = (world: WorldState) => world.characters.find((character) => character.id === "hieron-ii")!.prestigeBps;
    expect(morale(provoked)).toBeLessThan(morale(plain));
    expect(food(provoked)).toBeLessThan(food(plain));
    expect(standing(provoked)).toBeLessThan(standing(plain));
    expect(engagementOf(provoked).manoeuvre?.kind).toBe("provoke");
  });

  it("lures, and the bait is taken or not", () => {
    const lured = manoeuvre(facing({ hieronCaution: 10 }), "lure");
    expect(lured.factProposals.some((fact) => fact.kind === "engagement_turning_point" || fact.kind === "skirmish")).toBe(true);
  });

  it("slips away by night, ending the fight", () => {
    const begun = attack(facing({ hieronCaution: 90 })).world;
    const gone = as("hieron-ii", [{ op: "force_engage", forceRef: "syracusan-army", targetForceRef: "roman-field-army", posture: "avoid_battle", tactic: null, manoeuvre: "withdraw_by_night", reason: "Away." }], begun);
    expect(gone.rejected).toEqual([]);
    expect(engagementOf(gone.world)).toMatchObject({ status: "ended", endedBy: "withdrew", winner: "attacker" });
    expect(where(gone.world, "syracusan-army")).not.toBe(LATIUM);
  });
});

describe("standing by", () => {
  it("costs the commander who stood idle beside a battle his own side fought", () => {
    const start = facing({ hieronCaution: 10 });
    // A second Roman army on the same ground, under another man, not ordered in.
    const second = { ...start.material.forces.find((force) => force.id === "roman-field-army")!, id: "roman-second-army", name: "Second Roman army", commanderCharacterId: "gnaeus-cornelius", controllerCharacterId: "gnaeus-cornelius" };
    const withTwo: WorldState = { ...start, material: { ...start.material, forces: [...start.material.forces, second] } };
    const before = withTwo.characters.find((character) => character.id === "gnaeus-cornelius")!.prestigeBps;
    const fought = attack(withTwo);
    expect(fought.factProposals.some((fact) => fact.kind === "stood_idle")).toBe(true);
    expect(fought.world.characters.find((character) => character.id === "gnaeus-cornelius")!.prestigeBps).toBeLessThan(before);
  });
});

describe("at sea", () => {
  it("is one day's battle between fleets, as it was", () => {
    const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const hulls = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!;
    const met: WorldState = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "syracusan-squadron" ? { ...force, locationId: hulls.locationId } : force)) } };
    const fought = as("gaius-genucius", [{ op: "force_engage", forceRef: "allied-greek-hulls", targetForceRef: "syracusan-squadron", posture: "offer_battle", tactic: null, reason: "At them." }], met);
    expect(fought.rejected).toEqual([]);
    expect(fought.factProposals.some((fact) => fact.kind === "battle")).toBe(true);
    expect(fought.world.engagements.filter((engagement) => engagement.status === "open")).toHaveLength(0);
  });
});
