import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, localRef, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * "Write to Messana. Promise them their own laws under Rome's protection."
 *
 * The act the whole scenario is pointed at. `messana-invites-a-protector` is
 * the historical pressure that gates `the-strait-is-crossed`, and the answer
 * to "what does the great power offer?" is this and nothing else: the city
 * keeps its magistrates and its customs, and Rome keeps the strait.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("messana"),
  gameId: "game-1",
});

const THE_LETTER: WorldDelta = {
  op: "diplomatic_message_send",
  localId: "protection_offer",
  kind: "letter",
  fromPolityId: "rome",
  fromCharacterRef: "gaius-genucius",
  toPolityId: "mamertines",
  toCharacterRef: "mamertine-spokesman",
  subject: "The protection of the Roman people",
  terms: "Messana keeps its own magistrates, its own laws and its own customs. Rome asks only that the city follow Rome in war and admit no other power to the strait.",
  replyWithinDays: 30,
  inReplyToRef: null,
  visibility: "polity",
  reason: "The consul offers the Mamertines autonomy under Roman protection.",
};

describe("a letter to Messana promising autonomy under Roman rule", () => {
  it("is sent, and reaches the people it was addressed to", () => {
    const result = applyDeltas(world(), [THE_LETTER], context());

    expect(result.rejected).toHaveLength(0);
    const sent = result.world.diplomacy.at(-1)!;
    expect(sent.fromPolityId).toBe("rome");
    expect(sent.toPolityId).toBe("mamertines");
    expect(sent.terms).toContain("its own magistrates");
    expect(sent.answer).toBeNull();
  });

  /** Sent from Rome, and read in Messana the day it gets there: an answer waits on the road. */
  const delivered = (): { readonly world: WorldState; readonly letterId: string; readonly at: ApplyContext } => {
    const sent = applyDeltas(world(), [THE_LETTER], context());
    const letter = sent.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(sent.world, { day: letter.deliveredOnDay!, minute: 540 });
    return { world: arrived, letterId: letter.id, at: { ...context(), now: arrived.instant } };
  };

  it("is not answered in the breath it is written", () => {
    // Accepted the same hour it left Rome, it was answered from Messana
    // before a courier could have reached the strait.
    const result = applyDeltas(world(), [THE_LETTER, {
      op: "diplomatic_message_answer", messageRef: localRef("protection_offer"), answer: "accepted",
      answerText: "Messana will have Rome for its protector.", reason: "They accept.",
    }], context());
    expect(result.world.diplomacy.at(-1)!.deliveredOnDay).toBeGreaterThan(0);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([expect.stringMatching(/has not reached .* yet/)]);
  });

  it("can be accepted by the people it was sent to", () => {
    const { world: arrived, letterId, at } = delivered();
    const result = applyDeltas(
      arrived,
      [
        {
          op: "diplomatic_message_answer",
          messageRef: letterId,
          answer: "accepted",
          answerText: "Messana will have Rome for its protector, and keeps its own laws.",
          reason: "The Mamertines take the offer rather than face Syracuse alone.",
        },
      ],
      at,
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.world.diplomacy.at(-1)!.answer).toBe("accepted");
  });

  it("leaves behind an arrangement that says what was actually agreed", () => {
    const { world: arrived, letterId, at } = delivered();
    const accepted = applyDeltas(
      arrived,
      [
        {
          op: "diplomatic_message_answer", messageRef: letterId, answer: "accepted",
          answerText: "Messana will have Rome for its protector.", reason: "They accept.",
        },
        {
          op: "agreement_open",
          localId: "the_protection",
          kind: "protectorate",
          // Protected power first: which of the two is which is the whole of
          // the terms, exactly as it is for tribute.
          polityId: "mamertines",
          otherPolityId: "rome",
          terms: "Messana keeps its own magistrates and laws; Rome answers for it abroad and holds the strait.",
          forDays: null,
          sourceMessageRef: letterId,
          visibility: "public",
          reason: "What the letter promised, now standing between the two powers.",
        },
      ],
      at,
    );

    expect(accepted.rejected.map((r) => r.reason)).toEqual([]);
    const standing = accepted.world.polityAgreements.at(-1)!;
    // Not an alliance: Messana is not Rome's equal and has not promised an
    // army. Not tributary: it pays nothing. The thing Rome actually offered
    // is a city that keeps its own government under somebody else's power,
    // which is what started the First Punic War.
    expect(standing.kind).toBe("protectorate");
    expect(standing.polityId).toBe("mamertines");
    expect(standing.otherPolityId).toBe("rome");
  });
});
