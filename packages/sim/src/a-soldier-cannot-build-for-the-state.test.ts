import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { definition, government } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { matchOrderTemplates } from "./order-templates";
import { chestOfPower } from "./supply-plan";
import type { SimModelPort } from "./ports";

/**
 * "Build a depot at Rhegium", said by a private soldier, was built at Rome out
 * of the state's chest and logged "done, beyond his authority". A man with no
 * charge cannot raise works at the state's cost.
 */

const CONSUL = "gaius-genucius";
const world = (): WorldState => stockedWorld(150, 2.2, [], 3_000_000);
const aPrivateMan = (w: WorldState): string => w.characters.find((c) => c.alive && c.polityId === "rome" && !w.material.officeSeats.some((s) => s.holderCharacterId === c.id && s.status === "held") && !w.material.forces.some((f) => f.commanderCharacterId === c.id))!.id;
const chestBalance = (w: WorldState): number => w.material.accounts.find((a) => a.id === chestOfPower(w, "rome"))!.balance;

describe("a man with no charge", () => {
  it("is told, in the words of the age, that the chest is not his to open", () => {
    const w = world();
    const match = matchOrderTemplates(w, aPrivateMan(w), "Build a depot at Rhegium.", definition.warfare);
    expect(match).not.toBeNull();
    expect(match!.output.deltas).toEqual([]);
    expect(match!.output.intent.parts[0]!.whyNot).toMatch(/holds no charge in Roman Republic.*public chest/);
  });

  it("is not the consul, who may be weighed for it", () => {
    const w = world();
    const here = matchOrderTemplates(w, CONSUL, "Build a depot at Rhegium.", definition.warfare);
    expect(here?.output.deltas.map((d) => d.op)).toEqual(["project_create"]);
  });

  it("builds nothing and spends nothing when a soldier says it in a burst", async () => {
    const w = world();
    const soldier = aPrivateMan(w);
    const port: SimModelPort = { complete: (operation) => (operation === "simulate_cognition" ? Promise.resolve('{"actors":[]}') : Promise.reject(new Error(`nobody is asked: ${operation}`))) };
    const result = await runSimulationBurst({
      world: w, clock: definition.clock, offices: government.offices, warfare: definition.warfare, terrains: definition.map.terrains, successionRules: government.successionRules,
      burstId: "soldier", gameId: "soldier", actorRef: { kind: "character", id: soldier }, actorPolityId: "rome", orderText: "Build a depot.", spanDays: 3, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    expect(result.world.projects.some((p) => p.kind === "depot")).toBe(false);
    expect(chestBalance(result.world)).toBeGreaterThanOrEqual(chestBalance(w) - 1);
  }, 120_000);
});
