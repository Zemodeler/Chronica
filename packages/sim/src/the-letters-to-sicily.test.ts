import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A consul's letters to Messana and Syracuse, as a live run played them.
 *
 * Rename the army, write to Messana taking the city in, write to Syracuse
 * proposing an alliance against Carthage. All three were carried out -- and the
 * Chronicle said "Clepsina speaks for the Midland Britons and Mamertines". The
 * orchestrator had written the Britons' war and the Mamertines' appeal to
 * Carthage into the order's own list, the engine read them as the consul
 * committing other peoples, and the letters themselves, Messana's acceptance
 * and Hieron's counter-offer left no fact for the historian to write from.
 * Messana's acceptance bound nobody either: the Mamertines went on begging
 * Carthage for help as though Rome had never written.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const CONSUL = { kind: "character" as const, id: "gaius-genucius" };

function scripted(orchestrator: readonly string[]): SimModelPort {
  const queue = [...orchestrator];
  return {
    complete(operation: SimOperation) {
      if (operation === "simulate_orchestrate" || operation === "repair_deltas") {
        const next = queue.shift();
        if (next !== undefined) return Promise.resolve(next);
      }
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.reject(new Error(`nothing scripted for ${operation}`));
    },
  };
}
const answer = (fields: Record<string, unknown>) => JSON.stringify({
  intent: { summary: "The consul writes to Messana.", domains: ["diplomacy"] }, narrativeSummary: "Letters go south.",
  frictions: [], deltas: [], worldDeltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  ...fields,
});

const TO_MESSANA = {
  op: "diplomatic_message_send", localId: "to_messana", kind: "letter", fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
  toPolityId: "mamertines", toCharacterRef: "mamertine-spokesman", subject: "Rome's offer to Messana",
  terms: "Rome will receive Messana under Roman banners, as an allied city or as territory under Roman protection with complete autonomy.",
  replyWithinDays: null, inReplyToRef: null, visibility: "polity", proposes: ["foedus", "protectorate"], reason: "The consul's order.",
};
// Exactly what the live run wrote into the consul's order beside his letters.
const BRITONS_WAR = {
  op: "agreement_open", localId: "british-northampton-war", kind: "war", polityId: "britain-midland-britons", otherPolityId: "britain-thames-britons",
  terms: "War over competing claims to Northamptonshire.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "The Midland Britons strike first.",
};
const MAMERTINE_APPEAL = {
  op: "diplomatic_message_send", localId: "mamertine-appeal-carthage", kind: "military_aid_request", fromPolityId: "mamertines", fromCharacterRef: "mamertine-spokesman",
  toPolityId: "carthage", toCharacterRef: "hanno-carthage", subject: "Protection for Messana", terms: "The Mamertines ask Carthage for aid to secure Messana.",
  replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "Syracuse presses them.",
};

