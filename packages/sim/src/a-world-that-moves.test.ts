import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { CharacterKnowledgebaseSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, materializePlayerCharacter, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstResult } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A world that moves without the player (docs/plans/a-living-world.md §2).
 *
 * Two hand runs, a year and three years long, found a world in which nothing
 * happened that the player had not started: every war in the soldier's world
 * file was Rome's, and the observer's grain merchant watched a year go by in
 * which no power away from the Messana crisis did anything. Here the model
 * never acts at all -- every person it is asked about answers "nothing" --
 * and the powers still make their own moves, by rule.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

/** A model that waits for the player and lets everybody else do nothing. */
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") {
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    }
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

/** A farmer's son levied into the Roman field army: he holds no decision of Rome's. */
const LEGIONARY = "declared-legionary";
const aLegionary = (): WorldState => materializePlayerCharacter(
  WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), LEGIONARY,
  CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: LEGIONARY, gameId: "a-world-that-moves", canonicalName: "Titus Vettius", nickname: null, birthYearApprox: -295, deathYearApprox: null,
    origin: "invented", period: "264 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year.", notableEvents: [], role: "Legionary of the Roman army, a spearman of the hastati",
    authority: [], socioEconomicClass: "Plebeian", startingMoney: 40,
    skills: { martial: 45, intrigue: 20, learning: 15, piety: 40, stewardship: 20, diplomacy: 20, body: 60, subSkills: {} }, skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      { name: "Gnaeus Vettius", relationship: "brother", historical: false, notes: "Too young for the levy.", kind: "person", category: "family", familyRole: "sibling" },
      { name: "Aulus", relationship: "tent-mate", historical: false, notes: "Serves beside him.", kind: "person", category: "other", familyRole: null },
      { name: "The centurion", relationship: "his officer", historical: false, notes: "Hard, but fair.", kind: "person", category: "other", familyRole: null },
    ], confirmedByPlayer: true, confirmationDraft: null,
  }),
  definition.government,
);

async function months(count: number, who: { start?: WorldState; actor?: string; polity?: string } = {}): Promise<{ world: WorldState; results: BurstResult[] }> {
  let world = ensureProvinceMaterial(who.start ?? WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const results: BurstResult[] = [];
  for (let month = 0; month < count; month += 1) {
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
      burstId: `month-${month}`, gameId: "a-world-that-moves", actorRef: { kind: "character", id: who.actor ?? "gaius-genucius" }, actorPolityId: who.polity ?? "rome",
      orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    results.push(result);
    world = result.world;
  }
  return { world, results };
}

describe("a world that moves", { timeout: 600_000 }, () => {
  it("makes its own wars, alliances and campaigns away from the player, by rule", async () => {
    const { world } = await months(8);
    const log = world.statecraft.log;
    // Something happened, and it was not Rome's doing: Rome is the consul's, one of its two rulers, so what it does is his word
    // and not the rules' (his colleague does not declare wars over his head).
    expect(log.length).toBeGreaterThan(0);
    // A Roman's own plot is his, not the rules moving Rome (`villainy.ts`).
    expect(log.some((entry) => entry.polityId === "rome" && entry.act !== "plot" && entry.act !== "purge")).toBe(false);
    const opened = world.polityAgreements.filter((agreement) => agreement.sinceStep > 0 && agreement.polityId !== "rome" && agreement.otherPolityId !== "rome"
      && (agreement.kind === "war" || agreement.kind === "alliance"));
    expect(opened.length).toBeGreaterThan(0);
    // Every move is written down with its reason.
    for (const entry of log) expect(entry.why.length).toBeGreaterThan(5);
  });

  it("moves the player's own power by rule when he is a man in the ranks, who rules nothing", async () => {
    const { world } = await months(10, { start: aLegionary(), actor: LEGIONARY, polity: "rome" });
    const rome = world.statecraft.log.filter((entry) => entry.polityId === "rome" && entry.act !== "plot" && entry.act !== "purge");
    expect(rome.length).toBeGreaterThan(0);
    for (const entry of rome) expect(entry.why.length).toBeGreaterThan(5);
  });

  it("leaves a power alone that the player rules", async () => {
    const { world } = await months(8, { actor: "hieron-ii", polity: "syracuse" });
    expect(world.statecraft.log.some((entry) => entry.polityId === "syracuse" && entry.act !== "plot" && entry.act !== "purge")).toBe(false);
  });
});
