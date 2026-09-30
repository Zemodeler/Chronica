import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, atWar, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { runDeterministicTick } from "./tick";
import { keepTreaties } from "./treaties";

/**
 * "Send an ultimatum to Syracuse: if they are not with us, they are against us."
 *
 * The order came back as the ultimatum and a declaration of war in the same
 * breath. Rome was at war with Syracuse, and had fought it, before Hieron was
 * asked anything; his refusal arrived ten days after the battle. An ultimatum's
 * threat waits on its answer.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor = "gaius-genucius"): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`ultimatum-${actor}`),
  gameId: "game-ultimatum",
});

const ULTIMATUM: WorldDelta = {
  op: "diplomatic_message_send",
  localId: "ultimatum",
  kind: "ultimatum",
  fromPolityId: "rome",
  fromCharacterRef: "gaius-genucius",
  toPolityId: "syracuse",
  toCharacterRef: "hieron-ii",
  subject: "Ultimatum concerning Messana",
  terms: "Withdraw from Messana and do not interfere with the Roman siege. If Syracuse is not with Rome, it is against her.",
  replyWithinDays: 10,
  inReplyToRef: null,
  visibility: "public",
  reason: "Clepsina puts it to Hieron.",
};
const WAR: WorldDelta = {
  op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "syracuse",
  terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "If not with us, against us.",
};

/** The world on the day the ultimatum reaches Syracuse: Hieron answers what he has read. */
const inHieronsHands = (state: WorldState): WorldState =>
  advanceWorldTo(state, { day: state.diplomacy.at(-1)!.deliveredOnDay!, minute: 540 });

describe("an ultimatum", () => {
  it("does not make the war in the same breath it threatens it", () => {
    const sent = applyDeltas(world(), [ULTIMATUM, WAR], context());
    expect(sent.rejected).toEqual([]);
    expect(atWar(sent.world.polityAgreements, "rome", "syracuse")).toBe(false);
    expect(sent.world.diplomacy.at(-1)!.onRefusal).toBe("war");
    expect(sent.factProposals.some((fact) => fact.kind === "war_threatened")).toBe(true);
  });

  it("makes the war when it is refused", () => {
    const sent = applyDeltas(world(), [ULTIMATUM, WAR], context());
    const message = sent.world.diplomacy.at(-1)!;
    const arrived = inHieronsHands(sent.world);
    const refused = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: message.id, answer: "refused",
      answerText: "Syracuse will not withdraw.", reason: "Hieron will not be told.",
    }], { ...context("hieron-ii"), now: arrived.instant });
    expect(refused.rejected).toEqual([]);
    expect(atWar(refused.world.polityAgreements, "rome", "syracuse")).toBe(true);
    expect(refused.world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("syracuse"))?.sourceMessageId).toBe(message.id);
    expect(refused.factProposals.some((fact) => fact.kind === "war_declared")).toBe(true);
  });

  it("makes no war when it is accepted", () => {
    const sent = applyDeltas(world(), [ULTIMATUM, WAR], context());
    const arrived = inHieronsHands(sent.world);
    const accepted = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: sent.world.diplomacy.at(-1)!.id, answer: "accepted",
      answerText: "Syracuse stands aside.", reason: "Hieron will not fight Rome for the Mamertines.",
    }], { ...context("hieron-ii"), now: arrived.instant });
    expect(accepted.rejected).toEqual([]);
    expect(atWar(accepted.world.polityAgreements, "rome", "syracuse")).toBe(false);
  });

  it("makes the war when its term runs out in silence", () => {
    const sent = applyDeltas(world(), [ULTIMATUM, WAR], context());
    const due = sent.world.diplomacy.at(-1)!.replyDueByStep!;
    // Hieron was shown it, and said nothing.
    const read = { ...sent.world, elapsedStep: due, diplomacy: sent.world.diplomacy.map((message) => ({ ...message, putToRecipientOnDay: 1 })) };
    const ticked = runDeterministicTick({ world: read, toDay: due, ids: createIdFactory("silence"), warfare: definition.warfare });
    expect(atWar(ticked.world.polityAgreements, "rome", "syracuse")).toBe(true);
    expect(ticked.factProposals.some((fact) => fact.kind === "war_declared")).toBe(true);
  });

  it("does not take silence from a king who was never shown the letter", () => {
    const sent = applyDeltas(world(), [ULTIMATUM, WAR], context());
    const due = sent.world.diplomacy.at(-1)!.replyDueByStep!;
    const ticked = runDeterministicTick({ world: { ...sent.world, elapsedStep: due + 40 }, toDay: due + 40, ids: createIdFactory("silence"), warfare: definition.warfare });
    expect(ticked.world.diplomacy.at(-1)!.status).toBe("awaiting_reply");
    expect(atWar(ticked.world.polityAgreements, "rome", "syracuse")).toBe(false);
    expect(ticked.factProposals.some((fact) => fact.kind === "diplomatic_silence")).toBe(false);
  });

  it("does not hold back a war declared after an old ultimatum was left unanswered", () => {
    const sent = applyDeltas(world(), [ULTIMATUM], context());
    const later = applyDeltas({ ...sent.world, elapsedStep: 5, instant: { ...sent.world.instant, day: 5 } }, [WAR], { ...context(), now: { day: 5, minute: 540 } });
    expect(later.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(atWar(later.world.polityAgreements, "rome", "syracuse")).toBe(true);
  });
});

