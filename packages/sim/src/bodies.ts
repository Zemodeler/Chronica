import {
  FactProposalSchema,
  GenericEntitySchema,
  WorldDeltaSchema,
  adjustPolityLegitimacy,
  allOffices,
  computeOpinion,
  liveProvinceIds,
  mayAct,
  stableHash,
  warsOf,
  type Character,
  type FactProposalDraft,
  type GovernmentInstitution,
  type Office,
  type PoliticalProcedure,
  type QuestionConcern,
  type SuccessionRule,
  type SupportPosition,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { mindLean } from "./ballots";
import { factionAgainst } from "./insubordination";
import { concernsOf } from "./questions";
import { blocLeanings, countVote, electiveOfficesOf, isAdvisoryFor, isBindingChamberQuestion, isChamberQuestion, latestPositions, openQuestions, voteDayOf } from "./senate";
import type { StatecraftDecision } from "./statecraft";
import { safeLocalId } from "./safe-local-id";

/**
 * The bodies of a state: the Senate and the assemblies, the Council of Elders, the Hundred and Four, the king's friends (docs/plans/government.md, "H3 as built").
 *
 * The voting itself is old (`senate.ts`): a question laid before a chamber is debated, and counted on its day by the chamber's own blocs, its franchise, its
 * quorum and its majority; a tribune's word stops it, a chamber that rejects a magistrate's question may send it on (`refersFailuresTo`); a king's council only
 * counsels, and a ruler who carries a question against its counsel pays in legitimacy (`overruleCost`). What this file adds is what makes a body a body and not a
 * pass-through:
 *
 *  - **A sitting has an agenda.** A chamber puts only so many questions on a day (`agendaOf`: the Senate five, an assembly two, a court two); what is due beyond that is
 *    put off to its next sitting, a month on. And it does not sit at all while its city is besieged or held by the enemy: the questions wait.
 *  - **A queue has a bound.** A chamber holds only so many questions open at once (`BACKLOG_MAX`); a magistrate who would lay one more is left to wait (`bodyHasRoom`).
 *  - **The tribunes stand by rule.** On the day a question comes up, a tribune nobody is playing who has not spoken to it takes his side by what he is, whom he serves and
 *    what the question asks of the plebs; one who opposes it forbids it, and `holdVotes` stops it (`tribunesTakeASide`).
 *  - **The augurs may stop the people's business.** A question that is to go before an assembly may be put off a month by an augur who sees bad omens (*obnuntiatio*),
 *    once, by the odds his office and his quarrels give him (`theAuspices`).
 *  - **The people ratify a war.** The Senate's war, once carried, is read to the assembly that holds the power, which ratifies it: a little legitimacy to the power (`ratifyTheWar`).
 *  - **The king's friends counsel, and the king takes it or overrules it.** Where a power's council only counsels, the ruler it counsels decides in his own time, by what he is:
 *    one who bows to counsel against lets the question drop, one who overrules it carries it and pays for it (`decideCouncils`); and a king who goes to war against
 *    his friends' forecast pays the same (`consultTheFriends`).
 *
 * All deterministic, all by rule, no model call; every roll is a hash of the question and the man.
 */

/** The days a question put off waits for the next sitting. */
export const SITTING_GAP_DAYS = 30;
/** The most questions a chamber holds open at once. */
export const BACKLOG_MAX = 10;
/** The legitimacy the people's ratification of a war gives, in basis points; a king's overruling of his friends takes four hundred. */
export const RATIFICATION_BPS = 150;
export const OVERRULE_COST_BPS = 400;

const OPEN_STAGES = new Set<PoliticalProcedure["stage"]>(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

/** How many questions a chamber takes on one day of sitting. */
export function agendaOf(institution: Pick<GovernmentInstitution, "advisory" | "franchise" | "powers">): number {
  if (institution.advisory === true) return 3;
  if (institution.powers !== undefined && institution.powers.length > 0 && institution.powers.every((power) => power === "judgment")) return 2;
  return institution.franchise === "council" ? 5 : 2;
}

/** Questions open before a chamber now. */
export function backlogOf(world: WorldState, bodyId: string): number {
  return world.material.politicalProcedures.filter((procedure) => procedure.institutionId === bodyId && OPEN_STAGES.has(procedure.stage)).length;
}

/** Whether a chamber has room for one more question. */
export const bodyHasRoom = (world: WorldState, bodyId: string): boolean => backlogOf(world, bodyId) < BACKLOG_MAX;

/** Whether a power's city can be sat in: its capital is its own and no siege is laid to it. */
export function cityIsOpen(world: WorldState, polityId: string): boolean {
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  if (capital === null) return true;
  const province = world.map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === capital));
  if (province === undefined) return true;
  if (province.controllerPolityId !== null && province.controllerPolityId !== polityId) return false;
  return !world.sieges.some((siege) => siege.status === "active" && siege.provinceId === province.id && siege.defenderPolityId === polityId);
}

