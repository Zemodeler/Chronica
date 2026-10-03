import { DELTA_AUTHORITY_DOMAIN, type WorldDeltaOp } from "../sim/deltas";
import type { Office } from "../characters/character";
import { LEVERS, type StandardLever } from "../world/departments";

/**
 * What an office lets its holder do, in plain words: the office's own list of
 * authorised acts, read back as sentences. The same list the engine judges an
 * order against (`officeIdToDomainPowers`), so the note and the breach check
 * cannot disagree about what a consul may do.
 */

/** Each act in words, the way a clerk would put what it lets a man do. */
const ACT_WORDS: Readonly<Record<WorldDeltaOp, string>> = {
  money_transfer: "spend and move money",
  income_source_upsert: "set up and change revenues",
  obligation_upsert: "set up and change standing payments",
  project_create: "start public works",
  project_milestone_update: "carry works forward",
  force_create: "raise forces",
  force_modify: "reorganise and re-task forces",
  force_reinforce: "reinforce forces",
  force_attrition: "wear down forces",
  character_create: "name new officers",
  character_intent_set: "set his own purposes",
  social_events: "deal with people (favours, slights, promises)",
  generic_entity_create: "establish new matters of state",
  authority_grant_upsert: "delegate authority to others",
  order_attempt_decide: "decide orders put to him",
  polity_stance_shift: "shift the state's stance toward other powers",
  polity_outlook_set: "set the state's outlook",
  legitimacy_shift: "answer for the state's standing",
  province_material_shift: "manage a province's grain, stores and works",
  political_procedure_open: "open a matter before the assemblies",
  political_support_set: "canvass support in the assemblies",
  political_procedure_resolve: "put a matter to its decision",
  holding_transfer: "transfer lands and holdings",
  holding_create: "create holdings",
  holding_improve: "improve holdings",
  force_membership_set: "enrol men in forces and discharge them",
  force_post_set: "give posts in an army",
  trade_venture_open: "open trading ventures",
  trade_venture_close: "close trading ventures",
  generic_entity_update: "amend matters of state",
  loan_open: "lend and borrow",
  loan_settle: "settle loans",
  belief_set: "declare what is held to be true",
  force_engage: "give battle",
  storyline_open: "open a matter for the record",
  storyline_advance: "advance a matter in the record",
  character_pressure_set: "press on other people",
  character_state_set: "set the condition of people in his charge",
  diplomatic_message_send: "send letters and embassies in the state's name",
  diplomatic_message_answer: "answer other powers' letters",
  agreement_open: "open treaties",
  agreement_close: "end treaties",
  province_control_set: "take and cede provinces",
  settlement_control_set: "take and cede towns",
  capital_set: "designate the capital",
  polity_create: "found new powers",
  office_seat_set: "seat men in offices and remove them",
  covert_plot_open: "lay covert plots",
  contingency_arm: "lay orders to be carried out later",
  contingency_disarm: "call such orders off",
  audit_open: "audit those who handle money",
  siege_lay: "lay siege to a town",
  siege_lift: "raise a siege",
  force_provision: "feed and supply forces",
  force_raid: "raid enemy country",
  family_tie_set: "arrange marriages and adoptions",
  character_death: "sentence to death",
  legal_status_set: "free and enslave",
  service_contract_open: "hire companies and ships",
  service_contract_close: "dismiss hired companies",
  regime_change: "change the constitution of the state",
  public_benefaction: "give games, feasts and doles",
};

const DOMAIN_HEADS: Readonly<Record<string, string>> = {
  military: "Command",
  fiscal: "Money",
  civil: "Government",
  diplomatic: "Foreign affairs",
  judicial: "Law and appointment",
  social: "Standing",
};
const DOMAIN_ORDER = ["military", "fiscal", "civil", "diplomatic", "judicial", "social"] as const;

const RESERVED_WORDS: Readonly<Record<string, string>> = {
  declare_war: "declare war",
  extraordinary_tax: "levy an extraordinary tax",
  borrow: "borrow for the state",
  foundational_law: "propose a foundational law",
  over_limit_muster: "muster beyond the usual limit",
};

export interface OfficePowersContext {
  readonly departments?: readonly { readonly name: string; readonly levers: readonly string[]; readonly officeIds: readonly string[]; readonly headOfficeId: string | null }[];
}

const joined = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** One sentence per sphere of power, then the treasury, the reserved powers, the veto and the departments. */
export function describeOfficePowers(office: Office, context: OfficePowersContext = {}): string[] {
  const lines: string[] = [];
  const byDomain = new Map<string, string[]>();
  for (const act of office.authorisedActionIds) {
    const words = ACT_WORDS[act as WorldDeltaOp];
    const domain = DELTA_AUTHORITY_DOMAIN[act as WorldDeltaOp];
    if (words === undefined || domain === undefined || domain === "fiscal") continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), words]);
  }
  // Money acts belong to the treasury line below, where the account is named.
  const moneyActs = office.authorisedActionIds.filter((act) => DELTA_AUTHORITY_DOMAIN[act as WorldDeltaOp] === "fiscal").map((act) => ACT_WORDS[act as WorldDeltaOp]).filter((words) => words !== undefined);
  for (const domain of DOMAIN_ORDER) {
    const acts = byDomain.get(domain);
    if (acts !== undefined && acts.length > 0) lines.push(`${DOMAIN_HEADS[domain]}: may ${joined(acts)}.`);
  }

  const permissions = new Set(office.treasuryPermissions);
  if (office.treasuryAccountId !== null && permissions.size > 0) {
    const treasury = permissions.has("spend_without_vote")
      ? "may spend from the treasury without a vote"
      : permissions.has("propose_spending")
        ? "may propose spending from the treasury, but cannot spend without a vote"
        : "may inspect the treasury's books, and spend nothing";
    lines.push(`Treasury: ${treasury}.`);
  } else if (moneyActs.length > 0) {
    lines.push(`Money: may ${joined(moneyActs)}, but has no treasury of the state to draw on.`);
  }

  if (office.sponsorableCategories.length > 0) {
    lines.push(`May bring before the chamber a motion to ${joined(office.sponsorableCategories.map((category) => RESERVED_WORDS[category] ?? category))}.`);
  }
  if (office.vetoes === true) lines.push("Veto: may forbid a measure, and the world is left to honour it.");
  if (office.enrolsFormerMagistrates === true) lines.push("Every man who has held a magistracy takes a seat in it when his term ends.");

  for (const department of context.departments ?? []) {
    if (!department.officeIds.includes(office.id)) continue;
    const work = department.levers.map((lever) => (LEVERS[lever as StandardLever]?.words ?? null)).filter((words): words is string => words !== null);
    const role = department.headOfficeId === office.id ? "Heads" : "Sits in";
    lines.push(`${role} ${department.name}${work.length > 0 ? `, which has charge of ${joined(work)}` : ""}.`);
  }

  if (lines.length === 0) {
    lines.push("Holds a title and a place in the order of precedence, and no power of its own: its holder may speak, and be heard.");
  }
  return lines;
}