describe("an ultimatum whose threat is for going on attacking", () => {
  // R15: "cease hostilities or invite open war". Hieron kept the pause and
  // refused only to renounce his claim; the war opened on the refusal, and the
  // Chronicle said it was what the warning required.
  const CEASE: WorldDelta = {
    ...ULTIMATUM,
    subject: "Cease hostilities at Messana",
    terms: "Cease hostilities against Messana, which is under Rome's protection, or invite open war.",
  };

  it("makes no war when only its words are refused, and says the threat stands", () => {
    const sent = applyDeltas(world(), [CEASE, WAR], context());
    const arrived = inHieronsHands(sent.world);
    const refused = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: sent.world.diplomacy.at(-1)!.id, answer: "refused",
      answerText: "Syracuse keeps its pause, and will not renounce its right in Messana.", reason: "Hieron keeps his claim.",
    }], { ...context("hieron-ii"), now: arrived.instant });
    expect(atWar(refused.world.polityAgreements, "rome", "syracuse")).toBe(false);
    expect(refused.factProposals.some((fact) => fact.kind === "threat_stands")).toBe(true);
    expect(refused.world.diplomacy.at(-1)!.threatStandsSince).not.toBeNull();
  });

  it("makes the war on the next blow struck at those Rome shelters", () => {
    const sent = applyDeltas(world(), [CEASE, WAR], context());
    const arrived = inHieronsHands(sent.world);
    const refused = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: sent.world.diplomacy.at(-1)!.id, answer: "refused",
      answerText: "No.", reason: "Hieron keeps his claim.",
    }], { ...context("hieron-ii"), now: arrived.instant }).world;
    const since = refused.diplomacy.at(-1)!.threatStandsSince!;
    const quiet = keepTreaties({ world: refused, toDay: since + 5, ids: createIdFactory("quiet"), playerPolityId: null });
    expect(atWar(quiet.world.polityAgreements, "rome", "syracuse")).toBe(false);
    const struck: WorldState = {
      ...quiet.world,
      sieges: [{
        id: "siege-messana", forceId: "syracusan-army", provinceId: "sic-q659z", settlementId: null, besiegerPolityId: "syracuse", defenderPolityId: "rome",
        startedAtStep: since + 6, pressedToStep: since + 8, reportedAtStep: since + 8, pressureBps: 0, awaiting: null, works: [], told: [], status: "active", endedAtStep: null, endedReason: null,
      }],
    };
    const kept = keepTreaties({ world: struck, toDay: since + 8, ids: createIdFactory("kept"), playerPolityId: null });
    expect(atWar(kept.world.polityAgreements, "rome", "syracuse")).toBe(true);
    expect(kept.facts.some((fact) => fact.kind === "war_declared")).toBe(true);
  });
});
