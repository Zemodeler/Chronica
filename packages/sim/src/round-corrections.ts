import type { FactProposal, OrderPartyRef, WorldDelta, WorldState } from "@chronica/shared";
import type { RejectedDelta } from "./apply/context";
import type { SimModelPort } from "./ports";
import { reconcileFacts } from "./reconcile-facts";
import { repairDeltas } from "./repair-deltas";

/**
 * Who pays for correcting what the engine refused in an answer (L17).
 *
 * Every answer used to buy its own: a `repair_deltas` call for the acts the
 * engine could not read, and a `reconcile_facts` call for the facts that
 * described them, one after the other, for each person in a round and for
 * each of the powers' monthly decisions. A round of eight people could cost
 * sixteen calls after the eight people's answers, and the Codex play-test hit
 * its cap every turn with up to 26 of 29 days nobody was asked about. And the
 * repair was shown the player's world, not the man's who wrote the act, so
 * most of those repairs came back as wrong as they went.
 *
 *  - `own`: the answer pays for its own, then and there. The player's order,
 *    which is what the player is waiting on.
 *  - `round`: the answer leaves what needs correcting to its round, which
 *    makes one repair and one reconciliation for everybody in it.
 *  - `none`: nobody pays. The powers' own business is the engine's writing,
 *    and the world elsewhere riding along is not worth a call: what they wrote
 *    that the engine could not read stays in the audit, and a fact that
 *    describes a refused act is kept as somebody's report of it (`asClaim`),
 *    never as the event.
 */
export type CorrectionCalls = "own" | "round" | "none";

/** What one person's answer left for its round to correct. */
export interface RoundCorrection {
  readonly actorRef: OrderPartyRef;
  readonly causalDepth: number;
  /** Refusals of how the acts were written, worth a corrected attempt. */
  readonly repairable: readonly RejectedDelta[];
  /** His facts that name something refused, held back from the record until the round has reconciled them. */
  readonly naming: readonly FactProposal[];
  /** Everything of his the engine refused. */
  readonly refused: readonly RejectedDelta[];
  /** Ids counted as named beside the refused acts' own (`factsNamingRefusals`). */
  readonly namedBeside: readonly string[];
  /** The handles his answer was given, so a correction may name what it made. */
  readonly assignedIds: ReadonlyMap<string, string>;
}

/**
 * One repair call for a round: every person's refusals together, numbered,
 * and each correction handed back to whoever's refusal it answers. A
 * correction that answers no refusal is nobody's and is dropped -- the repair
 * may not add changes nobody asked for.
 */
export async function repairTheRound(input: {
  readonly port: SimModelPort;
  readonly worldText: string;
  readonly world: WorldState;
  readonly owed: readonly RoundCorrection[];
}): Promise<{ readonly corrections: readonly (readonly WorldDelta[])[]; readonly calls: number; readonly failure: string | null }> {
  const all = input.owed.flatMap((entry, at) => entry.repairable.map((rejection) => ({ at, rejection })));
  const corrections: WorldDelta[][] = input.owed.map(() => []);
  if (all.length === 0) return { corrections, calls: 0, failure: null };
  const repair = await repairDeltas({ port: input.port, worldText: input.worldText, rejected: all.map((entry) => entry.rejection), world: input.world });
  repair.deltas.forEach((delta, index) => {
    const answered = all[repair.answers[index] ?? -1];
    if (answered !== undefined) corrections[answered.at]!.push(delta);
  });
  return { corrections, calls: repair.calls, failure: repair.failure };
}

/**
 * The refusals a man's corrections did not answer. Which correction answers
 * which refusal is not kept by the applier, so a refusal counts as answered
 * when a correction of the same kind was carried out or refused in its turn
 * (what it was refused for is then its own refusal, in `newlyRefused`).
 */
export function unanswered(refused: readonly RejectedDelta[], correctedOps: readonly string[], newlyRefused: readonly RejectedDelta[]): RejectedDelta[] {
  const answered = [...correctedOps];
  return [
    ...refused.filter((rejection) => {
      const at = answered.indexOf(rejection.delta.op);
      if (at < 0) return true;
      answered.splice(at, 1);
      return false;
    }),
    ...newlyRefused,
  ];
}

/**
 * One reconciliation for a round: every person's facts that name what was
 * refused, against everything refused, in one call. Each man's handles are
 * told apart by his place in the round, so two people's "spent" are two facts.
 * What the call withdraws is gone; what it rewrites is rewritten; a call that
 * fails leaves the facts as written, as a single reconciliation always has.
 */
export async function reconcileTheRound(input: {
  readonly port: SimModelPort;
  readonly held: readonly { readonly facts: readonly FactProposal[]; readonly refused: readonly RejectedDelta[] }[];
}): Promise<{ readonly facts: readonly (readonly FactProposal[])[]; readonly calls: number; readonly failure: string | null }> {
  const byTag = new Map<string, { readonly at: number; readonly fact: FactProposal }>();
  const tagged = input.held.flatMap((entry, at) => entry.facts.map((fact) => {
    const tag = `${at + 1}.${fact.localId}`;
    byTag.set(tag, { at, fact });
    return { ...fact, localId: tag };
  }));
  const refused = [...new Set(input.held.flatMap((entry) => entry.refused))];
  const reconciled = await reconcileFacts({ port: input.port, facts: tagged, refused });
  const facts: FactProposal[][] = input.held.map(() => []);
  for (const fact of reconciled.facts) {
    const found = byTag.get(fact.localId);
    if (found !== undefined) facts[found.at]!.push({ ...found.fact, summary: fact.summary });
  }
  return { facts, calls: reconciled.calls, failure: reconciled.failure };
}
