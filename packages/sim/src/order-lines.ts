import type { OrderPart, WorldState } from "@chronica/shared";

/**
 * The line an order that was carried out leaves where nothing public did: what it was, said as done.
 *
 * "Nothing came of it that anyone could see" stood under an estate that was bought, a venture that was closed and a convoy that arrived: the acts were
 * carried and left no news. Said as what it was, never as nothing.
 */
export function carriedOutLine(acts: readonly { readonly carried: boolean; readonly said: string }[]): string {
  const said = acts.filter((act) => act.carried).slice(0, 2).map((act) => act.said.trim().replace(/[.\s]+$/, "")).filter((text) => text.length > 0);
  return said.length === 0 ? "It was carried out." : `It was carried out: ${said.join("; ")}.`;
}


/** The words the engine's own "nobody follows him" answers are told in: a man giving orders to an army that is not his. */
const NOBODY_FOLLOWS = /could remember appointing|looked to .* who had given none|take their orders from|stayed exactly where it was/i;

/** An order that is a proposal, a motion or a petition: it asks a body, it does not command a force. */
const A_PROPOSAL = /^(?:and\s+|then\s+)?(?:i\s+)?(?:propose|move|put\s+it\s+to|petition|ask\s+the\s+senate|request\s+of\s+the\s+senate|bring\s+before|lay\s+before)\b/i;

/**
 * Why a part was refused, in the words of the age, where the engine's own reason says the wrong thing or none.
 *
 * "I propose to the Senate that the army be sent against Rhegium" was refused with "Nobody in Roman field army could remember appointing Titus Vettius to
 * anything": the act the answer wrote for it was an order to the army, which a proposal is not. A proposal is put by a man who has a seat to put it from. And a
 * man refused by one he asked (a centurion, a consul) has that man's own reason, when he gave one, where the line said only "refused".
 */
export function refusalInPeriodWords(world: WorldState, part: Pick<OrderPart, "said" | "workRefs">, actorId: string, reason: string | null): string | null {
  if (reason !== null && A_PROPOSAL.test(part.said.trim()) && NOBODY_FOLLOWS.test(reason)) {
    const seated = world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === actorId);
    return seated
      ? "The army is not his to send: he may put the motion to the Senate, and until the Senate carries it nobody marches."
      : "He holds no seat from which to put a motion to the Senate, and the army is not his to send: a motion is laid by a magistrate or a senator, and he is neither.";
  }
  if (reason !== null) return reason;
  for (const ref of part.workRefs) {
    if (ref.kind !== "order_attempt") continue;
    const attempt = world.orderAttempts.find((candidate) => candidate.id === ref.id);
    if (attempt !== undefined && attempt.status === "refused" && attempt.recipientDecisionReason !== null && attempt.recipientDecisionReason.trim().length > 0) return attempt.recipientDecisionReason;
  }
  return null;
}