const fact = (raw: Record<string, unknown>): FactProposalDraft => FactProposalSchema.parse(raw) as unknown as FactProposalDraft;

export interface BodiesInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  readonly toDay: number;
  readonly playerCharacterId?: string | null | undefined;
}

const heldBy = (world: WorldState, characterId: string, officeId: string): boolean =>
  world.material.officeSeats.some((seat) => seat.officeId === officeId && seat.holderCharacterId === characterId && seat.status === "held");

// ── The sitting and its agenda ──────────────────────────────────────────────

/**
 * What is due before a chamber today is put, up to the agenda of the sitting, the oldest first; the rest is put off to the next. A body whose city is shut does not sit.
 */
export function sitTheBodies(input: BodiesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const elective = electiveOfficesOf(world, input.offices, input.successionRules ?? []);
  const due = new Map<string, { procedure: PoliticalProcedure; institution: GovernmentInstitution }[]>();
  for (const entry of openQuestions(world, elective)) {
    if (voteDayOf(entry.procedure) > input.toDay) continue;
    const list = due.get(entry.institution.id);
    if (list === undefined) due.set(entry.institution.id, [entry]);
    else list.push(entry);
  }
  if (due.size === 0) return { world, facts };
  const putOff = new Map<string, number>();
  for (const [bodyId, entries] of [...due].sort(([a], [b]) => a.localeCompare(b))) {
    const institution = entries[0]!.institution;
    const shut = !cityIsOpen(world, institution.polityId);
    const ordered = [...entries].sort((a, b) => a.procedure.openedAtStep - b.procedure.openedAtStep || a.procedure.id.localeCompare(b.procedure.id));
    const kept = shut ? [] : ordered.slice(0, agendaOf(institution));
    const rest = ordered.filter((entry) => !kept.includes(entry));
    if (rest.length === 0) continue;
    const ids = new Set(rest.map((entry) => entry.procedure.id));
    world = {
      ...world,
      material: {
        ...world.material,
        politicalProcedures: world.material.politicalProcedures.map((procedure) => (ids.has(procedure.id)
          ? { ...procedure, deadlineStep: input.toDay + SITTING_GAP_DAYS, outcomeReason: (shut ? "The city is shut, and the chamber could not sit." : "The day's business ran past the agenda, and it is put off to the next sitting.").slice(0, 400) }
          : procedure)),
      },
    };
    putOff.set(bodyId, rest.length);
  }
  if (putOff.size > 0) {
    const live = liveProvinceIds(world);
    for (const [bodyId, count] of putOff) {
      const institution = world.material.institutions.find((candidate) => candidate.id === bodyId)!;
      const shut = !cityIsOpen(world, institution.polityId);
      const capital = world.map.polities.find((polity) => polity.id === institution.polityId)?.capitalSettlementId;
      const province = world.map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === capital));
      if (province === undefined || !live.has(province.id)) continue;
      facts.push(fact({
        localId: safeLocalId(`sitting_${bodyId}_${input.toDay}`).toLowerCase().replace(/[^a-z0-9_-]/gu, "_").slice(0, 60), kind: "chamber_sat", visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
        summary: shut
          ? `The ${institution.name} could not sit with its city shut, and ${count} question${count === 1 ? " waits" : "s wait"}.`
          : `The ${institution.name} sat, and ${count} question${count === 1 ? " was" : "s were"} left over to its next sitting.`,
        affectedRefs: [{ kind: "polity", id: institution.polityId }],
      }));
    }
  }
  return { world, facts };
}

