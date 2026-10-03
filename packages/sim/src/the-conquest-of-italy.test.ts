import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  alliesLedBy,
  ensureProvinceMaterial,
  openWar,
  orderPartStatus,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { normalizeRefs } from "./apply/normalize-refs";
import { runSimulationBurst } from "./burst";
import { namedDestination } from "./mission-intent";
import { endPolity } from "./polity-end";
import { createIdFactory, type SimModelPort, type SimOperation } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The hand-played conquest of Messana and Italy (eval-out/hand-conquer,
 * 2026-10-01): an army sent to the place it was told to leave men holding, a
 * legion marched to where it already stood, a siege laid and reported as
 * nothing, a storm with no op to order it, letters to the cavalry commander,
 * armies of absorbed peoples left under the men who had ruled them, and the
 * same skirmish told twenty-one times in a turn.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const CONSUL = "gaius-genucius";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const atMessana = (world: WorldState = opening()): WorldState => ({
  ...world,
  material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)) },
});
const context: ApplyContext = {
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: CONSUL }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory("italy"), gameId: "game-italy", playerCharacterId: CONSUL,
};
const WAR: WorldDelta = {
  op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "mamertines",
  terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "They refused to surrender.",
};

function scripted(script: Partial<Record<SimOperation, string[]>>): SimModelPort {
  const remaining = { ...script };
  return { complete: (operation) => Promise.resolve(remaining[operation]?.shift() ?? JSON.stringify({ actors: [] })) };
}

describe("where an army is sent", () => {
  it("does not take the town men are left to hold for the place the army goes", () => {
    // T10: the field army's march was bound for Messana, where it already stood.
    expect(namedDestination(opening(), "March the Roman field army back from Sicily to Picenum, leaving a garrison of 1000 men to hold Messana.")).toBeNull();
    expect(namedDestination(opening(), "March the army to Messana.")).toBe(MESSANA);
  });

  it("does not read the place a march sets out from as where it is going", () => {
    // T11 and T13: Legio II "marched from Rome to the Praetuttian coast" and arrived in Latium.
    const march = WorldDeltaSchema.parse({
      op: "project_create", localId: "legio_ii", kind: "march", label: "Legio II marches from Rome to the Praetuttian coast",
      sponsorRef: { kind: "character", id: CONSUL }, fundingAccountRef: "rome-treasury",
      milestones: [{ label: "Legio II leaves Rome by the Via Salaria", dueInDays: 5 }],
      completionOutcome: { kind: "force_move", label: "Legio II reaches the coast", provinceId: PUNIC_IDS.asculum, forceRef: "roman-field-army" },
      reason: "The road from Rome to the Adriatic coast over the passes.",
    });
    const normalized = normalizeRefs(march, opening());
    expect(normalized.op === "project_create" && normalized.completionOutcome?.provinceId).toBe(PUNIC_IDS.asculum);
  });
});

