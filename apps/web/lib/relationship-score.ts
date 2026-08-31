/** Keep an NPC's current opinion in the same range as the stored score. */
export function clampRelationshipScore(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** A readable current-opinion label derived from the durable score. */
export function relationshipLabelForScore(score: number): string {
  if (score >= 75) return "devoted";
  if (score >= 40) return "friendly";
  if (score >= 15) return "favourable";
  if (score <= -75) return "hostile";
  if (score <= -40) return "resentful";
  if (score <= -15) return "wary";
  return "neutral";
}

/**
 * A deterministic fallback used before the NPC profile has been enriched.
 * The profile generator can refine this from the relationship's specific
 * history, but an explicitly hostile or close relationship should never
 * start at a neutral score.
 */
export function scoreForDeclaredConnection(relationship: string, notes = ""): number {
  const context = `${relationship} ${notes}`.toLocaleLowerCase();
  if (/\b(estranged|disowned|feud|bitter|resent|betray|enemy|rival|foe|adversary|opponent)\b/.test(context)) return -55;
  if (/\b(suspicious|distrustful|wary)\b/.test(context)) return -25;
  if (/\b(brother|sister|sibling|spouse|wife|husband|son|daughter|child|parent|mother|father|uncle|aunt|cousin|nephew|niece|family|kin)\b/.test(context)) return 55;
  if (/\b(friend|ally|confidant|mentor|patron|loyal|trusted)\b/.test(context)) return 40;
  if (/\b(client|vassal|subordinate|servant|dependent)\b/.test(context)) return 20;
  return 0;
}
