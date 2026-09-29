import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, FIRST_PUNIC_IDS } from "@chronica/db";
import {
  FIELD_OPTION_PREFIX,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  fieldChoiceOf,
  fieldOptionId,
  type BattleResult,
  type FieldChoice,
  type WorldState,
} from "@chronica/shared";
import { divertFieldFates, fieldDecision, openFieldPerils, resolveFieldPerils } from "./field-perils";
import { runSimulationBurst } from "./burst";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * "Encircled, he tried to break out, and an arrow took him."
 *
 * A consul killed in a battle used to be killed in the same sentence that
 * reported the battle. Now the battle leaves him surrounded, the report ends
 * on the question of what he does, and the next report says how it ended --
 * for the player by his answer, for everybody else by their nature.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const PLAYER = "marcus-atilius";
const PROVINCE = FIRST_PUNIC_IDS.messana;

function lostBattle(battleId: string, outcome: "killed" | "captured"): BattleResult {
  return {
    battleId,
    participantIds: ["legio-i", "carthaginian-army"],
    attackerForceIds: ["legio-i"],
    outcome: "defender_victory",
    commanderChanges: [{ forceId: "legio-i", characterId: PLAYER, outcome }],
  } as unknown as BattleResult;
}

/** The player surrounded (or cut off) after a lost battle, as the battle leaves him. */
function surrounded(battleId: string, outcome: "killed" | "captured" = "killed"): WorldState {
  const start = world();
  const diverted = divertFieldFates(start, lostBattle(battleId, outcome), [], PLAYER);
  return openFieldPerils(start, diverted.plights, { battleId, provinceId: PROVINCE, provinceName: "Messana" }, start.elapsedStep).world;
}

/** The first battle id, of a few, whose plight ends as asked when met with this choice. */
function battleWhere(choice: FieldChoice, wanted: string, outcome: "killed" | "captured" = "killed"): string {
  for (let index = 0; index < 60; index += 1) {
    const battleId = `battle-${index}`;
    const ended = resolveFieldPerils({ world: surrounded(battleId, outcome), atStep: 1, playerCharacterId: PLAYER, answeredOptionId: fieldOptionId(choice) });
    if (ended.world.fieldPerils[0]!.outcome === wanted) return battleId;
  }
  throw new Error(`no battle ended ${wanted} for ${choice}`);
}