// ── The tribunes ────────────────────────────────────────────────────────────

/** What a question asks of the plebs and of the poor: the burdens a tribune stands against. */
const BURDENS: ReadonlySet<QuestionConcern> = new Set(["taxes", "levy", "war", "debt", "coinage", "spending"]);

/** How strongly a tribune is moved to forbid a question, 0 and up: what he is, whom he serves, and what the question asks. */
export function opposition(world: WorldState, tribune: Character, procedure: PoliticalProcedure): number {
  const concerns = concernsOf(world, procedure);
  const burden = concerns.filter((concern) => BURDENS.has(concern)).length;
  // His own nature on the question (a man who loves peace is against a war, a man who loves the poor against a tax), and what he wants to be: the plebs' man.
  let score = -mindLean(tribune.mind, concerns) * 1.5;
  if (burden > 0) score += 12 * burden + Math.max(0, tribune.mind.drives.status - 55) / 2;
  // A people that would not ratify the war lately has given the tribunes their word against its levies and its burdens (`ratifyTheWar`).
  if (tribune.polityId !== null && (concerns.includes("war") || concerns.includes("levy")) && thePeopleRefusedLately(world, tribune.polityId)) score += REFUSAL_SPUR;
  const sponsor = procedure.sponsorCharacterId;
  if (sponsor !== tribune.id) {
    const opinion = computeOpinion(tribune, sponsor);
    if (opinion <= -25) score += 30 + Math.min(20, (-25 - opinion) / 2);
    if (factionAgainst(world, tribune, sponsor) !== null) score += 20;
    // And a man in the tribune's own interest stands with his friend.
    if (opinion >= 40) score -= 25;
  }
  return Math.max(0, Math.round(score));
}

/**
 * On the day a question comes up, the tribunes of its power who have said nothing of it take a side, by rule. A tribune is not the player and has not spoken: he
 * forbids a question that moves him past a line and a roll, speaks for it if it asks nothing of the plebs and he is of the sponsor's party, and is otherwise silent.
 * The position is the ordinary one (`SupportPosition`), so `holdVotes` stops what a tribune stands against, tells it, and the blocs read what he said.
 */
export function tribunesTakeASide(input: BodiesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const offices = allOffices(world, input.offices);
  const tribunes = offices.filter((office) => office.tribunician === true || office.vetoes === true && office.kind !== "priesthood");
  if (tribunes.length === 0) return { world, facts };
  const byPolity = new Map<string, Office[]>();
  for (const office of tribunes) byPolity.set(office.polityId, [...(byPolity.get(office.polityId) ?? []), office]);
  const elective = electiveOfficesOf(world, input.offices, input.successionRules ?? []);
  const positions: SupportPosition[] = [];
  for (const { procedure, institution } of openQuestions(world, elective)) {
    if (voteDayOf(procedure) > input.toDay || !isBindingChamberQuestion(world, procedure)) continue;
    const offsHere = byPolity.get(institution.polityId);
    if (offsHere === undefined) continue;
    const spoke = new Set(latestPositions(world, procedure.id).filter((position) => position.supporterKind === "character").map((position) => position.supporterId));
    for (const office of offsHere) {
      for (const seat of world.material.officeSeats) {
        if (seat.officeId !== office.id || seat.status !== "held" || seat.holderCharacterId === null || spoke.has(seat.holderCharacterId) || seat.holderCharacterId === input.playerCharacterId) continue;
        const tribune = world.characters.find((character) => character.id === seat.holderCharacterId && character.alive);
        if (tribune === undefined || tribune.id === procedure.sponsorCharacterId) continue;
        const moved = opposition(world, tribune, procedure);
        if (moved < 40 || stableHash([procedure.id, tribune.id, "tribune"]) % 100 >= Math.min(90, moved)) continue;
        spoke.add(tribune.id);
        positions.push({
          id: `support-rule-${procedure.id}-${tribune.id}`.slice(0, 100), procedureId: procedure.id, supporterKind: "character", supporterId: tribune.id, position: "oppose",
          influenceWeight: Math.max(1, Math.round(tribune.prestigeBps / 100)), visibility: "public", provenanceEventIds: [], changedAtStep: input.toDay,
          reasons: [{ kind: "ideology" as const, label: `${tribune.name}, as ${office.label}, stands against it`, score: -50, sourceId: tribune.id }],
        });
      }
    }
  }
  if (positions.length === 0) return { world, facts };
  world = { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, ...positions] } };
  return { world, facts };
}

