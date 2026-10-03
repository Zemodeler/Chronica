import {
  adjustPolityLegitimacy,
  allOffices,
  warsOf,
  type FactProposalDraft,
  type GenericEntity,
  type GovernmentInstitution,
  type Office,
  type PoliticalProcedure,
  type WorldState,
} from "@chronica/shared";

/**
 * The tribune of the plebs: his veto, his intercession, and the plebs' last
 * resort, leaving the city.
 *
 * A player who was a tribune "vetoed" a consul's measure and "led the plebs out
 * of the city", and both were told back to him as done while nothing at all
 * happened. The veto he wrote was a "blocked" on the question, which his
 * office's grant did not cover, so nobody listened; his intercession against
 * the consul bound only the consul's next motion, not the one already before
 * the house; and a secession was an arrangement with a name and no rule.
 *
 * - **The veto.** A tribune may close any open question of his own republic as
 *   blocked, and it is his office's act (`whose-to-give.ts`), not a breach. A
 *   dictator's question he cannot touch.
 * - **The intercession.** One standing against a magistrate's motions stops the
 *   motions he already has before a chamber too, on their day (`senate.ts`).
 * - **The secession.** The plebs follow their tribune out of the city
 *   (`generic_entity_create` kind "secession", naming the question they
 *   demand). While they are out the republic's chambers do no business and the
 *   city grows restless, month by month. The house gives way, carrying the
 *   demand, once the city's need of the plebs outweighs its dislike of what
 *   they ask -- sooner in a war, sooner for a tribune of standing, sooner the
 *   longer they stay out. They always came back in the end; the question was
 *   what it cost.
 */

/** The offices that may forbid: a tribunate, or any other that vetoes. */
const forbids = (office: Office): boolean => office.tribunician === true || office.vetoes === true;

const OPEN_STAGES = new Set<PoliticalProcedure["stage"]>(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

const heldBy = (world: WorldState, characterId: string, officeId: string): boolean =>
  world.material.officeSeats.some((seat) => seat.officeId === officeId && seat.holderCharacterId === characterId && seat.status === "held");

/** The power whose question it is: its chamber's, else its sponsor's. */
export function polityOfQuestion(world: WorldState, procedure: PoliticalProcedure): string | null {
  return world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId
    ?? world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.polityId
    ?? null;
}

/** A dictator -- whoever holds an office that rules -- is beyond any tribune. */
const isRulerOf = (world: WorldState, characterId: string, offices: readonly Office[]): boolean =>
  allOffices(world, offices).some((office) => office.authorisedActionIds.includes("capital_set") && heldBy(world, characterId, office.id));

/**
 * The office by which this man may forbid this question, or null: a tribune
 * of its own power, the question still open, and not a dictator's.
 */
export function vetoingOffice(world: WorldState, procedureId: string, actorId: string, offices: readonly Office[]): Office | null {
  const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
  if (procedure === undefined || !OPEN_STAGES.has(procedure.stage)) return null;
  const polityId = polityOfQuestion(world, procedure);
  if (polityId === null || isRulerOf(world, procedure.sponsorCharacterId, offices)) return null;
  return allOffices(world, offices).find((office) => forbids(office) && office.polityId === polityId && heldBy(world, actorId, office.id)) ?? null;
}

/** What a tribune's "blocked" says, written as he closes the question. */
export function vetoFact(world: WorldState, procedure: PoliticalProcedure, actorId: string, offices: readonly Office[]): FactProposalDraft | null {
  const office = vetoingOffice(world, procedure.id, actorId, offices);
  if (office === null) return null;
  const who = world.characters.find((character) => character.id === actorId)?.name ?? actorId;
  return {
    localId: `veto_${procedure.id}_${actorId}`.slice(0, 60),
    kind: "motion_vetoed",
    summary: `${who}, as ${office.label}, interposed his veto, and "${procedure.label}" was stopped: it will not be put or carried out.`.slice(0, 600),
    affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "character", id: actorId }, { kind: "character", id: procedure.sponsorCharacterId }, { kind: "polity", id: office.polityId }],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: 60,
  };
}

const standing = (entity: GenericEntity): boolean => !("retiredAtStep" in entity.attributes) && entity.ownerRef?.kind === "character";

/**
 * Tribunes whose intercession stands against the man who put this question:
 * against his motions, or against everything he does in the city.
 */
