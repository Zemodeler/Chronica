import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { ensureConstitutions } from "./constitutions";
import type { SimModelPort } from "./ports";
import { keepOutOfOtherStatesBooks } from "./the-orchestrator-keeps-out";

/**
 * The orchestrator's world acts do not carry another state's routine government (docs/economy.md, "What the model is left to"): the
 * prompt said so, and now the engine holds it. The player's own power, a power he rules and a man who serves him by an order are his
 * to move; the world's other business (war, a letter, a thread) is untouched.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const fresh = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
const world = fresh();
const parse = (raw: Record<string, unknown>) => WorldDeltaSchema.parse(raw);
const ask = { playerId: "gaius-genucius", playerPolityId: "rome" };

const taxOf = (polityId: string) => parse({ op: "tax_policy_set", scope: "polity", polityId, regime: "tithe", rateBps: 1_400, reason: "test" });
const chestOf = (polityId: string): string => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!.id;
const aProvinceOf = (polityId: string): string => world.map.provinces.find((province) => province.controllerPolityId === polityId)!.id;
const pact = (a: string, b: string) => parse({ op: "agreement_open", localId: "pact", kind: "trade_pact", polityId: a, otherPolityId: b, terms: "x", visibility: "public", reason: "test" });

describe("the world's acts and another state's books", () => {
  it("sets aside the tax, the coin, a state's loan and a pact between powers that are not the player's", () => {
    const syracuseCoin = parse({ op: "coinage_debase", coinageId: "syracusan-drachma", stepBps: -1_500, reason: "test" });
    const loan = parse({ op: "loan_open", localId: "l", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: chestOf("syracuse"), principal: 5_000, interestBps: 200, cadenceDays: 30, terms: "x", reason: "test" });
    const out = keepOutOfOtherStatesBooks(world, [taxOf("syracuse"), syracuseCoin, loan, pact("syracuse", "carthage")], ask);
    expect(out.setAside.map((entry) => entry.delta.op)).toEqual(["tax_policy_set", "coinage_debase", "loan_open", "agreement_open"]);
    expect(out.setAside[0]!.reason).toMatch(/officers keep it/);
    expect(out.kept).toEqual([]);
  });

  it("lets the player's own power, a power he rules and a pact that touches his stand", () => {
    expect(keepOutOfOtherStatesBooks(world, [taxOf("rome")], ask).kept).toHaveLength(1);
    expect(keepOutOfOtherStatesBooks(world, [pact("rome", "syracuse")], ask).kept).toHaveLength(1);
    // A king who is the player rules his own, and a power he is the head of, whatever his polity id says.
    const hieron = { playerId: "hieron-ii", playerPolityId: "syracuse" };
    expect(keepOutOfOtherStatesBooks(world, [taxOf("syracuse")], hieron).kept).toHaveLength(1);
    expect(keepOutOfOtherStatesBooks(world, [taxOf("carthage")], hieron).setAside).toHaveLength(1);
    const rules = { playerId: "hieron-ii", playerPolityId: "rome" };
    expect(readDepartments(world).rulers("syracuse").some((ruler) => ruler.id === "hieron-ii")).toBe(true);
    expect(keepOutOfOtherStatesBooks(world, [taxOf("syracuse")], rules).kept).toHaveLength(1);
  });

  it("lets a man the player has put an order to keep the menu of his own books", () => {
    const hieron = world.characters.find((character) => character.id === "hieron-ii")!;
    const venture = parse({ op: "trade_venture_open", localId: "v", title: "Ship", ownerCharacterRef: hieron.id, fromProvinceId: aProvinceOf("syracuse"), toProvinceId: aProvinceOf("syracuse"), band: "slight", paidFromAccountRef: hieron.personalAccountId, reason: "test" });
    expect(keepOutOfOtherStatesBooks(world, [venture], ask).setAside).toHaveLength(1);
    const attempt = { id: "att-1", issuerRef: { kind: "character", id: ask.playerId }, recipientRef: { kind: "character", id: hieron.id }, status: "accepted" };
    const ordered = { ...world, orderAttempts: [...world.orderAttempts, attempt as unknown as WorldState["orderAttempts"][number]] };
    expect(keepOutOfOtherStatesBooks(ordered, [venture], ask).kept).toHaveLength(1);
  });

  it("leaves the world's other business alone: war, a letter, a thread, a bribe", () => {
    const war = parse({ op: "agreement_open", localId: "w", kind: "war", polityId: "syracuse", otherPolityId: "carthage", terms: "War.", visibility: "public", reason: "test" });
    const bribe = parse({ op: "money_transfer", fromAccountRef: chestOf("syracuse"), toAccountRef: chestOf("carthage"), amount: 10, reason: "a bribe" });
    const out = keepOutOfOtherStatesBooks(world, [war, bribe, taxOf("syracuse")], ask);
    expect(out.kept).toEqual([war, bribe]);
    expect(out.setAside).toHaveLength(1);
  });

  it("is held in a burst: the world's tax for another state is counted under the officers, the player's own is not", async () => {
    const port: SimModelPort = {
      complete(operation) {
        if (operation === "simulate_orchestrate") {
          return Promise.resolve(JSON.stringify({
            intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue",
            worldDeltas: [
              { op: "tax_policy_set", scope: "polity", polityId: "carthage", regime: "tithe", rateBps: 1_600, reason: "more silver" },
              { op: "tax_policy_set", scope: "polity", polityId: "rome", regime: "tithe", rateBps: 1_000, reason: "the player's own" },
            ],
          }));
        }
        return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
      },
    };
    const result = await runSimulationBurst({
      world: fresh(), clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
      burstId: "books", gameId: "books", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Let a month pass.", spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    const officers = result.skipped.filter((entry) => entry.stage === "officers");
    expect(officers).toHaveLength(1);
    expect(officers[0]!.reason).toMatch(/not the world's to settle for another state/);
  }, 300_000);
});