// ── The augurs ──────────────────────────────────────────────────────────────

/** The odds, in a hundred, that an augur sees ill omens before a question goes to the people, before his quarrels and his temper are counted. */
export const OMEN_ODDS = 4;

/**
 * A question about to go before an assembly of the people (a chamber that is not a council) may be put off a month by an augur of the power who sees
 * bad omens: *obnuntiatio*. Once for a question; a man the model plays or the player is is not made to; the odds rise with his ill will for the man who put it
 * and his party's. The augur's office may stop the assembly, not the Senate (`competence.ts`, `mayStop`).
 */
export function theAuspices(input: BodiesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const augurs = allOffices(world, input.offices).filter((office) => office.vetoes === true && office.kind === "priesthood");
  if (augurs.length === 0) return { world, facts };
  const elective = electiveOfficesOf(world, input.offices, input.successionRules ?? []);
  const stopped = new Map<string, { until: number; by: Character; office: Office }>();
  for (const { procedure, institution } of openQuestions(world, elective)) {
    if (voteDayOf(procedure) > input.toDay || institution.franchise === "council" || institution.advisory === true) continue;
    if ((procedure.adjournments ?? 0) > 0 || /omens/iu.test(procedure.outcomeReason ?? "")) continue;
    const offsHere = augurs.filter((office) => office.polityId === institution.polityId);
    for (const office of offsHere) {
      const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held" && candidate.holderCharacterId !== null
        && candidate.holderCharacterId !== input.playerCharacterId && candidate.holderCharacterId !== procedure.sponsorCharacterId);
      const augur = seat === undefined ? undefined : world.characters.find((character) => character.id === seat.holderCharacterId && character.alive);
      if (augur === undefined || stopped.has(procedure.id)) continue;
      const ill = computeOpinion(augur, procedure.sponsorCharacterId) <= -25 ? 10 : 0;
      const party = factionAgainst(world, augur, procedure.sponsorCharacterId) !== null ? 8 : 0;
      const pious = Math.round((augur.mind.drives.duty - 50) / 25);
      if (stableHash([procedure.id, augur.id, "omens"]) % 100 >= Math.max(1, OMEN_ODDS + ill + party + pious)) continue;
      stopped.set(procedure.id, { until: input.toDay + SITTING_GAP_DAYS, by: augur, office });
    }
  }
  if (stopped.size === 0) return { world, facts };
  world = {
    ...world,
    material: {
      ...world.material,
      politicalProcedures: world.material.politicalProcedures.map((procedure) => {
        const stop = stopped.get(procedure.id);
        if (stop === undefined) return procedure;
        return {
          ...procedure, deadlineStep: stop.until, adjournments: (procedure.adjournments ?? 0) + 1,
          outcomeReason: `${stop.by.name}, as ${stop.office.label}, saw ill omens, and the assembly was put off.`.slice(0, 400),
        };
      }),
    },
  };
  for (const [procedureId, stop] of stopped) {
    const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId)!;
    facts.push(fact({
      localId: safeLocalId(`omens_${procedureId}`).slice(0, 60), kind: "auspices", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 50,
      summary: `${stop.by.name}, as ${stop.office.label}, reported ill omens before the assembly met, and "${procedure.label}" was put off a month.`.slice(0, 400),
      affectedRefs: [{ kind: "procedure", id: procedureId }, { kind: "character", id: stop.by.id }, { kind: "polity", id: stop.office.polityId }],
    }));
  }
  return { world, facts };
}