describe("a death in the field that matters", () => {
  it("is not decided by the battle: the man is left surrounded instead", () => {
    const start = world();
    const diverted = divertFieldFates(start, lostBattle("b1", "killed"), [], PLAYER);
    expect(diverted.plights).toEqual([{ characterId: PLAYER, plight: "encircled", ownForceId: "legio-i", enemyForceId: "carthaginian-army" }]);
    expect(diverted.result.commanderChanges[0]!.outcome).toBe("unharmed");

    const opened = openFieldPerils(start, diverted.plights, { battleId: "b1", provinceId: PROVINCE, provinceName: "Messana" }, 0);
    const marcus = opened.world.characters.find((character) => character.id === PLAYER)!;
    expect(marcus.alive).toBe(true);
    expect(marcus.disqualifyingStatuses).toContain("encircled");
    expect(opened.world.fieldPerils).toHaveLength(1);
    expect(opened.facts[0]!.kind).toBe("commander_encircled");
    expect(opened.facts[0]!.significance).toBeGreaterThanOrEqual(90);
    expect(opened.world.storylines.some((storyline) => storyline.seedKey === `field:${PLAYER}` && storyline.phase === "crisis")).toBe(true);
  });

  it("asks the player what he does, with four choices whose ids name them", () => {
    const peril = surrounded("b2").fieldPerils[0]!;
    const decision = fieldDecision(surrounded("b2"), peril);
    expect(decision.options.map((option) => fieldChoiceOf(option.id))).toEqual(["break_out", "hold", "yield", "stand"]);
    expect(decision.options.every((option) => option.id.startsWith(FIELD_OPTION_PREFIX))).toBe(true);
    expect(decision.prompt).toContain("surrounded");
  });

  it("tells a death in detail, and the heir takes the house", () => {
    const battleId = battleWhere("break_out", "killed");
    const ended = resolveFieldPerils({ world: surrounded(battleId), atStep: 1, playerCharacterId: PLAYER, answeredOptionId: fieldOptionId("break_out") });
    const marcus = ended.world.characters.find((character) => character.id === PLAYER)!;
    expect(marcus.alive).toBe(false);
    expect(ended.died).toEqual([PLAYER]);
    const death = ended.facts.find((fact) => fact.kind === "killed_in_the_field")!;
    expect(death.summary).toContain("rode at the thinnest part");
    expect(death.summary.length).toBeGreaterThan(200);
    // What he said as he went, tied to the fact of how it ended.
    expect(ended.utterances[0]!.line.length).toBeGreaterThan(10);
    expect(ended.utterances[0]!.factLocalId).toBe(death.localId);
    // And what he left.
    expect(ended.facts.some((fact) => fact.kind === "inheritance" && fact.summary.includes("Marcus Atilius the Younger"))).toBe(true);
    expect(ended.world.material.accounts.find((account) => account.id === "marcus-purse")!.status).toBe("locked");
    expect(ended.world.fieldPerils[0]!.resolvedAtStep).toBe(1);
  });

  it("takes a general prisoner: out of command, in the enemy's camp, and the slice says so", () => {
    const battleId = battleWhere("yield", "captured", "captured");
    const ended = resolveFieldPerils({ world: surrounded(battleId, "captured"), atStep: 1, playerCharacterId: PLAYER, answeredOptionId: fieldOptionId("yield") });
    const marcus = ended.world.characters.find((character) => character.id === PLAYER)!;
    expect(marcus.alive).toBe(true);
    expect(marcus.disqualifyingStatuses).toContain("captured");
    expect(marcus.disqualifyingStatuses).not.toContain("cut_off");
    const legion = ended.world.material.forces.find((force) => force.id === "legio-i")!;
    expect(legion.commanderCharacterId).not.toBe(PLAYER);
    const enemy = ended.world.material.forces.find((force) => force.id === "carthaginian-army")!;
    expect(marcus.locationProvinceId).toBe(enemy.locationId);
    expect(ended.facts.find((fact) => fact.kind === "commander_captured")!.summary).toContain("prisoner");

    const slice = renderWorldSlice(buildWorldSlice({
      world: ended.world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "Write to the Senate.",
      facts: [], dueEvents: [], pendingEvents: [],
    }));
    expect(slice).toContain("A PRISONER");
  });

  it("ends everybody else's plight by their own nature, and says so in the slice while it stands", () => {
    const start = world();
    const result = {
      ...lostBattle("b3", "killed"),
      outcome: "attacker_victory",
      commanderChanges: [{ forceId: "carthaginian-army", characterId: "hanno", outcome: "captured" }],
    } as unknown as BattleResult;
    const diverted = divertFieldFates(start, result, [], PLAYER);
    expect(diverted.plights[0]!.characterId).toBe("hanno");
    const opened = openFieldPerils(start, diverted.plights, { battleId: "b3", provinceId: PROVINCE, provinceName: "Messana" }, 0).world;

    const hanno = buildWorldSlice({
      world: opened, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      actorRef: { kind: "character", id: "hanno" }, actorPolityId: "carthage", orderText: "Hold.",
      facts: [], dueEvents: [], pendingEvents: [],
    });
    expect(renderWorldSlice(hanno)).toContain("CUT OFF");

    const ended = resolveFieldPerils({ world: opened, atStep: 1, playerCharacterId: PLAYER });
    expect(ended.world.fieldPerils[0]!.resolvedAtStep).toBe(1);
    expect(ended.world.fieldPerils[0]!.choice).not.toBeNull();
    expect(ended.facts).not.toHaveLength(0);
  });

  it("goes the same way on a replay", () => {
    const once = resolveFieldPerils({ world: surrounded("replay"), atStep: 1, playerCharacterId: PLAYER, answeredOptionId: fieldOptionId("hold") });
    const again = resolveFieldPerils({ world: surrounded("replay"), atStep: 1, playerCharacterId: PLAYER, answeredOptionId: fieldOptionId("hold") });
    expect(again.facts).toEqual(once.facts);
    expect(again.utterances).toEqual(once.utterances);
  });
});

describe("the report after the player was surrounded", () => {
  function port(): SimModelPort & { calls: SimOperation[] } {
    const calls: SimOperation[] = [];
    return { calls, complete(operation) { calls.push(operation); return Promise.reject(new Error(`unscripted ${operation}`)); } };
  }

  it("opens on how it ended, and when it ended in his death, asks only who follows him", async () => {
    const battleId = battleWhere("stand", "killed");
    const ask = port();
    const result = await runSimulationBurst({
      world: surrounded(battleId),
      clock: definition.clock,
      offices: definition.government.offices,
      warfare: definition.warfare,
      burstId: "after",
      gameId: "game-1",
      actorRef: { kind: "character", id: PLAYER },
      actorPolityId: "rome",
      orderText: "The ruler has answered: Stand and be remembered.",
      answeredDecision: { prompt: "What do you do?", label: "Stand and be remembered", summary: "Refuse terms.", optionId: fieldOptionId("stand"), predecessorId: PLAYER },
      knownFacts: [],
      queue: [],
      port: ask,
    });
    // A dead man gives no order: the world was never asked to carry one out.
    expect(ask.calls).not.toContain("simulate_orchestrate");
    expect(result.newFacts.some((fact) => fact.kind === "killed_in_the_field")).toBe(true);
    expect(result.utterances.some((line) => line.actorRef.id === PLAYER)).toBe(true);
    expect(result.playerDecision?.options[0]!.id).toBe("succeed-marcus-atilius-minor");
    expect(result.playerDecision?.options[0]!.summary).toContain("inherits");
  });
});
