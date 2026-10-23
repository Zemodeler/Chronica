import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Loop 2, burst 13: Messana accepted Carthage's offer of a protectorate and the agreement stood in the world, but the burst told
 * only `letter_answered` at weight 35 (the same was true of an alliance in round 5). A pact made is news, as a trade pact is.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, now: WorldState["instant"]): ApplyContext => ({
  now, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`pact-${actor}`), gameId: "game-pact", playerCharacterId: "hanno-carthage",
});

  it("tells a truce made by letter too", () => {
    const start = world();
    const sent: WorldDelta = {
      op: "diplomatic_message_send", localId: "offer", kind: "peace_offer", fromPolityId: "carthage", fromCharacterRef: "hanno-carthage", toPolityId: "syracuse", toCharacterRef: "hieron-ii",
      subject: "A year of truce", terms: "Syracuse and Carthage keep the peace for a year.", replyWithinDays: 45, inReplyToRef: null, visibility: "public", proposes: ["truce"], forDays: 365, reason: "Hanno offers.",
    };
    const asked = applyDeltas(start, [sent], context("hanno-carthage", start.instant));
    expect(asked.rejected).toEqual([]);
    const letter = asked.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(asked.world, { day: letter.deliveredOnDay ?? 0, minute: 540 });
    const answered = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: letter.id, answer: "accepted", answerText: "Syracuse will keep the peace for a year.", agreementKind: "truce", reason: "Hieron agrees.",
    }], context("hieron-ii", arrived.instant));
    expect(answered.rejected).toEqual([]);
    expect(answered.world.polityAgreements.some((agreement) => agreement.kind === "truce" && agreement.status === "active")).toBe(true);
    expect(answered.factProposals.find((fact) => fact.kind === "treaty_made")?.summary).toMatch(/have made a truce/);
  });

describe("a pact made by letter", () => {
  it("is told as a fact of its own, not only as an answered letter", () => {
    const start = world();
    const sent: WorldDelta = {
      op: "diplomatic_message_send", localId: "offer", kind: "alliance_offer", fromPolityId: "carthage", fromCharacterRef: "hanno-carthage", toPolityId: "mamertines", toCharacterRef: "mamertine-spokesman",
      subject: "Carthage's protection for Messana", terms: "Carthage takes Messana under her protection against Syracuse.", replyWithinDays: 45, inReplyToRef: null, visibility: "public", proposes: ["protectorate"], reason: "Hanno offers.",
    };
    const asked = applyDeltas(start, [sent], context("hanno-carthage", start.instant));
    expect(asked.rejected).toEqual([]);
    const letter = asked.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(asked.world, { day: letter.deliveredOnDay ?? 0, minute: 540 });
    const answered = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: letter.id, answer: "accepted", answerText: "Messana will accept Carthage's protection.", agreementKind: "protectorate", reason: "Statius takes the shield.",
    }], context("mamertine-spokesman", arrived.instant));
    expect(answered.rejected).toEqual([]);
    expect(answered.world.polityAgreements.some((agreement) => agreement.kind === "protectorate" && agreement.status === "active")).toBe(true);
    const told = answered.factProposals.find((fact) => fact.kind === "treaty_made");
    expect(told).toBeDefined();
    expect(told!.summary).toMatch(/have made a protectorate/);
  });
});