// ── The people ratify a war ─────────────────────────────────────────────────

/** What a people's refusal of a war adds to a tribune's will to forbid a levy or a war: the plebs' own word, used. */
export const REFUSAL_SPUR = 25;
/** How long a refusal is remembered. */
export const REFUSAL_DAYS = 400;

/** Whether the people of a power voted down a war within `REFUSAL_DAYS`. */
export function thePeopleRefusedLately(world: WorldState, polityId: string): boolean {
  return world.genericEntities.some((entity) => entity.kind === "ratification" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polityId
    && entity.attributes?.["carried"] === false && world.elapsedStep - Number(entity.attributes?.["atStep"] ?? -Infinity) <= REFUSAL_DAYS);
}

/** A question whose words say a war is to be made. */
export const isAWarMotion = (procedure: Pick<PoliticalProcedure, "label">): boolean => /\bwar be made on\b/iu.test(procedure.label);

/**
 * A war the Senate carried is read to the assembly that holds the power of war as well, which ratifies it by acclaim (Polybius 6.14: the people alone have the decision
 * of war). In the engine war stays the Senate's, as the doc has it; the ratification gives the power a little legitimacy, once.
 */
export function ratifyTheWar(input: BodiesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  for (const procedure of world.material.politicalProcedures) {
    if (procedure.outcome !== "passed" || !isAWarMotion(procedure) || procedure.resolvedAtStep === null || input.toDay - procedure.resolvedAtStep > SITTING_GAP_DAYS) continue;
    const senate = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
    if (senate === undefined) continue;
    const assembly = world.material.institutions.find((institution) => institution.polityId === senate.polityId && institution.id !== senate.id && institution.franchise === "citizens"
      && institution.advisory !== true && institution.powers?.includes("war") === true);
    if (assembly === undefined) continue;
    const marker = `ratified_${procedure.id}`.slice(0, 80);
    if (world.genericEntities.some((entity) => entity.kind === "ratification" && entity.label === marker)) continue;
    // The people vote it: its centuries and tribes by their blocs and their gentes, the men away at the wars not counted (`quorum.ts`). War stays the Senate's, as the
    // doc has it: what the people say moves the power's standing, and the tribunes may use a refusal.
    const put = { ...procedure, id: `ratify-${procedure.id}`.slice(0, 100), institutionId: assembly.id, voteRecordId: null, outcome: null, stage: "gathering_support" as const, concerns: [...new Set([...(procedure.concerns ?? []), "war" as const])] } as PoliticalProcedure;
    const count = countVote(`ratify-${procedure.id}`.slice(0, 100), put, assembly, blocLeanings(world, put, assembly), input.toDay);
    const carried = count.outcome === "passed";
    const weight = Math.max(1, count.yesWeight + count.noWeight);
    const margin = Math.abs(count.yesWeight - count.noWeight) / weight;
    const bps = Math.round(RATIFICATION_BPS * (0.5 + 1.5 * margin));
    world = {
      ...world,
      genericEntities: [...world.genericEntities, GenericEntitySchema.parse({
        id: `ratification-${procedure.id}`.slice(0, 100), kind: "ratification", label: marker, ownerRef: { kind: "polity", id: senate.polityId },
        attributes: { procedureId: procedure.id, atStep: input.toDay, carried, yes: count.yesWeight, no: count.noWeight, present: count.presentWeight }, createdAtStep: input.toDay,
      })],
      material: { ...world.material, polityLegitimacy: adjustPolityLegitimacy(world.material.polityLegitimacy, senate.polityId, carried ? bps : -bps, carried ? `The ${assembly.name} ratified the war` : `The ${assembly.name} would not have the war`, procedure.id) },
    };
    const what = procedure.label.replace(/^Motion of [^:]+: that /u, "that ");
    facts.push(fact({
      localId: safeLocalId(`ratified_${procedure.id}`).slice(0, 60), kind: carried ? "war_ratified" : "war_refused", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: carried ? 45 : 60,
      summary: (carried
        ? `The ${assembly.name} ratified what the ${senate.name} had carried, by ${count.yesWeight} to ${count.noWeight}: "${what}".`
        : `The ${assembly.name} would not ratify what the ${senate.name} had carried, ${count.yesWeight} for it and ${count.noWeight} against: "${what}". The war is on, and the people grumble.`).slice(0, 400),
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: senate.polityId }],
    }));
  }
  return { world, facts };
}

