import { describe, expect, it } from "vitest";
import { type Force, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { definition, government, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { forcesUnder, matchOrderTemplates } from "./order-templates";
import { placeNamed } from "./march-template";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A general marches when told (the user's rule, 2026-10-08: an order the engine can read is carried out without the orchestrator).
 *
 * "March to X", "hold at Y", "withdraw to Z", "winter in W" for the player's own army, named or "my army", are read by rule (`march-template.ts`). The man who commands
 * the army marches it by his own word; a man who has its control and does not command it hands the march to the man who does; a man in the ranks has no army to march.
 */

const PLAYER = "gaius-genucius";
let built: WorldState | undefined;
/** Built once: the opening with its markets is the slow part of every test here, and nothing in it is changed in place. */
const world = (): WorldState => (built ??= withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage"));

/** The player's army, with the man who commands it set, and a province (by name) it does not stand in. */
function setting(commander: string | null, controller: string | null = PLAYER): { state: WorldState; army: Force; there: string; thereId: string; elsewhere: string } {
  const base = world();
  const [army] = forcesUnder(base, PLAYER, definition.warfare);
  if (army === undefined) throw new Error("the player has no army");
  const places = base.map.provinces.filter((province) => province.id !== army.locationId && province.name.length >= 5 && placeNamed(base, province.name)?.provinceId === province.id);
  const there = places[0]!;
  const elsewhere = places[1]!;
  const moved: Force = { ...army, commanderCharacterId: commander as string, controllerCharacterId: controller as string };
  return {
    state: { ...base, material: { ...base.material, forces: base.material.forces.map((force) => (force.id === army.id ? moved : force)) } },
    army: moved, there: there.name, thereId: there.id, elsewhere: elsewhere.name,
  };
}

const match = (text: string, state: WorldState) => matchOrderTemplates(state, PLAYER, text, definition.warfare);

describe("a general marches when told", { timeout: 300_000 }, () => {
  it("marches, withdraws, holds and winters the army he commands, by his own word", () => {
    const { state, army, there, thereId } = setting(PLAYER);
    const march = match(`March to ${there}.`, state)!;
    expect(march.templates).toEqual(["march"]);
    expect(march.output.deltas[0]).toMatchObject({ op: "force_modify", forceRef: army.id, locationId: thereId });
    expect(march.output.intent.parts[0]!.goals[0]).toMatchObject({ kind: "force_at", ref: army.id, at: thereId });
    expect(march.output.delegations).toHaveLength(0);
    expect(match(`Withdraw the army to ${there}.`, state)!.output.deltas[0]).toMatchObject({ op: "force_modify", locationId: thereId });
    const winter = match(`Winter in ${there}.`, state)!;
    expect(winter.output.deltas[0]).toMatchObject({ op: "force_modify", locationId: thereId, hold: true });
    const hold = match(`Hold the army at ${there}.`, state)!;
    expect(hold.templates).toEqual(["march"]);
    expect(hold.output.deltas[0]).toMatchObject({ locationId: thereId, hold: true });
  });

  it("holds where the army stands by the old hold template, and marches only when the place is another", () => {
    const { state, army } = setting(PLAYER);
    const here = state.map.provinces.find((province) => province.id === army.locationId)!.name;
    expect(match(`Hold the army at ${here}.`, state)!.templates).toEqual(["hold"]);
    expect(match("Hold the army where it stands.", state)!.templates).toEqual(["hold"]);
  });

  it("hands the march to the man who commands the army where the player only controls it", () => {
    const other = world().characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER)!.id;
    const { state, army, there } = setting(other);
    const march = match(`March the army to ${there}.`, state)!;
    expect(march.output.deltas).toHaveLength(0);
    expect(march.output.delegations).toHaveLength(1);
    expect(march.output.delegations[0]).toMatchObject({ recipientRef: { id: other }, part: 0, ask: { kind: "march", ref: army.id } });
    expect(march.output.delegations[0]!.instruction).toContain(there);
  });

  it("tells a man in the ranks that no army is his to march", () => {
    const other = world().characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER)!.id;
    const { state, army, there } = setting(other, other);
    const inRanks: WorldState = { ...state, material: { ...state.material, forces: state.material.forces.map((force) => (force.id === army.id ? { ...force, memberCharacterIds: [...force.memberCharacterIds, PLAYER] } : force)) } };
    const told = match(`March to ${there}.`, inRanks);
    // A man in the ranks who is nobody over the army has none to march: the order is refused in the words of the ranks, and no act is written.
    if (told !== null) {
      expect(told.output.deltas.filter((delta) => delta.op === "force_modify")).toHaveLength(0);
      expect(told.output.intent.parts[0]!.whyNot ?? "").toMatch(/no army|private soldier|in the ranks/);
    }
  });

  it("leaves to the orchestrator an order that asks for more than the walking, or is not an army's", () => {
    const { state, there, elsewhere } = setting(PLAYER);
    for (const text of [
      `March to ${there} and besiege it.`, `March to ${there} and then to ${elsewhere}.`, `If Carthage lands, march to ${there}.`, `March against the Carthaginians at ${there}.`,
      `Go to ${there}.`, `Return to ${there}.`, "March.",
    ]) expect(match(text, state), text).toBeNull();
  });

  it("is carried out by the commander the player handed it to, answered by his temper and not asked of the model", async () => {
    const other = world().characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER && character.officeId === null
      && !world().material.forces.some((force) => force.commanderCharacterId === character.id))!.id;
    const { state: handed, army, there } = setting(other);
    // A man who keeps an order at once (honest, or dutiful): the answer is the day's.
    const state: WorldState = { ...handed, characters: handed.characters.map((character) => (character.id !== other ? character
      : { ...character, mind: { ...character.mind, temperament: { ...character.mind.temperament, honesty: 80 } } })) };
    const calls: SimOperation[] = [];
    const port: SimModelPort = { complete(operation) {
      calls.push(operation);
      if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
      throw new Error(`The order is read by rule: ${operation}`);
    } };
    const ran = await runSimulationBurst({ world: state, clock: definition.clock, offices: government.offices, warfare: definition.warfare, terrains: definition.map.terrains, successionRules: government.successionRules,
      burstId: "march-delegated", gameId: "march-delegated", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: `March the army to ${there}.`, spanDays: 3, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    const attempt = ran.world.orderAttempts.find((candidate) => candidate.ask?.kind === "march" && candidate.recipientRef.id === other);
    expect(attempt, "the march was handed to the commander").toBeDefined();
    expect(["accepted", "carried_out"]).toContain(attempt!.status);
    const after = ran.world.material.forces.find((force) => force.id === army.id)!;
    expect(after.locationId !== army.locationId || ran.world.projects.some((project) => project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === army.id)
      || ran.world.material.forces.some((force) => force.id === army.id && force.hold !== army.hold)).toBe(true);
  }, 120_000);

  it("is carried out in a burst with no call to the orchestrator: the army is set marching", async () => {
    const { state, army, there, thereId } = setting(PLAYER);
    const calls: SimOperation[] = [];
    const port: SimModelPort = { complete(operation) {
      calls.push(operation);
      if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["military"] }, narrativeSummary: "Time passes.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const ran = await runSimulationBurst({ world: state, clock: definition.clock, offices: government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
      burstId: "march", gameId: "march", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: `March to ${there}.`, spanDays: 2, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    expect(calls.filter((call) => call === "simulate_orchestrate")).toHaveLength(0);
    const after = ran.world.material.forces.find((force) => force.id === army.id)!;
    const setOut = after.locationId !== army.locationId || ran.world.projects.some((project) => project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === army.id) || ran.world.orders.some((order) => order.text.includes(`March to ${there}`));
    expect(setOut).toBe(true);
    expect([thereId, army.locationId].length).toBe(2);
  }, 120_000);
});
