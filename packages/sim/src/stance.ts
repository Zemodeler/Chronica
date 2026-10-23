/**
 * Moved, or done (the user's rule, 2026-10-08): "If the player says 'propose to declare war' the Senate votes; if he says 'I declare war' the engine takes the
 * consequences of that action: he said it, it happened."
 *
 * Every part of an order has a stance, `propose` (move it in the body whose act it is, the existing path) or `declare` (do it). The orchestrator reads it from the
 * player's words, and this reads the same words by rule, the rule overriding where it finds the player plain: a man who says "I declare", "I order", "I hereby"
 * has done it; one who says "propose", "move", "ask the Senate", "put it to the vote", "request" has not. Where the words are plain both ways, the cautious reading
 * stands (it is a motion). Where they are plain neither way the engine's own default holds: moved, for an act of constitutional weight the man's office leaves to
 * a body; done, for what is within his own competence (which it was anyway).
 */
export type Stance = "propose" | "declare";

const PROPOSE = /\b(propos(?:e|ed|ing|al)|motion|move (?:that|to|the|a|an)|moving (?:that|to)|ask(?:ing)? (?:the )?(?:senate|assembly|elders|council|people|comitia|college)|put (?:it |this |the question )?(?:to|before) (?:the )?(?:vote|senate|assembly|elders|council|people|comitia)|let (?:the )?(?:senate|assembly|elders|council|people) (?:vote|decide|debate)|request(?:ing|ed)?|submit(?:ting)? (?:it |this )?to|seek(?:ing)? (?:the |its )?(?:leave|consent|approval) of|call (?:a|the) vote)\b/i;
const DECLARE = /\b(?:i|we)\s+(?:hereby\s+|do\s+hereby\s+)?(?:declare|order|decree|proclaim|command|do)\b(?!\s+not\b)|\bi\s+hereby\b|\bby my (?:own )?(?:word|authority|command)\b|\bit is my (?:will|command|order)\b/i;

/** What the words themselves say, or null where they say neither. */
export function stanceOfWords(text: string): Stance | null {
  if (PROPOSE.test(text)) return "propose";
  if (DECLARE.test(text)) return "declare";
  return null;
}

const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 4));

/**
 * The stance of one part of an order: the clause of the player's words it says is read for it (the one it shares most words with, else the whole), by rule; the
 * orchestrator's own reading stands where the words are plain neither way.
 */
export function stanceOfPart(orderText: string | null, said: string, modelStance: Stance | null | undefined): Stance | null {
  if (orderText !== null) {
    const clauses = orderText.split(/(?<=[.;!?])\s+|\s+(?:and then|then|but|and also)\s+/i).map((clause) => clause.trim()).filter((clause) => clause.length > 0);
    const mine = wordsOf(said);
    let best: { clause: string; overlap: number } | null = null;
    for (const clause of clauses) {
      const overlap = [...wordsOf(clause)].filter((word) => mine.has(word)).length;
      if (best === null || overlap > best.overlap) best = { clause, overlap };
    }
    const read = stanceOfWords(best !== null && best.overlap > 0 ? best.clause : orderText);
    if (read !== null) return read;
  }
  return modelStance ?? null;
}