export function intercessionsAgainst(world: WorldState, procedure: PoliticalProcedure, institution: GovernmentInstitution, offices: readonly Office[]): { name: string; office: string }[] {
  if (isRulerOf(world, procedure.sponsorCharacterId, offices)) return [];
  return world.genericEntities.flatMap((entity) => {
    if (!/intercession/i.test(entity.kind) || !standing(entity) || entity.attributes.against !== procedure.sponsorCharacterId) return [];
    const act = String(entity.attributes.act ?? "all").toLowerCase();
    if (act !== "all" && act !== "motion") return [];
    const tribune = world.characters.find((character) => character.id === entity.ownerRef!.id && character.alive);
    const office = tribune === undefined ? undefined : allOffices(world, offices).find((candidate) => candidate.tribunician === true && candidate.polityId === institution.polityId && heldBy(world, tribune.id, candidate.id));
    return tribune === undefined || office === undefined ? [] : [{ name: tribune.name, office: office.label }];
  });
}

// ── The secession of the plebs ───────────────────────────────────────────────

/** How often a secession takes its toll of the city, and how often the house weighs giving way. */
export const SECESSION_MONTH_DAYS = 30;
/** The city's unrest, each month the plebs are out. */
export const SECESSION_UNREST_BPS = 400;
const SECESSION_LEGITIMACY_BPS = 150;
/** What leading the plebs home with their demand won does for a tribune. */
export const SECESSION_STANDING_BPS = 800;
/** How much the house's dislike must be outweighed before it gives way at all. */
const SECESSION_PRIDE = 30;

export interface SecessionHooks {
  /** How the house leans on the demand, -100 to 100, weighted by its blocs. */
  readonly houseLean: (world: WorldState, procedure: PoliticalProcedure, institution: GovernmentInstitution) => number;
  /** The demand carried, as a carried question is: what it enacts, the office it moves. */
  readonly carry: (world: WorldState, procedure: PoliticalProcedure) => { world: WorldState; facts: FactProposalDraft[] };
}

/** How badly the city needs its plebs back, against how much the house dislikes what they ask. */
export function secessionPressure(world: WorldState, leaderId: string, polityId: string, demand: PoliticalProcedure | null, monthsOut: number, hooks: SecessionHooks): { need: number; resistance: number } {
  const leader = world.characters.find((character) => character.id === leaderId);
  const atWar = warsOf(world.polityAgreements, polityId).length > 0;
  const party = Math.max(0, ...world.material.politicalGroups
    .filter((group) => group.active && group.polityId === polityId && (group.type === "debtors" || group.type === "veterans"))
    .map((group) => group.strengthBps ?? 0));
  const need = (atWar ? 30 : 0) + Math.min(40, Math.round((leader?.prestigeBps ?? 0) / 250)) + Math.min(30, Math.round(party / 333)) + monthsOut * 20;
  const house = world.material.institutions.find((institution) => institution.polityId === polityId && institution.franchise === "council" && institution.advisory !== true)
    ?? world.material.institutions.find((institution) => institution.id === demand?.institutionId);
  const lean = demand === null || house === undefined ? 0 : hooks.houseLean(world, demand, house);
  return { need, resistance: SECESSION_PRIDE + Math.max(0, -lean) };
}

const retire = (world: WorldState, entityId: string, toDay: number, outcome: string): WorldState => ({
  ...world,
  genericEntities: world.genericEntities.map((entity) => (entity.id === entityId ? { ...entity, attributes: { ...entity.attributes, retiredAtStep: toDay, outcome } } : entity)),
});

const marked = (world: WorldState, entityId: string, attributes: Record<string, number>): WorldState => ({
  ...world,
  genericEntities: world.genericEntities.map((entity) => (entity.id === entityId ? { ...entity, attributes: { ...entity.attributes, ...attributes } } : entity)),
});

/**
 * Every secession standing, weighed: ended, conceded, or taking its toll.
 * Returns the powers whose plebs are still out, whose chambers do no business.
 */
