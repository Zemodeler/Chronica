import { describe, expect, it } from "vitest";
import { WorldDeltaSchema } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { PEACE_REQUEST_ANSWER_DAYS } from "./apply/apply-deltas";
import { aMonth, atWar, context } from "./war-plan-kit";

/**
 * A request for a truce is answered (the war playtest: the Campanian legion asked for a truce and was ignored eighteen months).
 *
 * A request for peace or a truce carries a term even where its writer named none: a season. The man it is written to answers it by what he is, for a power
 * the rules lead; for one a player rules, silence at the term is the refusal it always is. No request waits for ever.
 */
describe("a truce request is answered", () => {
  const world = atWar(100);
  const sent = (replyWithinDays: number | null) => applyDeltas(world, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "truce-ask", kind: "peace_offer", fromPolityId: "rhegium-campanians", fromCharacterRef: "decius-vibellius", toPolityId: "rome", toCharacterRef: null,
    subject: "A truce for Rhegium", terms: "The men of Rhegium ask for a truce, that they may bury their dead and treat.", replyWithinDays, inReplyToRef: null, visibility: "polity", proposes: ["truce"], reason: "They are hard pressed.",
  })], context(world, "decius-vibellius") as never);

  it("has a term of its own when its writer named none", () => {
    const message = sent(null).world.diplomacy.find((candidate) => candidate.subject === "A truce for Rhegium")!;
    expect(message.replyDueByStep).toBe((message.deliveredOnDay ?? message.sentAtStep) + PEACE_REQUEST_ANSWER_DAYS);
  });

  it("keeps the term its writer named", () => {
    const message = sent(20).world.diplomacy.find((candidate) => candidate.subject === "A truce for Rhegium")!;
    expect(message.replyDueByStep).toBe((message.deliveredOnDay ?? message.sentAtStep) + 20);
  });

  it("is answered by the man it is written to, by the rules, where nobody plays his power", () => {
    const written = sent(null).world;
    const arrived = { ...written, instant: { ...written.instant, day: written.instant.day + 20 }, elapsedStep: written.elapsedStep + 20 };
    const month = aMonth(arrived);
    expect(month.decisions.some((decision) => decision.polityId === "rome" && decision.act === "answer_letter" && decision.targetPolityId === "rhegium-campanians")).toBe(true);
  });
});
