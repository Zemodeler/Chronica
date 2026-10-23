import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { landCargoes } from "./cargoes";
import { runDeterministicTick } from "./tick";

/**
 * No news fact told a merchant that a cargo sailed or landed, a man's own cargo could not be lost at sea, a venture closed in silence, and the customs and the
 * changers' cut came off his sale without a word. Now he is told, in his own line.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (seed = "told"): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "manius-curius" }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory(seed), gameId: "game-told", playerCharacterId: "manius-curius", creditAccepted: true,
});
const rich = (): WorldState => {
  const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: 5_000_000 } : account)) } };
};
const open = (world: WorldState, localId: string) => applyDeltas(world, [WorldDeltaSchema.parse({
  op: "trade_venture_open", localId, title: `Grain ${localId}`, ownerCharacterRef: "manius-curius", fromProvinceId: PUNIC_IDS.rome, toProvinceId: PUNIC_IDS.syracuse, band: "slight", paidFromAccountRef: "curius-purse", reason: "A cargo.",
})], context(localId));

describe("the merchant is told his cargo sailed", () => {
  it("is told it sailed, and where from", () => {
    const result = open(rich(), "one");
    const sailed = result.factProposals.find((fact) => fact.kind === "cargo_sailed");
    expect(sailed?.summary).toMatch(/your cargo, worth \d+, sailed from .* for /);
    expect(sailed?.knownToRefs?.some((ref) => ref.id === "manius-curius")).toBe(true);
  });

  it("is told what it landed for, the percent over its cost, and what the crew and the customs took", () => {
    const opened = open(rich(), "two");
    const venture = opened.world.material.ventures[0]!;
    const landed = runDeterministicTick({ world: opened.world, toDay: venture.cargo!.arrivesAtStep + 1, ids: createIdFactory("landing"), warfare: definition.warfare });
    const sold = landed.factProposals.find((fact) => fact.kind === "cargo_sold");
    if (sold !== undefined) {
      expect(sold.summary).toMatch(/Your cargo landed at .*sold for \d+, against the \d+ it cost \(\d+% over\)/);
      expect(sold.summary).toMatch(/went to the crew/);
    } else {
      // Or the ship was lost on the way, and he is told that instead.
      expect(landed.factProposals.some((fact) => fact.kind === "cargo_lost" && /lost at sea/.test(fact.summary))).toBe(true);
    }
  });

  it("is told when his cargo is lost at sea", () => {
    let lost: string | null = null;
    for (let n = 0; n < 400 && lost === null; n += 1) {
      const opened = open(rich(), `lost${n}`);
      const venture = opened.world.material.ventures[0]!;
      const landed = landCargoes(opened.world, venture.cargo!.arrivesAtStep + 1, createIdFactory(`lost-${n}`), definition.warfare);
      const fact = landed.facts.find((candidate) => candidate.kind === "cargo_lost");
      if (fact !== undefined) lost = fact.summary;
    }
    expect(lost).not.toBeNull();
    expect(lost).toMatch(/lost at sea with the ship/);
  });

  it("is warned that closing a venture pays nothing", () => {
    const opened = open(rich(), "three");
    const closed = applyDeltas(opened.world, [WorldDeltaSchema.parse({ op: "trade_venture_close", ventureRef: opened.world.material.ventures[0]!.id, reason: "He winds it up." })], context());
    expect(closed.factProposals.find((fact) => fact.kind === "venture_closed")?.summary).toMatch(/pays nothing back/);
  });
});