export function settleSecessions(world: WorldState, offices: readonly Office[], toDay: number, hooks: SecessionHooks): { world: WorldState; facts: FactProposalDraft[]; out: Set<string> } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  const out = new Set<string>();
  for (const entity of world.genericEntities) {
    if (!/secession/i.test(entity.kind) || !standing(entity)) continue;
    const leader = next.characters.find((character) => character.id === entity.ownerRef!.id);
    const polityId = leader?.polityId ?? null;
    const office = leader === undefined || polityId === null ? undefined
      : allOffices(next, offices).find((candidate) => candidate.tribunician === true && candidate.polityId === polityId && heldBy(next, leader.id, candidate.id));
    const tell = (kind: string, summary: string, significance: number, extra: FactProposalDraft["affectedRefs"] = []) => facts.push({
      localId: `${kind}_${entity.id}_${toDay}`.slice(0, 60), kind, summary: summary.slice(0, 600),
      affectedRefs: [...(leader === undefined ? [] : [{ kind: "character" as const, id: leader.id }]), ...(polityId === null ? [] : [{ kind: "polity" as const, id: polityId }]), ...extra],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance,
    });
    // Only their own tribune can lead the plebs out, and only while he is one.
    if (leader === undefined || !leader.alive || polityId === null || office === undefined) {
      next = retire(next, entity.id, toDay, "dispersed");
      tell("secession_ended", `The plebs would not leave the city behind ${leader?.name ?? "a man"} who was not their tribune, and went about their business.`, 45);
      continue;
    }
    // What they demand: the question named, else the last one their tribune has open.
    const ownQuestions = next.material.politicalProcedures.filter((procedure) => OPEN_STAGES.has(procedure.stage) && polityOfQuestion(next, procedure) === polityId);
    const named = typeof entity.attributes.demand === "string" ? String(entity.attributes.demand).replace(/^local:/, "") : null;
    const demand = ownQuestions.find((procedure) => procedure.id === named)
      ?? [...ownQuestions].filter((procedure) => procedure.sponsorCharacterId === leader.id).sort((a, b) => b.openedAtStep - a.openedAtStep || a.id.localeCompare(b.id))[0]
      ?? null;
    if (demand === null) {
      next = retire(next, entity.id, toDay, "nothing_demanded");
      tell("secession_ended", `${leader.name} led the plebs out of the city with nothing put to any chamber for the Senate to grant, and they drifted back with nothing.`, 45);
      continue;
    }
    if (typeof entity.attributes.reportedAtStep !== "number") {
      next = marked(next, entity.id, { reportedAtStep: toDay, tollAtStep: toDay });
      tell("secession_begun", `${leader.name}, ${office.label}, has led the plebs out of the city, and they will not come back until "${demand.label}" is granted. The shops are shut and no levy can be held.`, 70, [{ kind: "procedure", id: demand.id }]);
    }
    const monthsOut = Math.floor((toDay - entity.createdAtStep) / SECESSION_MONTH_DAYS);
    const { need, resistance } = secessionPressure(next, leader.id, polityId, demand, monthsOut, hooks);
    if (need >= resistance) {
      const settled: PoliticalProcedure = {
        ...demand, stage: "resolved", outcome: "passed", resolvedAtStep: toDay,
        outcomeReason: `Granted to the plebs, who had left the city behind ${leader.name}, to bring them home.`.slice(0, 400),
      };
      next = { ...next, material: { ...next.material, politicalProcedures: next.material.politicalProcedures.map((procedure) => (procedure.id === demand.id ? settled : procedure)) } };
      const carried = hooks.carry(next, settled);
      next = retire(carried.world, entity.id, toDay, "conceded");
      next = { ...next, characters: next.characters.map((character) => (character.id === leader.id ? { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + SECESSION_STANDING_BPS) } : character)) };
      tell("secession_ended", `The Senate gave way: "${demand.label}" is granted, and ${leader.name} has led the plebs back into the city.`, 70, [{ kind: "procedure", id: demand.id }]);
      facts.push(...carried.facts);
      continue;
    }
    // Still out: the city's business stands still, and each month it costs more.
    out.add(polityId);
    const tollAt = typeof next.genericEntities.find((candidate) => candidate.id === entity.id)?.attributes.tollAtStep === "number"
      ? Number(next.genericEntities.find((candidate) => candidate.id === entity.id)!.attributes.tollAtStep) : toDay;
    if (toDay - tollAt >= SECESSION_MONTH_DAYS) {
      const capital = next.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId;
      const city = next.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id;
      next = marked({
        ...next,
        material: {
          ...next.material,
          provinceMaterial: next.material.provinceMaterial.map((entry) => (entry.provinceId === city ? { ...entry, stabilityBps: Math.max(0, entry.stabilityBps - SECESSION_UNREST_BPS) } : entry)),
          polityLegitimacy: adjustPolityLegitimacy(next.material.polityLegitimacy, polityId, -SECESSION_LEGITIMACY_BPS, "The plebs have left the city", `${entity.id}-${toDay}`),
        },
      }, entity.id, { tollAtStep: toDay });
      tell("secession_toll", `The plebs are still out of the city behind ${leader.name}, and its business stands still: no chamber sits, and the streets grow restless.`, 45, [{ kind: "procedure", id: demand.id }]);
    }
  }
  return { world: next, facts, out };
}
