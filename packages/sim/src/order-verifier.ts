/**
 * A deterministic check of a part of an order against the acts written for it
 * (plan chronicle-and-order-truth, 1.1; decision D1: no second model call).
 *
 * The orchestrator reads the order and writes acts. Nothing checked that the
 * acts are of the kind the words ask for: "hire ships" was answered with a
 * march, "appoint someone to examine the accusation" with a letter. A part
 * that has acts, none of them the kind its opening verb asks for, is flagged.
 * The flag is said beside the part and written to the audit; it never refuses
 * the order, because a wording the table does not know is not the player's
 * fault, and a flag the player can read is cheaper than a rejection he cannot.
 */

interface Kind {
  readonly name: string;
  /** The opening verb of the part, as the player says it. */
  readonly verb: RegExp;
  /** Acts that answer it. */
  readonly ops: ReadonlySet<string>;
}

const kind = (name: string, verb: RegExp, ops: readonly string[]): Kind => ({ name, verb, ops: new Set(ops) });

const KINDS: readonly Kind[] = [
  kind("an appointment", /^(?:appoint|name|make\s+\S+(?:\s+\S+)?\s+(?:governor|legate|consul|praetor|prefect|commander))\b/i, ["office_seat_set", "authority_grant_upsert", "political_procedure_open", "force_post_set"]),
  kind("a movement of an army or fleet", /^(?:march|move|carry|transport|ferry|bring|sail|station|post|withdraw|send\s+(?:the\s+)?(?:army|legion|legions|fleet|troops|men|ships))\b/i, ["force_modify", "project_create", "siege_lay", "force_transfer", "force_post_set", "force_engage", "force_raid"]),
  kind("raising or building", /^(?:hire|raise|levy|recruit|muster|build|construct|equip|reinforce|enlist)\b/i, ["force_create", "force_reinforce", "service_contract_open", "project_create", "holding_create", "holding_improve", "political_procedure_open", "money_transfer"]),
  kind("a supply of bread", /^(?:supply|provision|victual|feed|find\s+(?:supply|supplies|bread|grain|provisions)|get\s+(?:supplies|bread|grain)|buy\s+(?:bread|grain))\b/i, ["force_provision", "project_create", "service_contract_open", "legitimacy_shift"]),
  kind("a letter or embassy", /^(?:write|send\s+(?:a\s+)?(?:letter|embassy|envoy|message|word|ambassador)|offer|propose|ask|petition|demand|negotiate)\b/i, ["diplomatic_message_send", "diplomatic_message_answer", "agreement_open", "political_procedure_open", "political_support_set", "submission", "indemnity", "hostage"]),
  kind("a payment", /^(?:pay|allocate|fund|spend|give\s+\S+\s+(?:gold|silver|talents|money|coin))\b/i, ["money_transfer", "income_source_upsert", "loan_open", "loan_settle", "public_benefaction", "project_create", "obligation_upsert"]),
  kind("an inquiry", /^(?:audit|examine|investigate|inquire|inspect|check\s+the\s+books)\b/i, ["audit_open", "covert_plot_open"]),
  kind("an assault or siege", /^(?:besiege|siege|attack|assault|storm|raid|destroy|hunt)\b/i, ["siege_lay", "force_engage", "force_modify", "force_raid", "project_create"]),
];

/** What a part's opening verb asks for, or null when its wording is not one the table knows. */
export function kindAskedFor(said: string): string | null {
  const opening = said.trim().replace(/^(?:and|then|also|first|next|please)\s+/i, "");
  return KINDS.find((candidate) => candidate.verb.test(opening))?.name ?? null;
}

export interface PartToVerify {
  readonly said: string;
  /** Ops of the acts written for the part, carried, refused or held. */
  readonly ops: readonly string[];
  /** Whether the part was handed on to somebody, which answers "appoint", "send" and "examine". */
  readonly handedOn: boolean;
}

/** Why the acts do not look like what the words ask for, or null when they do (or nothing can be said). */
export function verifyPart(part: PartToVerify): string | null {
  if (part.ops.length === 0 || part.handedOn) return null;
  const opening = part.said.trim().replace(/^(?:and|then|also|first|next|please)\s+/i, "");
  const asked = KINDS.find((candidate) => candidate.verb.test(opening));
  if (asked === undefined || part.ops.some((op) => asked.ops.has(op))) return null;
  return `Check: this asked for ${asked.name}, and what was written for it is ${[...new Set(part.ops)].join(", ").replace(/_/g, " ")}.`;
}
