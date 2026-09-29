import {
  adjustPolityLegitimacy,
  agreementsBetween,
  aNameFor,
  alliesLedBy,
  applyRecruitmentToMaterial,
  atWar,
  createCanonicalNpc,
  economyOf,
  hopsBetween,
  isStanding,
  leaderOf,
  openWar,
  provinceTaxCapacity,
  stableHash,
  warsOf,
  type EconomyMemory,
  type FactProposalDraft,
  type PolityAgreement,
  type PolityStance,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * What a treaty makes happen, done on the calendar (VISION §3, §27).
 *
 * Agreements were promises no rule kept. A tributary paid nothing; a treaty's
 * payments went on after the war it ended had opened again, because only
 * tearing a treaty up by name stopped them; a missed indemnity was a line in
 * the arrears and nothing more; breaking a peace cost the breaker nothing with
 * anybody; and an ally bound by foedus was "at war whenever its leader was"
 * without ever sending a man, while an ally by treaty could watch its partner
 * be invaded. Now:
 *
 *  - **What a treaty pays stops when the treaty does**, wherever it ends: torn
 *    up, broken by war, lapsed or with a power that is no more.
 *  - **A tributary pays**: a tenth of what its lands yield, monthly, unless the
 *    treaty set a sum of its own.
 *  - **Tribute unpaid three times is a treaty broken**: the creditor's trust
 *    falls, it has a grievance to make war over, and a stronger creditor does.
 *  - **Breaking a peace costs the breaker**, at home and with every power that
 *    has dealings with it -- unless it had a grievance to make war over.
 *  - **Allies come.** A leader at war levies its foedus allies' contingents the
 *    day the war opens; a power attacked calls on its allies by treaty, and
 *    each answers by how it trusts the two sides, how many wars it is in and
 *    how strong the attacker is -- and pays in trust for refusing.
 */

/** Missed payments on a treaty's tribute before the treaty counts as broken. */
export const BREACH_AFTER_MISSED = 3;
/** Of a tributary's monthly yield, what it pays where the treaty named no sum. */
export const DEFAULT_TRIBUTE_SHARE = 0.1;
/** How long after a war opens its peace and its allies are still weighed. */
const WAR_REVIEW_DAYS = 60;
/** What a power will spare of its men of military age for its leader's war, and the most it sends. */
const CONTINGENT_SHARE = 0.2;
const CONTINGENT_MAX = 4_000;
const CONTINGENT_MIN = 200;
/** A campaigning season, in days: an ally's contingent is owed once in one, across every war its leader fights. */
export const CONTINGENT_SEASON_DAYS = 365;
/** Days the player's own power has to answer a call to arms. */
const CALL_DAYS = 30;

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
const listed = (names: readonly string[]): string => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`);
const fitOf = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** Men under arms, by power. */
export const menUnderArms = (world: WorldState, polityId: string): number =>
  world.material.forces.filter((force) => force.polityId === polityId).reduce((sum, force) => sum + fitOf(force), 0);

export const trustOf = (world: WorldState, polityId: string, towardPolityId: string): number =>
  world.polityStances.find((stance) => stance.polityId === polityId && stance.towardPolityId === towardPolityId)?.trustScore ?? 0;

/** One power's trust in another moved, bounded as every stance is. */
export function shiftTrust(stances: readonly PolityStance[], polityId: string, towardPolityId: string, delta: number, reason: string, atStep: number): PolityStance[] {
  if (polityId === towardPolityId || delta === 0) return [...stances];
  const existing = stances.find((stance) => stance.polityId === polityId && stance.towardPolityId === towardPolityId);
  return [
    ...stances.filter((stance) => stance !== existing),
    { polityId, towardPolityId, trustScore: Math.max(-100, Math.min(100, (existing?.trustScore ?? 0) + delta)), lastShiftReason: reason.slice(0, 240), lastShiftAtStep: atStep },
  ];
}

const withMemory = (world: WorldState, change: Partial<EconomyMemory>): WorldState => ({ ...world, economy: { ...economyOf(world), ...change } });

/** A grievance one power holds against another: a reason to make war without breaking faith. */
export function hasGrievance(world: WorldState, polityId: string, againstPolityId: string): boolean {
  return economyOf(world).grievances.some((grievance) => grievance.polityId === polityId && grievance.againstPolityId === againstPolityId);
}

function addGrievance(world: WorldState, polityId: string, againstPolityId: string, reason: string, atStep: number): WorldState {
  if (hasGrievance(world, polityId, againstPolityId)) return world;
  return withMemory(world, { grievances: [...economyOf(world).grievances, { polityId, againstPolityId, reason: reason.slice(0, 240), sinceStep: atStep }].slice(-200) });
}

/**
 * The one rule: what an agreement pays -- an indemnity, a tribute -- stops
 * when the agreement ends, however it ended. Only tearing it up by name used
 * to stop it, so a war that ended a peace left the defeated paying their
 * indemnity to the enemy they were fighting.
 */
export function endObligationsOfEndedAgreements(world: WorldState): WorldState {
  const ended = new Set(world.polityAgreements.filter((agreement) => agreement.status === "ended").map((agreement) => agreement.id));
  if (ended.size === 0) return world;
  if (!world.material.obligations.some((obligation) => obligation.active && obligation.consequenceRef !== undefined && ended.has(obligation.consequenceRef))) return world;
  return {
    ...world,
    material: {
      ...world.material,
      obligations: world.material.obligations.map((obligation) => (obligation.active && obligation.consequenceRef !== undefined && ended.has(obligation.consequenceRef) ? { ...obligation, active: false } : obligation)),
    },
  };
}

export interface TreatyInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** Whose decisions are the player's: a call to arms waits for his answer rather than being made for him. */
  readonly playerPolityId: string | null;
}

export function keepTreaties(input: TreatyInput): { world: WorldState; facts: FactProposalDraft[] } {
  const { toDay, ids } = input;
  const facts: FactProposalDraft[] = [];
  let world = endObligationsOfEndedAgreements(input.world);
  const treasuryOf = (polityId: string) => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active");
  const polityOfAccount = (accountId: string | undefined): string | null => {
    const owner = world.material.accounts.find((account) => account.id === accountId)?.owner;
    return owner?.kind === "polity" ? owner.id : null;
  };

  // ── A tributary pays ───────────────────────────────────────────────────
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "tributary") continue;
    if (world.material.obligations.some((obligation) => obligation.consequenceRef === agreement.id)) continue;
    const from = treasuryOf(agreement.polityId);
    const to = treasuryOf(agreement.otherPolityId);
    if (from === undefined || to === undefined || from.id === to.id) continue;
    const yieldOf = world.map.provinces.filter((province) => province.controllerPolityId === agreement.polityId).reduce((sum, province) => sum + (provinceTaxCapacity(world, province.id) ?? 0), 0);
    const amount = Math.max(1, Math.round(yieldOf * DEFAULT_TRIBUTE_SHARE));
    world = {
      ...world,
      material: {
        ...world.material,
        obligations: [...world.material.obligations, {
          id: ids.next("obligation"),
          kind: "tribute" as const,
          label: `Tribute owed by ${nameOf(world, agreement.polityId)} to ${nameOf(world, agreement.otherPolityId)}`.slice(0, 120),
          payerAccountId: from.id,
          recipientAccountId: to.id,
          amount,
          cadenceSteps: 30,
          nextDueStep: toDay + 30,
          priority: 450,
          arrears: 0,
          missedPeriods: 0,
          active: true,
          consequenceRef: agreement.id,
        }],
      },
    };
  }

  // ── Tribute unpaid is a treaty broken ──────────────────────────────────
  const activeAgreement = new Map(world.polityAgreements.filter((agreement) => agreement.status === "active").map((agreement) => [agreement.id, agreement]));
  for (const obligation of world.material.obligations) {
    if (!obligation.active || obligation.kind !== "tribute" || obligation.missedPeriods < BREACH_AFTER_MISSED) continue;
    if (obligation.consequenceRef === undefined || !activeAgreement.has(obligation.consequenceRef)) continue;
    if (economyOf(world).breachedObligationIds.includes(obligation.id)) continue;
    const debtor = polityOfAccount(obligation.payerAccountId);
    const creditor = polityOfAccount(obligation.recipientAccountId);
    if (debtor === null || creditor === null || debtor === creditor) continue;
    const treaty = activeAgreement.get(obligation.consequenceRef)!;
    world = withMemory(world, { breachedObligationIds: [...economyOf(world).breachedObligationIds, obligation.id].slice(-400) });
    world = { ...world, polityStances: shiftTrust(world.polityStances, creditor, debtor, -30, `${nameOf(world, debtor)} stopped paying what the ${treaty.kind} owes`, toDay) };
    world = addGrievance(world, creditor, debtor, `${nameOf(world, debtor)} broke the ${treaty.kind} by not paying it`, toDay);
    facts.push({
      localId: `breach_${obligation.id}`.slice(0, 60),
      kind: "treaty_breached",
      summary: `${nameOf(world, debtor)} has broken its treaty with ${nameOf(world, creditor)}: ${obligation.label.toLowerCase()} has gone unpaid ${obligation.missedPeriods} times, ${obligation.arrears} in arrears. ${nameOf(world, creditor)} has cause for war.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: debtor }, { kind: "polity", id: creditor }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 70,
    });
    // A creditor strong enough to collect goes and collects. The player's own
    // power is told it may; whether it does is his.
    const strongEnough = menUnderArms(world, creditor) >= 1.5 * Math.max(1, menUnderArms(world, debtor));
    if (creditor !== input.playerPolityId && strongEnough && !atWar(world.polityAgreements, creditor, debtor) && leaderOf(world.polityAgreements, creditor) === null && leaderOf(world.polityAgreements, debtor) === null) {
      world = {
        ...world,
        polityAgreements: openWar(world.polityAgreements, {
          id: ids.next("agreement"), polityId: creditor, otherPolityId: debtor, terms: `To collect what the ${treaty.kind} owes.`,
          atStep: toDay, sourceMessageId: null, reason: `${nameOf(world, debtor)} broke the ${treaty.kind} by not paying it.`,
        }),
      };
      facts.push({
        localId: `collect_${obligation.id}`.slice(0, 60),
        kind: "war_declared",
        summary: `${nameOf(world, creditor)} made war on ${nameOf(world, debtor)} to collect the tribute it had stopped paying.`,
        affectedRefs: [{ kind: "polity", id: creditor }, { kind: "polity", id: debtor }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 75,
      });
    }
  }

  // ── Wars just opened: the peace they broke, the allies they call ───────
  // The wars the world began with have had their allies raised already.
  if (economyOf(world).treatiesKeptSince === null) {
    const standing = world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active").map((agreement) => agreement.id);
    world = withMemory(world, { treatiesKeptSince: toDay, reviewedWarIds: [...economyOf(world).reviewedWarIds, ...standing].slice(-400) });
  }
  const fresh = world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active"
    && toDay - agreement.sinceStep <= WAR_REVIEW_DAYS
    && !economyOf(world).reviewedWarIds.includes(agreement.id));
  for (const war of fresh) {
    world = withMemory(world, { reviewedWarIds: [...economyOf(world).reviewedWarIds, war.id].slice(-400) });
    const broke = brokenPeace(world, war);
    facts.push(...broke.facts);
    world = broke.world;
    const levied = levyContingents(world, war, ids, input.playerPolityId);
    facts.push(...levied.facts);
    world = levied.world;
    const called = callAllies(world, war, ids, input.playerPolityId, toDay);
    facts.push(...called.facts);
    world = called.world;
  }

  // ── The player's own answer to a call ──────────────────────────────────
  const pending = economyOf(world).pendingCalls;
  if (pending.length > 0) {
    const still: EconomyMemory["pendingCalls"] = [];
    for (const call of pending) {
      const war = world.polityAgreements.find((agreement) => agreement.id === call.warId);
      if (war === undefined || war.status !== "active" || atWar(world.polityAgreements, call.allyPolityId, call.enemyPolityId)) continue;
      if (toDay < call.dueStep) { still.push(call); continue; }
      const refused = refuseCall(world, call.allyPolityId, call.callerPolityId, call.enemyPolityId, toDay);
      world = refused.world;
      facts.push(refused.fact);
    }
    world = withMemory(world, { pendingCalls: still });
  }

  return { world: endObligationsOfEndedAgreements(world), facts };
}

