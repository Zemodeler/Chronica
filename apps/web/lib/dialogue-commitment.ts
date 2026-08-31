export interface DialogueCommitment { promiseType: string; promisedResult: string; conditions: string; rationale: string; }

/** Produces a bounded pending commitment only for an explicit NPC promise. */
export function extractDialogueCommitment(reply: string, request: string): DialogueCommitment | null {
  if (!/\b(i(?:'ll| will| can)|we(?:'ll| will| can)|you shall have)\b/i.test(reply)) return null;
  const lower = `${request} ${reply}`.toLowerCase();
  const promiseType = /\b(money|coin|loan|lend|denar)/.test(lower) ? "money"
    : /\b(bread|food|meal|grain)/.test(lower) ? "food"
    : /\b(shelter|bed|stay|house)/.test(lower) ? "shelter"
    : /\b(introduc|letter|meet)/.test(lower) ? "introduction"
    : /\b(information|tell you|news)/.test(lower) ? "information" : "assistance";
  return { promiseType, promisedResult: reply.slice(0, 400), conditions: /\b(if|provided|unless|when)\b/i.test(reply) ? "See the NPC's stated conditions." : "", rationale: "The NPC explicitly offered this assistance." };
}
