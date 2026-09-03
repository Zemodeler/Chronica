import type { DirectedRelation } from "./character";

// Authoritative opinion (character-sim phase 1).
//
// Takes only the `relations` a caller already has in hand -- a full canonical
// `Character` or any narrower projection that still carries the directed
// relation ledger -- rather than requiring the whole record.
//
// A directed relation's score is never stored bare (RelationCauseSchema docs).
// This is the one place that folds its causes into a single number for
// display -- dialogue reads this instead of the old, second, independently
// stored `npcChatKnowledgebases.relationshipScore`.
//
// Decaying a cause requires knowing how many steps make a year, which lives
// on the scenario clock rather than in `WorldState` itself (docs/16). Until a
// caller threads that through, this folds causes undecayed; a future pass can
// weight by `decayPerYearBps` once the clock is available here.

/** `subject`'s opinion of `ofCharacterId`, folded from their directed relation causes. */
export function computeOpinion(subject: { readonly relations: readonly DirectedRelation[] }, ofCharacterId: string): number {
  const relation = subject.relations.find((r) => r.subjectCharacterId === ofCharacterId);
  if (relation === undefined) return 0;
  const total = relation.causes.reduce((sum, cause) => sum + cause.score, 0);
  return Math.max(-100, Math.min(100, total));
}

export function opinionLabel(score: number): string {
  if (score <= -60) return "hostile";
  if (score <= -20) return "distrustful";
  if (score < 20) return "neutral";
  if (score < 60) return "friendly";
  return "devoted";
}
