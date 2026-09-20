import { WORLD_DELTA_OPS, type WorldDeltaOp } from "../sim/deltas";

/**
 * What an office a government invented at the table actually lets its holder do.
 *
 * `character_create` carries an `officeAuthorises` field, the orchestrator is
 * told in its prompt to fill it, and across a whole match it has never once
 * done so: every office the world made -- five of them -- came back with an
 * empty list. An office authorising nothing is a title, which is a real thing
 * to be, but it is not what "name a quaestor to handle the war chest" means,
 * and it is not what the engine then treats it as. Three consequences follow
 * from the empty list, all of them silent:
 *
 *  - `deriveOfficeGrants` derives no grant, so the man holds no authority and
 *    every act of the office he was created for is a breach;
 *  - `assessOrderStanding`'s magistrate rule finds an office but the man under
 *    him is not commanded by it;
 *  - `findWhoWouldNotice` looks for the office whose business a breach was and
 *    finds none, so nobody ever comes across anything.
 *
 * Asking the model again is the fourth prompt rule this session that has gone
 * unread. So the powers are derived from the words of the office's own name
 * instead, and what the model says is taken as an addition to that rather than
 * as the whole of it. A quaestorship pays and audits because that is what the
 * word has meant for two thousand years, not because a model remembered to say
 * so.
 *
 * Words, not ids, and overridable: the codebase has a standing objection to
 * hardcoded government assumptions, so a scenario may pass its own bundles.
 * This is the default a scenario that says nothing gets.
 */

export interface OfficePowerBundle {
  /** Any of these words in the office's label confers the bundle. */
  readonly words: readonly string[];
  readonly grants: readonly WorldDeltaOp[];
}

/**
 * What holding any office of a government means, whatever the office is.
 *
 * Deliberately small, and deliberately all `propose`: an officer may speak,
 * form an intention, be believed, and deal with the people around him. None of
 * it spends money, moves soldiers or binds the government, so an office whose
 * name says nothing still confers nothing that matters.
 */
export const BASE_OFFICE_ACTIONS: readonly WorldDeltaOp[] = [
  "character_intent_set",
  "belief_set",
  "social_events",
  "generic_entity_create",
  "generic_entity_update",
];

export const DEFAULT_OFFICE_POWER_BUNDLES: readonly OfficePowerBundle[] = [
  {
    words: ["quaestor", "treasurer", "treasury", "paymaster", "steward", "steward", "chamberlain", "purse", "exchequer", "tax", "revenue", "collector", "aedile"],
    grants: ["money_transfer", "obligation_upsert", "income_source_upsert", "loan_open", "loan_settle"],
  },
  {
    words: ["legate", "commander", "captain", "general", "prefect", "tribune", "centurion", "admiral", "navarch", "warlord", "marshal", "strategos", "levy", "war"],
    grants: ["force_create", "force_modify", "force_engage", "project_create", "project_milestone_update"],
  },
  {
    words: ["praetor", "judge", "justice", "magistrate", "censor", "archon", "ephor", "chancellor", "speaker", "tribune"],
    grants: ["political_procedure_open", "political_support_set", "political_procedure_resolve", "legitimacy_shift"],
  },
  {
    words: ["envoy", "ambassador", "legate", "herald", "emissary", "proxenos", "diplomat"],
    grants: ["diplomatic_message_send", "diplomatic_message_answer", "agreement_open", "agreement_close"],
  },
  {
    words: ["governor", "proconsul", "propraetor", "satrap", "prefect", "warden", "castellan", "harbourmaster", "harbormaster"],
    grants: ["province_material_shift", "holding_transfer", "force_modify"],
  },
  {
    words: ["pontifex", "priest", "priestess", "augur", "flamen", "hierophant", "oracle", "keeper"],
    grants: ["belief_set", "generic_entity_create"],
  },
  {
    words: ["consul", "king", "queen", "dictator", "suffete", "tyrant", "prince", "emperor", "chief", "chieftain", "head", "first"],
    grants: [
      "force_create", "force_modify", "force_engage", "character_create", "authority_grant_upsert",
      "political_procedure_open", "political_support_set", "political_procedure_resolve",
      "diplomatic_message_send", "diplomatic_message_answer", "polity_stance_shift",
      "province_material_shift", "legitimacy_shift", "project_create", "project_milestone_update",
    ],
  },
];

const words = (label: string): Set<string> =>
  new Set(label.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));

/**
 * The powers an office by this name carries, taking the model's own list as an
 * addition rather than as the whole of it.
 *
 * `stated` is filtered against the delta union here rather than at the call
 * site, so an invented op confers nothing instead of failing the parse.
 */
export function deriveOfficeActions(
  label: string,
  stated: readonly string[] = [],
  bundles: readonly OfficePowerBundle[] = DEFAULT_OFFICE_POWER_BUNDLES,
): WorldDeltaOp[] {
  const known = new Set<string>(WORLD_DELTA_OPS);
  const actions = new Set<WorldDeltaOp>(BASE_OFFICE_ACTIONS);
  for (const action of stated) if (known.has(action)) actions.add(action as WorldDeltaOp);

  const tokens = words(label);
  for (const bundle of bundles) {
    if (!bundle.words.some((word) => tokens.has(word))) continue;
    for (const grant of bundle.grants) actions.add(grant);
  }
  // Stable, so two identical offices made in different orders are identical.
  return WORLD_DELTA_OPS.filter((op) => actions.has(op));
}
