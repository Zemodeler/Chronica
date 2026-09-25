import { z } from "zod";
import { OrderPartyRefSchema, type OrderPartyRef } from "../world/party-ref";
import { EntityIdSchema, ElapsedStepSchema, VisibilitySchema, type MaterialWorldState } from "../material-state";
import type { Office } from "../characters/character";
import {
  AuthorityDomainSchema,
  AuthorityPowerSchema,
  AuthorityScopeSchema,
  AuthoritySourceSchema,
  AuthorityStandingSchema,
  type AuthorityDomain,
  type AuthorityPower,
  type AuthorityScope,
  type AuthorityStanding,
} from "./vocabulary";
import { DELTA_AUTHORITY_DOMAIN, type WorldDeltaOp } from "../sim/deltas";

/**
 * `AuthorityGrant` (docs/32, Phase 7): a persistent, first-class "who may do
 * what, over what, until when" record, unifying rather than replacing the
 * existing office/eligibility/procedure substrate:
 *
 * - `AccountAccess` (`material-state.ts`) stays the actual mechanical
 *   spend-permission gate money workflows already consult -- unchanged.
 * - `EligibilityRequirement`/`resolveEligibility` (`political-authority.ts`)
 *   stay the procedural-participation gate (may this character vote/sponsor/
 *   nominate) -- a different question from "does this character currently
 *   hold standing authority over X" -- unchanged.
 * - `canParticipate`'s `"command"` authority action (procedure type
 *   `command_assignment`) already computes command authority at runtime by
 *   re-reading the procedure log; this module gives that same fact (who
 *   currently commands a force) a first-class, directly queryable form by
 *   reading `Force.commanderCharacterId` -- the field `assign_command`
 *   itself already writes -- rather than re-deriving it from procedure
 *   history a second way.
 *
 * Most grants are *derived*, computed fresh from canonical state on every
 * call (`deriveOfficeGrants`, `deriveCommandGrants`) rather than written by
 * every office/command-mutating workflow -- this is deliberate: a written-at
 * projection would need every present and future workflow that changes an
 * office seat or a force's commander to also remember to write a matching
 * `AuthorityGrant` row, which is exactly the kind of two-places-to-update
 * bug this module exists to avoid. `WorldState.authorityGrants` is reserved
 * for the sources that have no other live-state projection: `delegation`,
 * `custom`, `conquest`, and `emergency` standings, plus `law` grants a
 * scenario or a workflow explicitly records.
 */

export {
  AuthoritySourceSchema,
  AuthorityDomainSchema,
  AuthorityScopeKindSchema,
  AuthorityScopeSchema,
  AuthorityPowerSchema,
  AuthorityStandingSchema,
} from "./vocabulary";
export type { AuthoritySource, AuthorityDomain, AuthorityScopeKind, AuthorityScope, AuthorityPower, AuthorityStanding } from "./vocabulary";

