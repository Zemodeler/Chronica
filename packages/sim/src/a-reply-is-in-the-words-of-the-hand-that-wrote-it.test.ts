import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Loop 1, burst 14: the censor Manius Curius answered the Apulian cities' letter for Rome, and the fact said it was "in the
 * words of Gaius Genucius Clepsina", the consul it had been addressed to. The words are the hand that wrote them.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, now: WorldState["instant"]): ApplyContext => ({
  now, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`hand-${actor}`), gameId: "game-hand", playerCharacterId: "manius-curius",
});

describe("a reply to a letter addressed to the consul", () => {
  it("is told in the words of the censor who wrote it, not of the consul it was addressed to", () => {
    const start = world();
    const sent: WorldDelta = {
      op: "diplomatic_message_send", localId: "ask", kind: "peace_talks", fromPolityId: "syracuse", fromCharacterRef: "hieron-ii", toPolityId: "rome", toCharacterRef: "gaius-genucius",
      subject: "Syracuse asks to talk of peace", terms: "Syracuse sends envoys to ask on what terms this war may end.", replyWithinDays: 30, inReplyToRef: null, visibility: "public", proposes: [], reason: "Hieron asks.",
    };
    const asked = applyDeltas(start, [sent], context("hieron-ii", start.instant));
    expect(asked.rejected).toEqual([]);
    const letter = asked.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(asked.world, { day: letter.deliveredOnDay ?? 0, minute: 540 });
    const answered = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: letter.id, answer: "refused", answerText: "Rome will not talk of peace this season.", reason: "The censor answers.",
    }], context("manius-curius", arrived.instant));
    const told = answered.factProposals.find((fact) => fact.kind === "letter_answered");
    expect(told).toBeDefined();
    expect(told!.summary).toContain("in the words of Manius Curius Dentatus");
    expect(told!.summary).not.toContain("Gaius Genucius Clepsina");
  });
});
