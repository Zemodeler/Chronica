// Chronicle voice (deterministic).
//
// The Chronicle is a historical record, not a console. Every string that
// reaches a reader passes through here first, so an engine identifier, a
// validator message, or a raw executor sentence never appears as history.
//
// Nothing in this file decides anything: it only changes how an already
// committed fact is worded. A refusal stays a refusal, a success stays a
// success -- what changes is that they read as chronicle rather than as log.

/**
 * Vocabulary that betrays the machine, each with the ordinary words a
 * historian would have used instead. None of the left-hand side may survive
 * into a body or a title.
 */
const ENGINE_PHRASES: readonly (readonly [RegExp, string])[] = [
  [/\bthe current world[- ]state\b/gi, "the situation as it stood"],
  [/\bthe world[- ]state\b/gi, "the situation"],
  [/\bworld[- ]state\b/gi, "circumstances"],
  [/\binternal state\b/gi, "circumstances"],
  [/\bworkflows?\b/gi, "measure"],
  [/\b(?:parameters?|params)\b/gi, "terms"],
  [/\bschema\b/gi, "form"],
  [/\bvalidator\b/gi, "scrutiny"],
  [/\b(?:planner|pipeline|fact ?refs?|tool calls?)\b/gi, "record"],
  // A rejected call complaining about its own arguments, said as history:
  // what it means is that no one stood on the other side.
  // Bounded to the humanized field name itself, so the sentence around it
  // survives: "...was refused because no one stood against them".
  [/\b(?:the\s+)?(?:[a-z]+\s+){0,3}(?:array|list|field)\s+(?:was|is)\s+empty\b/gi, "no one stood against them"],
  [/\b(?:array|arrays)\b/gi, "list"],
];

/**
 * `council_deliberation` -> `council deliberation`, `defendingForceIds` ->
 * `defending force ids`. Ids never reach a reader intact, in either casing:
 * a schema complaint quoted back by the Game Master carries camelCase field
 * names, and those are code on the page just as plainly as an underscore is.
 *
 * Only lower-camel tokens are split. A capitalised word is left alone, so
 * proper names -- McCarthy, MacGregor, a Roman numeral -- survive untouched.
 */
export function humanizeIdentifiers(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (token) => token.replace(/_/g, " "))
    .replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, (token) => token.replace(/([A-Z])/g, (letter) => ` ${letter.toLowerCase()}`));
}

/** Title Case For A Headline, leaving short joining words lowercase. */
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "against", "over"]);

export function titleCase(text: string): string {
  const words = text.trim().split(/\s+/);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index !== 0 && index !== words.length - 1 && MINOR_WORDS.has(lower)) return lower;
      // A word that is already capitalised mid-word (a proper name, a roman
      // numeral) is left exactly as it stands.
      if (/[A-Z]/.test(word.slice(1))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Executor refusal and validation messages, restated as history. The *fact*
 * that the attempt produced nothing is preserved exactly; only the machine's
 * wording of why is replaced, and never with an invented institutional cause.
 */
export function humanizeRefusalReason(reason: string): string {
  const text = humanizeIdentifiers(reason.trim());
  if (/cannot be applied to the current world state/i.test(text)) {
    return "circumstances as they stood did not admit it";
  }
  if (/would leave a dangling reference|produced an invalid world state/i.test(text)) {
    return "the attempt could not be carried through as ordered";
  }
  if (/^invalid params/i.test(text) || /invalid params for/i.test(text)) {
    return "the order was too ill-formed to be acted upon";
  }
  if (/no (registered )?workflow|unknown (action|workflow)/i.test(text)) {
    return "nothing in the ordinary course of affairs answered to it";
  }
  // An authority or policy refusal is already worded in-world; keep it, minus
  // any leftover machine vocabulary.
  return stripEngineJargon(text).replace(/^(refused|failed)[:.]?\s*/i, "").replace(/\.$/, "") || "it came to nothing";
}

/**
 * Last-resort scrub: replaces machine vocabulary with ordinary words in prose
 * that is otherwise fine. Substitution, not deletion -- cutting a term out of
 * a sentence leaves a gap a reader can see just as plainly as the term itself.
 */
export function stripEngineJargon(text: string): string {
  let out = humanizeIdentifiers(text);
  // `Workflow "call_vote" cannot ...` -> `call vote cannot ...`
  out = out.replace(/\bworkflow\s+"([^"]+)"/gi, "$1");
  out = out.replace(/\b(?:action|tool)\s+"([^"]+)"/gi, "$1");
  for (const [pattern, replacement] of ENGINE_PHRASES) {
    out = out.replace(pattern, replacement);
  }
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/^\s*[,;:]\s*/, "")
    .trim();
}

/**
 * What an action is, said as a thing rather than as a command. A refusal is
 * written about the deed that did not happen -- "the siege", "the vote" --
 * because "attempt to start siege" is an identifier wearing a verb.
 */
const ORDER_NOUNS: Readonly<Record<string, string>> = {
  start_siege: "the siege",
  end_siege: "the lifting of the siege",
  start_battle: "the battle",
  start_war: "the declaration of war",
  end_war: "the peace",
  sign_treaty: "the treaty",
  break_alliance: "the breaking of the alliance",
  create_force: "the levy",
  disband_force: "the disbandment",
  move_force: "the march",
  assign_command: "the command",
  call_vote: "the vote",
  open_political_procedure: "the motion",
  cast_vote: "the vote",
  nominate_candidate: "the nomination",
  appoint_to_office: "the appointment",
  remove_from_office: "the removal from office",
  give_territory: "the cession of territory",
  change_province_control: "the annexation",
  impose_tribute: "the tribute",
  vassalize_polity: "the submission",
  transfer_gold: "the payment",
  add_gold: "the payment",
  remove_gold: "the levy of money",
  arrange_marriage_alliance: "the marriage",
};

export function orderNounPhrase(actionId: string): string {
  return ORDER_NOUNS[actionId] ?? `the ${humanizeIdentifiers(actionId)}`;
}

/**
 * A short, quasi-historical headline. Never truncates mid-word, never ends on
 * a dangling preposition or comma, and never carries an identifier.
 */
export function chronicleHeadline(source: string, maxWords = 9): string {
  const cleaned = stripEngineJargon(source).replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "An Entry in the Record";

  // Prefer the first clause: a headline is a label, not a sentence.
  const firstClause = cleaned.split(/(?<=[^0-9])[.;:]\s|,\s(?=(?:while|and|but|though)\b)/i)[0] ?? cleaned;
  const words = firstClause.replace(/\.$/, "").split(" ");
  const kept = words.slice(0, maxWords);
  // Never end a headline on a joining word left hanging by the cut.
  while (kept.length > 1 && MINOR_WORDS.has(kept[kept.length - 1]!.toLowerCase())) kept.pop();
  return titleCase(kept.join(" ").replace(/[,;:]$/, ""));
}