/** Kinds a war breaks faith by ending. A foedus ended by war is a revolt, and is its own story. */
const FAITH_KINDS: readonly PolityAgreement["kind"][] = ["peace", "truce", "non_aggression", "alliance"];

function brokenPeace(world: WorldState, war: PolityAgreement): { world: WorldState; facts: FactProposalDraft[] } {
  const breaker = war.polityId;
  const victim = war.otherPolityId;
  const broken = world.polityAgreements.find((agreement) => agreement.status === "ended" && agreement.endedAtStep === war.sinceStep
    && FAITH_KINDS.includes(agreement.kind)
    && ((agreement.polityId === breaker && agreement.otherPolityId === victim) || (agreement.polityId === victim && agreement.otherPolityId === breaker))
    && (agreement.untilStep === null || agreement.untilStep > war.sinceStep));
  if (broken === undefined || hasGrievance(world, breaker, victim)) return { world, facts: [] };
  const breakerName = nameOf(world, breaker);
  let stances = shiftTrust(world.polityStances, victim, breaker, -40, `${breakerName} broke the ${broken.kind} with them`, war.sinceStep);
  // Everyone who has dealings with the breaker learns what its word is worth.
  const witnesses = [...new Set(world.polityAgreements
    .filter((agreement) => agreement.status === "active" && agreement.kind !== "war" && (agreement.polityId === breaker || agreement.otherPolityId === breaker))
    .map((agreement) => (agreement.polityId === breaker ? agreement.otherPolityId : agreement.polityId)))]
    .filter((id) => id !== victim).sort().slice(0, 12);
  for (const witness of witnesses) stances = shiftTrust(stances, witness, breaker, -10, `${breakerName} broke its ${broken.kind} with ${nameOf(world, victim)}`, war.sinceStep);
  const next: WorldState = {
    ...world,
    polityStances: stances,
    material: { ...world.material, polityLegitimacy: adjustPolityLegitimacy(world.material.polityLegitimacy, breaker, -600, `Broke its ${broken.kind} with ${nameOf(world, victim)}`, `broken-${war.id}`) },
  };
  return {
    world: addGrievance(next, victim, breaker, `${breakerName} broke the ${broken.kind}`, war.sinceStep),
    facts: [{
      localId: `faith_broken_${war.id}`.slice(0, 60),
      kind: "peace_broken",
      summary: `${breakerName} broke its ${broken.kind} with ${nameOf(world, victim)} to make this war, and every power that deals with it has seen what its word is worth.`,
      affectedRefs: [{ kind: "polity", id: breaker }, { kind: "polity", id: victim }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 65,
    }],
  };
}

/**
 * A leader at war calls up its allies' men. Each sends a contingent from its
 * own manpower, under its own command, from the province of its nearest to the
 * leader's army. The player's own power, bound as an ally, is told it is called
 * and sends what it chooses.
 *
 * The foedus owes one contingent a season, not one a war: an ally whose men
 * already marched this season for another of its leader's wars is serving in
 * that one, and is not levied again.
 */
function levyContingents(world: WorldState, war: PolityAgreement, ids: IdFactory, playerPolityId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const [leader, enemy] of [[war.polityId, war.otherPolityId], [war.otherPolityId, war.polityId]] as const) {
    const allies = alliesLedBy(next.polityAgreements, leader).filter((ally) => ally !== enemy && !atWar(next.polityAgreements, ally, leader)).sort();
    const sent: { polityId: string; men: number }[] = [];
    for (const ally of allies) {
      const polity = next.map.polities.find((candidate) => candidate.id === ally);
      if (polity === undefined || !isStanding(polity)) continue;
      const lastSent = economyOf(next).contingentsSent.find((entry) => entry.polityId === ally)?.atStep;
      if (lastSent !== undefined && Math.abs(war.sinceStep - lastSent) < CONTINGENT_SEASON_DAYS) continue;
      next = withMemory(next, { contingentsSent: [...economyOf(next).contingentsSent.filter((entry) => entry.polityId !== ally), { polityId: ally, atStep: war.sinceStep }].slice(-200) });
      if (ally === playerPolityId) {
        facts.push({
          localId: `levy_called_${war.id}_${ally}`.slice(0, 60),
          kind: "call_to_arms",
          summary: `${nameOf(next, leader)} calls on ${nameOf(next, ally)} for its contingent, as the foedus binds it, for the war with ${nameOf(next, enemy)}.`,
          affectedRefs: [{ kind: "polity", id: ally }, { kind: "polity", id: leader }, { kind: "polity", id: enemy }],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 60,
        });
        continue;
      }
      const lands = next.material.provinceMaterial.filter((row) => next.map.provinces.some((province) => province.id === row.provinceId && province.controllerPolityId === ally));
      const available = lands.reduce((sum, row) => sum + row.availableManpower, 0);
      const men = Math.min(CONTINGENT_MAX, Math.floor(available * CONTINGENT_SHARE));
      if (men < CONTINGENT_MIN) continue;
      // Where it musters: its province nearest the leader's largest army.
      const army = [...next.material.forces].filter((force) => force.polityId === leader).sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id))[0];
      const muster = lands.map((row) => row.provinceId).sort()
        .map((provinceId) => ({ provinceId, hops: army === undefined ? 0 : hopsBetween(next, provinceId, army.locationId, 8) ?? 99 }))
        .sort((a, b) => a.hops - b.hops)[0]?.provinceId;
      if (muster === undefined) continue;
      let commander = next.characters.filter((character) => character.alive && character.polityId === ally && !next.material.forces.some((force) => force.commanderCharacterId === character.id))
        .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0]?.id ?? null;
      if (commander === null) {
        const made = createCanonicalNpc(next, {
          characterId: ids.next("character"),
          name: aNameFor(ally, `contingent-${war.id}`, new Set(next.characters.map((character) => character.name))),
          locationProvinceId: muster, polityId: ally, createdAtStep: war.sinceStep, creationReason: `Led ${polity.name}'s contingent to ${nameOf(next, leader)}'s war.`,
          ageYearsAtStart: 36, prestigeBps: 4_500,
        });
        if (made === null) continue;
        next = made.world;
        commander = made.character.id;
      }
      // Drawn from each of its provinces in proportion to the men it has.
      const share = men / Math.max(1, available);
      next = {
        ...next,
        material: {
          ...next.material,
          provinceMaterial: next.material.provinceMaterial.map((row) => (lands.some((land) => land.provinceId === row.provinceId)
            ? applyRecruitmentToMaterial(row, Math.floor(row.availableManpower * share), war.sinceStep) : row)),
          forces: [...next.material.forces, {
            id: ids.next("force"), name: `The ${polity.name} contingent`.slice(0, 120), polityId: ally,
            commanderCharacterId: commander, controllerCharacterId: commander, locationId: muster, positionId: null, authorizedStrength: men,
            personnel: [{ categoryId: "infantry", label: "Allied infantry", fit: men, unavailable: [] }],
            moraleBps: 6_000, cohesionBps: 5_500, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: war.sinceStep + 30,
            payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
          }],
        },
        characters: next.characters.map((character) => (character.id === commander ? { ...character, locationProvinceId: muster } : character)),
      };
      sent.push({ polityId: ally, men });
    }
    if (sent.length > 0) {
      const total = sent.reduce((sum, entry) => sum + entry.men, 0);
      facts.push({
        localId: `levied_${war.id}_${leader}`.slice(0, 60),
        kind: "allies_levied",
        summary: `${listed(sent.map((entry) => nameOf(next, entry.polityId)))} sent ${total} men to ${nameOf(next, leader)}'s war with ${nameOf(next, enemy)}, as the foedus binds them.`.slice(0, 600),
        affectedRefs: [{ kind: "polity", id: leader }, { kind: "polity", id: enemy }, ...sent.slice(0, 6).map((entry) => ({ kind: "polity" as const, id: entry.polityId }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 50,
      });
    }
  }
  return { world: next, facts };
}

/**
 * A power attacked calls on its allies by treaty. Each decides by how it
 * trusts the two sides, how many wars it is already in, and whether the
 * attacker is far stronger -- with a roll, so two allies alike do not always
 * answer alike. The player's own power has a month to answer by going to war.
 */
function callAllies(world: WorldState, war: PolityAgreement, ids: IdFactory, playerPolityId: string | null, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const attacker = war.polityId;
  const defender = war.otherPolityId;
  let next = world;
  const facts: FactProposalDraft[] = [];
  const partners = [...new Set(next.polityAgreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "alliance" && (agreement.polityId === defender || agreement.otherPolityId === defender))
    .map((agreement) => (agreement.polityId === defender ? agreement.otherPolityId : agreement.polityId)))]
    .filter((ally) => ally !== attacker).sort();
  for (const ally of partners) {
    const polity = next.map.polities.find((candidate) => candidate.id === ally);
    if (polity === undefined || !isStanding(polity)) continue;
    if (atWar(next.polityAgreements, ally, attacker) || leaderOf(next.polityAgreements, ally) !== null) continue;
    // Allied to both: it sits this one out, and owes neither.
    if (agreementsBetween(next.polityAgreements, ally, attacker).some((agreement) => agreement.kind === "alliance")) continue;
    if (ally === playerPolityId) {
      next = withMemory(next, { pendingCalls: [...economyOf(next).pendingCalls, { warId: war.id, allyPolityId: ally, callerPolityId: defender, enemyPolityId: attacker, dueStep: toDay + CALL_DAYS }].slice(-40) });
      facts.push({
        localId: `called_${war.id}_${ally}`.slice(0, 60),
        kind: "call_to_arms",
        summary: `${nameOf(next, defender)} has been attacked by ${nameOf(next, attacker)} and calls on ${nameOf(next, ally)} to honour their alliance. It will count ${CALL_DAYS} days without a declaration of war as a refusal.`,
        affectedRefs: [{ kind: "polity", id: ally }, { kind: "polity", id: defender }, { kind: "polity", id: attacker }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 65,
      });
      continue;
    }
    const weary = warsOf(next.polityAgreements, ally).length;
    const outmatched = menUnderArms(next, attacker) > 3 * Math.max(1, menUnderArms(next, ally));
    const roll = (stableHash(["call-to-arms", war.id, ally]) % 31) - 15;
    const willing = 50 + trustOf(next, ally, defender) - Math.max(0, trustOf(next, ally, attacker)) / 2 - 15 * weary - (outmatched ? 20 : 0) + roll;
    if (willing >= 45) {
      next = {
        ...next,
        polityAgreements: openWar(next.polityAgreements, {
          id: ids.next("agreement"), polityId: ally, otherPolityId: attacker, terms: `In defence of ${nameOf(next, defender)}, its ally.`,
          atStep: toDay, sourceMessageId: null, reason: `${nameOf(next, ally)} kept its alliance with ${nameOf(next, defender)}.`,
        }),
      };
      next = addGrievance(next, ally, attacker, `${nameOf(next, attacker)} attacked its ally ${nameOf(next, defender)}`, toDay);
      // Answered, not made: this war is the ally keeping faith, and breaks none.
      next = withMemory(next, { reviewedWarIds: [...economyOf(next).reviewedWarIds, next.polityAgreements.at(-1)!.id].slice(-400) });
      next = { ...next, polityStances: shiftTrust(next.polityStances, defender, ally, 15, `${nameOf(next, ally)} came to its aid`, toDay) };
      facts.push({
        localId: `ally_joined_${war.id}_${ally}`.slice(0, 60),
        kind: "war_declared",
        summary: `${nameOf(next, ally)} went to war with ${nameOf(next, attacker)}, as its alliance with ${nameOf(next, defender)} bound it to.`,
        affectedRefs: [{ kind: "polity", id: ally }, { kind: "polity", id: attacker }, { kind: "polity", id: defender }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 70,
      });
    } else {
      const refused = refuseCall(next, ally, defender, attacker, toDay);
      next = refused.world;
      facts.push(refused.fact);
    }
  }
  return { world: next, facts };
}

function refuseCall(world: WorldState, ally: string, caller: string, enemy: string, toDay: number): { world: WorldState; fact: FactProposalDraft } {
  const next = addGrievance(
    { ...world, polityStances: shiftTrust(world.polityStances, caller, ally, -25, `${nameOf(world, ally)} would not come to its aid`, toDay) },
    caller, ally, `${nameOf(world, ally)} deserted it in its war with ${nameOf(world, enemy)}`, toDay,
  );
  return {
    world: next,
    fact: {
      localId: `ally_refused_${caller}_${ally}_${toDay}`.slice(0, 60),
      kind: "alliance_refused",
      summary: `${nameOf(world, ally)} would not go to war for ${nameOf(world, caller)}, its ally, against ${nameOf(world, enemy)}; ${nameOf(world, caller)} will not forget it.`,
      affectedRefs: [{ kind: "polity", id: ally }, { kind: "polity", id: caller }, { kind: "polity", id: enemy }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 55,
    },
  };
}