describe("an order to storm", () => {
  it("assaults the walls of a siege already laid, and carries them or is thrown back", () => {
    const laid = applyDeltas(atMessana(), [WAR, { op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", reason: "Invest the city." }], context);
    expect(laid.rejected).toEqual([]);
    const stormed = applyDeltas(laid.world, [{ op: "siege_lay", localId: "storm", forceRef: "roman-field-army", settlementId: "settlement-messana", assault: true, reason: "Storm it now." }], context);
    expect(stormed.rejected).toEqual([]);
    expect(stormed.factProposals.some((fact) => /stormed the walls of Messana|carried the walls of Messana/.test(fact.summary))).toBe(true);
    expect(stormed.world.sieges).toHaveLength(1);
  });
});

describe("an order's ledger", () => {
  it("calls a siege laid under way, not nothing", async () => {
    const answer = JSON.stringify({
      intent: { summary: "War and siege.", parts: [
        { said: "Declare the war on the Mamertines in Rome's name.", acts: [0], goals: [], factLocalIds: [] },
        { said: "Lay siege to Messana with the whole army: lines on the land side, rams and towers.", acts: [1], goals: [], factLocalIds: [] },
      ] },
      narrativeSummary: "War, and the siege.", frictions: [], worldDeltas: [],
      deltas: [WAR, { op: "siege_lay", localId: "siege", forceRef: "roman-field-army", settlementId: "settlement-messana", works: ["lines"], reason: "Invest." }],
      facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
    });
    const result = await runSimulationBurst({
      world: atMessana(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "b1", gameId: "game-italy",
      actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText: "Declare war on the Mamertines and lay siege to Messana.",
      knownFacts: [], queue: [], port: scripted({ simulate_orchestrate: [answer] }), narratorSeeds: [], spanDays: 3,
    });
    const siegePart = result.world.orders.at(-1)!.parts[1]!;
    expect(siegePart.workRefs.some((ref) => ref.kind === "siege")).toBe(true);
    expect(orderPartStatus(result.world, siegePart)).toBe("under_way");
  });
});

describe("a people taken in", () => {
  const withWar = (world: WorldState): WorldState => ({ ...world, polityAgreements: openWar(world.polityAgreements, { id: "war-m", polityId: "rome", otherPolityId: "mamertines", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." }) });

  it("puts its army in the victor's hands, and not under the man who would restore it", () => {
    const ended = endPolity(opening(), "mamertines", "absorbed", "rome", 0);
    const restorer = ended.world.characters.find((character) => character.ambitions.some((ambition) => ambition.id === "restore-mamertines"));
    const garrison = ended.world.material.forces.find((force) => force.id === "mamertine-garrison")!;
    expect(garrison.polityId).toBe("rome");
    const controller = ended.world.characters.find((character) => character.id === garrison.controllerCharacterId);
    expect(controller?.polityId).toBe("rome");
    expect(controller?.ambitions.some((ambition) => ambition.id === "restore-mamertines")).toBe(false);
    expect(garrison.commanderCharacterId).not.toBe(restorer?.id);
  });

  it("tells a union asked for and given as a union, and a surrender after a war as a surrender", () => {
    const joined = endPolity(opening(), "mamertines", "absorbed", "rome", 0, true);
    expect(joined.facts[0]!.summary).toMatch(/by its own consent/);
    const beaten = endPolity(withWar(opening()), "mamertines", "absorbed", "rome", 0);
    expect(beaten.facts[0]!.summary).toMatch(/gave itself up/);
  });

  it("drops what its men were offered as its men", () => {
    const world = opening();
    const mamertine = world.characters.find((character) => character.polityId === "mamertines" && character.alive)!;
    const pressed: WorldState = { ...world, characterPressures: [...world.characterPressures, {
      ...(world.characterPressures[0] ?? {}),
      id: `opening:carthage:conquest:spring:${mamertine.id}`, characterId: mamertine.id, kind: "opportunity", intensity: 55, label: "Somewhere lies in Mamertine hands.",
    } as WorldState["characterPressures"][number]] };
    const ended = endPolity(pressed, "mamertines", "absorbed", "rome", 0);
    expect(ended.world.characterPressures.some((pressure) => pressure.characterId === mamertine.id && pressure.id.startsWith("opening:"))).toBe(false);
  });
});

describe("an ally called with an army already afoot", () => {
  it("answers with that army rather than levying the same men twice", () => {
    const seen = runDeterministicTick({ world: opening(), toDay: 1, ids: createIdFactory("afoot-1"), warfare: definition.warfare }).world;
    const ally = alliesLedBy(seen.polityAgreements, "rome").find((candidate) => seen.material.forces.some((force) => force.polityId === candidate))
      ?? alliesLedBy(seen.polityAgreements, "rome")[0]!;
    const home = seen.map.provinces.find((province) => province.controllerPolityId === ally)!.id;
    const levy = { ...seen.material.forces.find((force) => force.id === "roman-field-army")!, id: "ally-levy", name: "The ally's own levy", polityId: ally, locationId: home };
    const armed: WorldState = { ...seen, material: { ...seen.material, forces: [...seen.material.forces.filter((force) => force.polityId !== ally), levy] } };
    const atWar: WorldState = { ...armed, polityAgreements: openWar(armed.polityAgreements, { id: "war-c", polityId: "rome", otherPolityId: "carthage", terms: "War.", atStep: 1, sourceMessageId: null, reason: "War." }) };
    const ticked = runDeterministicTick({ world: atWar, toDay: 2, ids: createIdFactory("afoot-2"), warfare: definition.warfare });
    expect(ticked.world.material.forces.filter((force) => force.polityId === ally).map((force) => force.id)).toEqual(["ally-levy"]);
  });
});