// ── The day's work ──────────────────────────────────────────────────────────

/** Before the chambers count what is due: the war ratified, the omens read, the tribunes' sides taken, the agenda set. */
export function keepTheBodies(input: BodiesInput): { world: WorldState; facts: FactProposalDraft[] } {
  const ratified = ratifyTheWar(input);
  const omens = theAuspices({ ...input, world: ratified.world });
  const sides = tribunesTakeASide({ ...input, world: omens.world });
  const sat = sitTheBodies({ ...input, world: sides.world });
  return { world: sat.world, facts: [...ratified.facts, ...omens.facts, ...sides.facts, ...sat.facts] };
}

// ── The king's friends ──────────────────────────────────────────────────────

/** How far a ruler is minded to overrule counsel, 5 to 85 in a hundred, by what he is: the bold, the proud and the headstrong; the cautious and the humble bow. */
export function stubbornness(ruler: Character): number {
  const { boldness, caution } = ruler.mind.temperament;
  const raw = 30 + (boldness - 50) * 0.5 - (caution - 50) * 0.4 + (ruler.mind.drives.status - 50) * 0.3 + (ruler.mind.drives.duty < 40 ? 8 : 0);
  return Math.max(5, Math.min(85, Math.round(raw)));
}

/**
 * The counsel a king's friends have given and he has not yet taken is taken or overruled, by rule, for a ruler nobody plays: counsel for is taken; counsel
 * against is bowed to or overruled by his temper, and one who overrules carries it and pays (`overruleCost`, by `political_procedure_resolve`).
 */
export function decideCouncils(input: { readonly world: WorldState; readonly gameId: string; readonly excludedPolityIds: ReadonlySet<string>; readonly playedByModel: ReadonlySet<string>; readonly playerCharacterId: string | null; readonly rulers: (polityId: string) => readonly Character[] }): StatecraftDecision[] {
  const { world } = input;
  const decisions: StatecraftDecision[] = [];
  for (const procedure of world.material.politicalProcedures) {
    if (!OPEN_STAGES.has(procedure.stage) || procedure.voteRecordId === null || !isChamberQuestion(procedure) || !isAdvisoryFor(world, procedure)) continue;
    const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
    if (institution === undefined || input.excludedPolityIds.has(institution.polityId)) continue;
    const record = world.material.voteRecords.find((candidate) => candidate.id === procedure.voteRecordId);
    const ruler = input.rulers(institution.polityId).find((candidate) => candidate.alive && candidate.id !== input.playerCharacterId && !input.playedByModel.has(candidate.id));
    if (record === undefined || ruler === undefined) continue;
    const label = procedure.label.replace(/^Motion of [^:]+: that /u, "that ");
    const counselledFor = record.outcome === "passed";
    const overrules = !counselledFor && stableHash([input.gameId, "overrule", procedure.id, ruler.id]) % 100 < stubbornness(ruler);
    const outcome = counselledFor || overrules ? "passed" : "withdrawn";
    decisions.push({
      polityId: institution.polityId, actorCharacterId: ruler.id, act: "magistrate", targetPolityId: null,
      why: counselledFor ? `council: took the counsel of the ${institution.name} on "${label}"` : overrules ? `council: overruled the ${institution.name} on "${label}"` : `council: bowed to the ${institution.name} on "${label}"`,
      deltas: [WorldDeltaSchema.parse({
        op: "political_procedure_resolve", procedureRef: procedure.id, outcome,
        outcomeReason: (counselledFor ? `${ruler.name} took the counsel of the ${institution.name}.` : overrules ? `${ruler.name} overruled the ${institution.name} and did it.` : `${ruler.name} bowed to the ${institution.name}'s counsel and let it drop.`).slice(0, 400),
        reason: `${ruler.name} decides what his friends counselled.`.slice(0, 240),
      })],
      facts: [],
    });
  }
  return decisions;
}