export const AuthorityGrantSchema = z
  .object({
    id: EntityIdSchema,
    holder: OrderPartyRefSchema,
    source: AuthoritySourceSchema,
    /** The office seat / procedure / other record this grant traces to, when it has one. Null for conquest/emergency. */
    sourceRef: EntityIdSchema.nullable().default(null),
    domain: AuthorityDomainSchema,
    scope: AuthorityScopeSchema,
    powers: z.array(AuthorityPowerSchema).min(1),
    standing: AuthorityStandingSchema,
    legitimacyBps: z.number().int().min(0).max(10_000).default(10_000),
    visibility: VisibilitySchema.default("public"),
    grantedAtStep: ElapsedStepSchema,
    expiresAtStep: ElapsedStepSchema.nullable().default(null),
    revokedAtStep: ElapsedStepSchema.nullable().default(null),
    revocationReason: z.string().trim().max(300).nullable().default(null),
    succeedsGrantId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type AuthorityGrant = z.infer<typeof AuthorityGrantSchema>;

/**
 * What power an office's authorised actions actually confer.
 *
 * This used to classify `office.authorisedActionIds` against the workflow
 * registry, and became a stub returning nothing when that registry was deleted.
 * The registry's replacement is the simulation's closed delta union
 * (`sim/deltas.ts`), so an office is now described in exactly the vocabulary
 * the world can be changed in -- an office authorising `force_create` holds
 * military command power, one authorising `money_transfer` holds fiscal spend
 * power, and an id in neither vocabulary confers nothing rather than guessing.
 */
export const DOMAIN_POWER_BY_ACTION: Readonly<Record<string, AuthorityPower>> = {
  force_create: "command",
  force_modify: "command",
  force_reinforce: "command",
  force_attrition: "command",
  money_transfer: "spend",
  income_source_upsert: "spend",
  obligation_upsert: "spend",
  project_create: "propose",
  project_milestone_update: "propose",
  character_create: "appoint",
  authority_grant_upsert: "appoint",
  order_attempt_decide: "command",
  polity_stance_shift: "negotiate",
  generic_entity_create: "propose",
  character_intent_set: "propose",
  social_events: "propose",
  storyline_open: "propose",
  storyline_advance: "propose",
  character_pressure_set: "propose",
  character_state_set: "propose",
  force_raid: "command",
  // The rest of the union. An op an office listed but this map lacked derived
  // no power at all, so a consul resolving a Senate procedure his office
  // plainly authorised was recorded as overreach -- the same power names the
  // engine checks against, in `apply-deltas.ts`'s POWER_BY_OP.
  generic_entity_update: "propose",
  belief_set: "propose",
  force_engage: "command",
  force_membership_set: "command",
  polity_outlook_set: "propose",
  legitimacy_shift: "propose",
  province_material_shift: "propose",
  political_procedure_open: "propose",
  political_support_set: "propose",
  political_procedure_resolve: "override",
  holding_transfer: "punish",
  diplomatic_message_send: "negotiate",
  diplomatic_message_answer: "negotiate",
  // Taking ground is a command. Founding a power is not an office's to do at
  // all, and an office that listed it would derive nothing -- so it derives the
  // highest power there is, and an office that has not been given it breaches.
  province_control_set: "command",
  settlement_control_set: "command",
  polity_create: "override",
  office_seat_set: "appoint",
  agreement_open: "negotiate",
  agreement_close: "negotiate",
  // An office may list it, and none ever should: "punish" is the power a plot
  // helps itself to -- deciding a man has forfeited something, with no court
  // and no hearing. Mapped so that a government which really does authorise
  // its spymaster to do this can say so, and so that everyone who has not been
  // authorised breaches the moment they try.
  covert_plot_open: "punish",
  contingency_arm: "command",
  contingency_disarm: "command",
  family_tie_set: "propose",
  // A government that really does give its magistrates the power of life and
  // death says so by listing this; everybody else breaches when they use it.
  character_death: "punish",
  legal_status_set: "punish",
  service_contract_open: "spend",
  service_contract_close: "spend",
};

function officeIdToDomainPowers(office: Office): { readonly domain: AuthorityDomain; readonly powers: readonly AuthorityPower[] }[] {
  const byDomain = new Map<AuthorityDomain, Set<AuthorityPower>>();
  for (const actionId of office.authorisedActionIds) {
    const domain = DELTA_AUTHORITY_DOMAIN[actionId as WorldDeltaOp];
    const power = DOMAIN_POWER_BY_ACTION[actionId];
    if (domain === undefined || power === undefined) continue;
    // Fiscal authority is never polity-wide here: it is scoped to the office's
    // own named treasury account below, so that a governor authorised to spend
    // does not thereby reach the national treasury.
    if (domain === "fiscal") continue;
    const powers = byDomain.get(domain) ?? new Set<AuthorityPower>();
    powers.add(power);
    byDomain.set(domain, powers);
  }
  return [...byDomain].map(([domain, powers]) => ({ domain, powers: [...powers] }));
}

/**
 * Projects `Office`/`OfficeSeat` state into `AuthorityGrant`s, computed
 * fresh -- never persisted. `offices` is scenario data (not part of
 * `WorldState`), so it is a parameter, the same way `officeGrantsDirectAccess`
 * already takes an `Office` directly rather than looking one up from world
 * state. Fiscal power is scoped to the office's own named treasury account
 * (`Office.treasuryAccountId`/`treasuryPermissions`) rather than the whole
 * polity -- this is what makes "a governor with no treasury access holds no
 * fiscal authority over the national treasury, while a king whose office
 * names it does" fall out of existing data with no new field.
 */
export function deriveOfficeGrants(
  officeSeats: MaterialWorldState["officeSeats"],
  offices: readonly Office[],
  atStep: number,
): AuthorityGrant[] {
  const grants: AuthorityGrant[] = [];
  for (const seat of officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const office = offices.find((o) => o.id === seat.officeId);
    if (office === undefined) continue;
    const holder: OrderPartyRef = { kind: "character", id: seat.holderCharacterId };
    for (const { domain, powers } of officeIdToDomainPowers(office)) {
      grants.push(
        AuthorityGrantSchema.parse({
          id: `office:${seat.id}:${domain}`,
          holder,
          source: "office",
          sourceRef: seat.id,
          domain,
          scope: { kind: "polity", id: office.polityId },
          powers,
          standing: "lawful",
          grantedAtStep: seat.termStartedAtStep ?? atStep,
          expiresAtStep: seat.termExpiresAtStep,
        }),
      );
    }
    if (office.treasuryAccountId !== null && office.treasuryPermissions.length > 0) {
      const powers: AuthorityPower[] = [];
      if (office.treasuryPermissions.includes("spend_without_vote")) powers.push("spend");
      if (office.treasuryPermissions.includes("propose_spending")) powers.push("propose");
      if (powers.length > 0) {
        grants.push(
          AuthorityGrantSchema.parse({
            id: `office:${seat.id}:fiscal`,
            holder,
            source: "office",
            sourceRef: seat.id,
            domain: "fiscal",
            scope: { kind: "account", id: office.treasuryAccountId },
            powers,
            standing: "lawful",
            grantedAtStep: seat.termStartedAtStep ?? atStep,
            expiresAtStep: seat.termExpiresAtStep,
          }),
        );
      }
    }
  }
  return grants;
}

/**
 * Projects live command authority from `Force.commanderCharacterId` --
 * exactly what `assign_command` (resolved from a `command_assignment`
 * procedure) already writes -- into `AuthorityGrant`s. Computed fresh, never
 * persisted, for the same reason as `deriveOfficeGrants`.
 */
export function deriveCommandGrants(forces: MaterialWorldState["forces"], atStep: number): AuthorityGrant[] {
  const grants: AuthorityGrant[] = [];
  for (const force of forces) {
    grants.push(
      AuthorityGrantSchema.parse({
        id: `command:${force.id}`,
        holder: { kind: "character", id: force.commanderCharacterId },
        source: "command",
        sourceRef: force.id,
        domain: "military",
        scope: { kind: "force", id: force.id },
        powers: ["command"],
        standing: "lawful",
        grantedAtStep: atStep,
      }),
    );
  }
  return grants;
}

/**
 * Fiscal authority over one's own money.
 *
 * Office grants cover an office's named treasury and nothing else, so without
 * this a character spending their own purse was recorded as an authority
 * breach -- which made every privately-funded act look like embezzlement.
 * Ownership is not an office, and does not expire.
 */
/**
 * Whether a grant is only a man's say over what is his: his purse, and the men
 * it pays. Everybody holds those, so counting them made every private citizen
 * a figure of the state -- in who the world asks what they are doing, in who
 * counts as a man's peer, and in who is offered a dead man's house.
 */
export const isOwnPurseGrant = (grant: Pick<AuthorityGrant, "id">): boolean => grant.id.startsWith("owner:");

export function deriveOwnerGrants(accounts: MaterialWorldState["accounts"], atStep: number): AuthorityGrant[] {
  return accounts
    .filter((account) => account.owner.kind === "character" && account.status === "active")
    .flatMap((account) => [
      AuthorityGrantSchema.parse({
        id: `owner:${account.id}`,
        holder: { kind: "character", id: account.owner.id },
        source: "custom",
        sourceRef: account.id,
        domain: "fiscal",
        scope: { kind: "account", id: account.id },
        powers: ["spend", "propose"],
        standing: "lawful",
        grantedAtStep: atStep,
      }),
      // Command of men his own money pays: a merchant's armed ship, a noble's
      // clients under arms. Only a force raised against this purse is weighed
      // against it (sim `scopeOf`, "force_create"), so this reaches nothing
      // the state pays for.
      AuthorityGrantSchema.parse({
        id: `owner:${account.id}:company`,
        holder: { kind: "character", id: account.owner.id },
        source: "custom",
        sourceRef: account.id,
        domain: "military",
        scope: { kind: "account", id: account.id },
        powers: ["command"],
        standing: "lawful",
        grantedAtStep: atStep,
      }),
    ]);
}

/** A prebuilt lookup over every currently-active grant (derived from offices, commands and ownership, plus persisted `WorldState.authorityGrants`). */
export interface AuthorityIndex {
  readonly grants: readonly AuthorityGrant[];
}

export function isActive(grant: AuthorityGrant, atStep: number): boolean {
  if (grant.revokedAtStep !== null && grant.revokedAtStep <= atStep) return false;
  if (grant.expiresAtStep !== null && grant.expiresAtStep <= atStep) return false;
  return true;
}

export function buildAuthorityIndex(
  material: Pick<MaterialWorldState, "officeSeats" | "forces"> & Partial<Pick<MaterialWorldState, "accounts">>,
  persistedGrants: readonly AuthorityGrant[] | undefined,
  offices: readonly Office[],
  atStep: number,
): AuthorityIndex {
  const derived = [
    ...deriveOfficeGrants(material.officeSeats, offices, atStep),
    ...deriveCommandGrants(material.forces, atStep),
    ...deriveOwnerGrants(material.accounts ?? [], atStep),
  ];
  const persisted = (persistedGrants ?? []).filter((grant) => isActive(grant, atStep));
  return { grants: [...derived, ...persisted] };
}

export interface AuthorityCheckInput {
  readonly holder: OrderPartyRef;
  readonly domain: AuthorityDomain;
  readonly scope: AuthorityScope;
  readonly power: AuthorityPower;
}

export interface AuthorityCheckResult {
  readonly authorized: boolean;
  readonly grant: AuthorityGrant | null;
  readonly standing: AuthorityStanding | null;
  readonly reason: string;
}

/** Zod counterpart of `AuthorityCheckResult`, for embedding a snapshot of one (e.g. `OrderAttempt.authorityCheck`) in validated state. */
export const AuthorityCheckResultSchema = z
  .object({
    authorized: z.boolean(),
    grant: AuthorityGrantSchema.nullable(),
    standing: AuthorityStandingSchema.nullable(),
    reason: z.string().max(400),
  })
  .strict();

/**
 * A polity-scope grant satisfies a check against a narrower scope belonging
 * to that polity (a province, settlement, force, or institution the polity
 * controls) -- the hierarchy walk `checkAuthority` needs so a king's
 * polity-wide grant covers a specific province without a separate grant per
 * province. `containsFn`, supplied by the caller, answers "is `narrower`
 * part of `broader`" using live map/material state `checkAuthority` itself
 * does not have -- kept as an injected predicate rather than a `WorldState`
 * parameter so this module's core logic stays testable against fixtures
 * with no real map graph.
 */
export type ScopeContainsFn = (broader: AuthorityScope, narrower: AuthorityScope) => boolean;

export const scopeExactlyMatches: ScopeContainsFn = (broader, narrower) => broader.kind === narrower.kind && broader.id === narrower.id;

export function checkAuthority(index: AuthorityIndex, input: AuthorityCheckInput, scopeContains: ScopeContainsFn = scopeExactlyMatches): AuthorityCheckResult {
  const candidates = index.grants.filter(
    (grant) =>
      grant.holder.kind === input.holder.kind &&
      grant.holder.id === input.holder.id &&
      grant.domain === input.domain &&
      grant.powers.includes(input.power),
  );
  const matching = candidates.find((grant) => scopeExactlyMatches(grant.scope, input.scope) || scopeContains(grant.scope, input.scope));
  if (matching !== undefined) {
    return { authorized: true, grant: matching, standing: matching.standing, reason: `Authorized by ${matching.source} grant ${matching.id}.` };
  }
  return {
    authorized: false,
    grant: null,
    standing: null,
    reason: `No active grant gives ${input.holder.kind} "${input.holder.id}" ${input.power} power in the ${input.domain} domain over ${input.scope.kind} "${input.scope.id}".`,
  };
}