describe("the world's dealings written into a consul's letters", () => {
  const burst = (port: SimModelPort): BurstInput => ({
    world: opening(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
    burstId: "letters", gameId: "game-1", actorRef: CONSUL, actorPolityId: "rome",
    orderText: "Send a letter to Messana: Rome will take them in, as allies or as autonomous territory.",
    knownFacts: [], queue: [], port, spanDays: 7, narratorSeeds: [],
  });

  it("are the world's, not the consul committing the Britons and the Mamertines", async () => {
    const result = await runSimulationBurst(burst(scripted([answer({ deltas: [TO_MESSANA, BRITONS_WAR, MAMERTINE_APPEAL] })])));
    expect(result.audit.filter((entry) => entry.kind === "ignored")).toEqual([]);
    expect(result.audit.filter((entry) => entry.kind === "refiled").map((entry) => entry.op).sort()).toEqual(["agreement_open", "diplomatic_message_send"]);
    expect(result.newFacts.some((fact) => fact.kind === "order_ignored")).toBe(false);
    expect(result.world.polityAgreements.some((agreement) => agreement.kind === "war" && agreement.polityId === "britain-midland-britons")).toBe(true);
    expect(result.world.diplomacy.some((message) => message.subject === "Protection for Messana")).toBe(true);
  });

  it("leaves the consul's own letter his, and in the record", async () => {
    const result = await runSimulationBurst(burst(scripted([answer({ deltas: [TO_MESSANA, BRITONS_WAR] })])));
    expect(result.audit.filter((entry) => entry.kind === "refiled").map((entry) => entry.op)).toEqual(["agreement_open"]);
    const sent = result.newFacts.find((fact) => fact.kind === "letter_sent" && fact.summary.includes("Rome's offer to Messana"));
    expect(sent).toBeDefined();
    expect(sent!.affectedEntities.some((entity) => entity.kind === "polity" && entity.id === "rome")).toBe(true);
  });
});

describe("an offer accepted", () => {
  const context = (): ApplyContext => ({
    now: { day: 0, minute: 540 },
    actorRef: CONSUL,
    offices: definition.government.offices,
    warfare: definition.warfare,
    terrains: definition.map.terrains,
    ids: createIdFactory("accept"),
    gameId: "game-1",
  });
  /** Sent, and then answered the day it reaches its reader: nobody answers a letter on the road. */
  const answeredOnArrival = (letter: unknown, answering: (letterId: string) => readonly WorldDelta[]) => {
    const sent = applyDeltas(opening(), [letter as WorldDelta], context());
    const written = sent.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(sent.world, { day: written.deliveredOnDay!, minute: 540 });
    const result = applyDeltas(arrived, answering(written.id), { ...context(), now: arrived.instant });
    return { ...result, factProposals: [...sent.factProposals, ...result.factProposals] };
  };
  const accept = (letterId: string, fields: Record<string, unknown> = {}): WorldDelta => ({
    op: "diplomatic_message_answer", messageRef: letterId, answer: "accepted",
    answerText: "We accept Messana's protection under Roman banners, with complete autonomy.", reason: "They would rather Rome than Syracuse.",
    ...fields,
  });

  it("is the agreement it offered, made, with the power taken in named first", () => {
    const result = answeredOnArrival(TO_MESSANA, (id) => [accept(id, { agreementKind: "protectorate" })]);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    const standing = result.world.polityAgreements.at(-1)!;
    expect(standing.kind).toBe("protectorate");
    expect(standing.polityId).toBe("mamertines");
    expect(standing.otherPolityId).toBe("rome");
    const letter = result.world.diplomacy.at(-1)!;
    expect(letter.agreementId).toBe(standing.id);
    expect(standing.sourceMessageId).toBe(letter.id);
    expect(result.factProposals.map((fact) => fact.kind)).toEqual(expect.arrayContaining(["letter_sent", "letter_answered"]));
  });

  it("is made once, when the answerer writes the treaty out beside it", () => {
    const result = answeredOnArrival(TO_MESSANA, (id) => [
      accept(id, { agreementKind: "protectorate" }),
      {
        op: "agreement_open", localId: "the_protection", kind: "protectorate", polityId: "mamertines", otherPolityId: "rome",
        terms: "Messana keeps its laws; Rome answers for it abroad.", forDays: null, sourceMessageRef: id, visibility: "public", reason: "As agreed.",
      },
    ]);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(result.world.polityAgreements.filter((agreement) => agreement.kind === "protectorate" && agreement.polityId === "mamertines")).toHaveLength(1);
  });

  it("binds nothing when the letter offered nothing, or the choice was not among what it offered", () => {
    const plain = { ...TO_MESSANA, proposes: undefined };
    const before = opening().polityAgreements.length;
    const plainly = answeredOnArrival(plain, (id) => [accept(id, { agreementKind: "alliance" })]);
    expect(plainly.rejected.map((rejection) => rejection.reason)).not.toContainEqual(expect.stringMatching(/has not reached/));
    expect(plainly.world.polityAgreements).toHaveLength(before);
    expect(answeredOnArrival(TO_MESSANA, (id) => [accept(id, { agreementKind: "war" })]).world.polityAgreements).toHaveLength(before);
  });

  it("an offer of alliance means an alliance without saying so", () => {
    const offer = { ...TO_MESSANA, kind: "alliance_offer", toPolityId: "syracuse", toCharacterRef: "hieron-ii", proposes: undefined };
    const result = answeredOnArrival(offer, (id) => [accept(id, { answerText: "Syracuse stands with Rome." })]);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(result.world.polityAgreements.at(-1)!.kind).toBe("alliance");
  });
});