/**
 * A king who would make war asks his friends first, in his mind: their count, taken now, says what they would counsel. Against it, a ruler of a heeding temper lets
 * the war wait; one of the other sort goes on and pays, in legitimacy, for the overruling (the same price `overruleCost` takes when the question was put). Returns null where
 * the power has no council that only counsels.
 */
export function consultTheFriends(world: WorldState, polityId: string, ruler: Character, matter: { readonly label: string; readonly concerns: readonly QuestionConcern[] }, gameId: string): { readonly against: boolean; readonly heeds: boolean; readonly council: GovernmentInstitution; readonly cost: WorldDelta | null } | null {
  const council = world.material.institutions.find((institution) => institution.polityId === polityId && institution.advisory === true && institution.franchise === "council")
    ?? world.material.institutions.find((institution) => institution.polityId === polityId && institution.advisory === true);
  if (council === undefined || council.votingBlocs.length === 0) return null;
  const sketch: PoliticalProcedure = {
    id: `consult-${polityId}`, type: "council_deliberation", institutionId: council.id, sponsorCharacterId: ruler.id, subjectKind: "polity", subjectId: polityId, label: `Motion of ${ruler.name}: that ${matter.label}`.slice(0, 200),
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: world.elapsedStep, deadlineStep: world.elapsedStep,
    resolvedAtStep: null, visibility: "polity", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: [...matter.concerns],
  } as PoliticalProcedure;
  const record = countVote("forecast", sketch, council, blocLeanings(world, sketch, council), world.elapsedStep);
  const against = record.outcome === "failed";
  if (!against) return { against: false, heeds: false, council, cost: null };
  const heeds = stableHash([gameId, "heed", polityId, ruler.id, String(Math.floor(world.instant.day / 30))]) % 100 >= stubbornness(ruler);
  if (heeds) return { against: true, heeds: true, council, cost: null };
  const customary = world.genericEntities.some((entity) => entity.kind === "custom" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polityId && entity.attributes?.["customKind"] === "overruled_council");
  const cost = WorldDeltaSchema.parse({
    op: "legitimacy_shift", target: "polity", targetId: polityId, legitimacyBpsDelta: -Math.round(OVERRULE_COST_BPS * (customary ? 0.5 : 1)),
    causeLabel: `The ruler went against the counsel of the ${council.name}`.slice(0, 120), reason: `${ruler.name} would have war, and his friends would not.`.slice(0, 240),
  });
  return { against: true, heeds: false, council, cost };
}

/** Whether a ruler's war would be one nobody has voted: for the king's side of the engine, a power at war already with the neighbour is no new war. */
export const alreadyAtWar = (world: WorldState, polityId: string, otherId: string): boolean => warsOf(world.polityAgreements, polityId).includes(otherId);

/** The power a chamber's seat of law holds a war to: its binding chamber for the war, if it has one, else null (a king's, who decides). */
export function bindingWarBody(world: WorldState, polityId: string, rulerId: string, offices: readonly Office[]): { id: string; name: string } | null {
  const may = mayAct(world, rulerId, "war", { offices });
  return may !== null && may.grade === "by_the_body" ? may.body : null;
}

void heldBy;
