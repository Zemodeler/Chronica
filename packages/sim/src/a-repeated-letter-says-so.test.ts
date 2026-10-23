import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Loop 2, burst 7: Hanno wrote again, in the same words, to Messana and Syracuse after both had refused him by silence. The letters
 * were suppressed as unchanged offers and the order said "nothing came of it" and no more. The suppression stands; it now says so.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, now: WorldState["instant"], tag: string): ApplyContext => ({
  now, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`again-${tag}`), gameId: "game-again", playerCharacterId: "hanno-carthage",
});
const letter = (localId: string): WorldDelta => ({
  op: "diplomatic_message_send", localId, kind: "alliance_offer", fromPolityId: "carthage", fromCharacterRef: "hanno-carthage", toPolityId: "mamertines", toCharacterRef: "mamertine-spokesman",
  subject: "Carthage's protection for Messana", terms: "Carthage takes Messana under her protection against Syracuse.", replyWithinDays: 45, inReplyToRef: null, visibility: "public", proposes: ["protectorate"], reason: "Hanno offers.",
});

describe("a letter written again in the same words", () => {
  it("is not sent again, and the writer is told why", () => {
    const start = world();
    const first = applyDeltas(start, [letter("first")], context("hanno-carthage", start.instant, "a"));
    expect(first.rejected).toEqual([]);
    const again = applyDeltas(first.world, [letter("second")], context("hanno-carthage", start.instant, "b"));
    expect(again.world.diplomacy).toHaveLength(first.world.diplomacy.length);
    const told = again.factProposals.find((fact) => fact.kind === "letter_not_resent");
    expect(told).toBeDefined();
    expect(told!.summary).toMatch(/already written .* not sent again/);
    expect(told!.visibility).toBe("polity");
  });
});
