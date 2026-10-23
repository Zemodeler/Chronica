import {
  FactProposalSchema,
  type FactProposal,
  GenericEntitySchema,
  WorldDeltaSchema,
  adjustPolityLegitimacy,
  atWar,
  kmBetween,
  warsOf,
  type Character,
  type FactProposalDraft,
  type Office,
  type PoliticalProcedure,
  type SuccessionRule,
  type WorldState,
} from "@chronica/shared";
import { readBoard } from "./board";
import { blocLeanings, countVote } from "./senate";
import { safeLocalId } from "./safe-local-id";
import type { StatecraftDecision } from "./statecraft";

/**
 * The appeal goes to the people (docs/plans/war-plans.md, "The war with Carthage").
 *
 * In 264 the Mamertines of Messana called on Carthage and on Rome together; a Carthaginian garrison entered the city; the Senate hesitated, and the
 * consul Appius Claudius put it to the people, who voted the war (Polybius 1.10-11). Here: where the Senate has refused a war on a power and the cause
 * is an appeal -- a people that asked Rome for aid against that power, or an ally of Rome at war with it -- the consul takes the question to the
 * assembly that holds the power of war, within a season; the people vote it as they vote any question (their blocs and gentes, the men away at the wars
 * not counted: `blocLeanings`). Carried, the motion stands as passed -- by the people -- and the war is made the month after, as a war the Senate had
 * carried is (`decideTheAppealWar`); refused, the people have said it twice and nothing more comes of it. Done once for a question, by rule, for a power
 * nobody rules in play and for the Senate's motion of a man in the Senate alike. No model call.
 */

/** How long after the Senate's refusal the consul will still take it to the people. */
export const APPEAL_WINDOW_DAYS = 60;
/** How old a letter of appeal may be and still be the cause of a war. */
export const APPEAL_LASTS_DAYS = 400;
/** What the people's carrying of a war on an appeal gives the power, in basis points, and what their refusal takes. */
export const APPEAL_BPS = 150;
/** The marker of a question the people have been asked: also the marker `ratifyTheWar` reads, so that it is not voted twice. */
const markerOf = (procedureId: string): string => `ratified_${procedureId}`.slice(0, 80);

const WAR_MOTION = /\bwar be made on\b/iu;
const draft = (raw: Record<string, unknown>): FactProposalDraft => FactProposalSchema.parse(raw);
const fact = (raw: Record<string, unknown>): FactProposal => FactProposalSchema.parse(raw);

export interface AppealInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  readonly toDay: number;
}

/** The power a war motion is against: named at the end of its words, else the subject of the question. */
export function targetOfWarMotion(world: WorldState, procedure: Pick<PoliticalProcedure, "label" | "subjectKind" | "subjectId">, ours: string): string | null {
  const named = /\bwar be made on (.+?)\.?$/iu.exec(procedure.label)?.[1]?.trim().toLowerCase();
  const byName = named === undefined ? undefined : world.map.polities.find((polity) => polity.name.toLowerCase() === named || polity.id === named);
  if (byName !== undefined && byName.id !== ours) return byName.id;
  if (procedure.subjectKind === "polity" && procedure.subjectId !== ours && world.map.polities.some((polity) => polity.id === procedure.subjectId)) return procedure.subjectId;
  return null;
}

/**
 * Who has appealed to a power against another: a people that wrote asking for aid or for an alliance within `APPEAL_LASTS_DAYS` and is at war with
 * the other, or has the other's army on its own ground; or an ally of the power's at war with the other. Null where nobody has.
 */
export function theAppealBehind(world: WorldState, polityId: string, targetId: string): { readonly polityId: string; readonly name: string; readonly how: "letter" | "ally" } | null {
  const day = world.instant.day;
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const groundOf = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId] as const));
  const theirArmyOnGround = (peopleId: string): boolean => world.material.forces.some((force) => force.polityId === targetId && groundOf.get(force.locationId) === peopleId);
  const pressed = (peopleId: string): boolean => atWar(world.polityAgreements, peopleId, targetId) || theirArmyOnGround(peopleId);
  const letters = world.diplomacy
    .filter((message) => message.toPolityId === polityId && message.fromPolityId !== targetId && (message.kind === "military_aid_request" || message.kind === "alliance_offer") && day - message.sentAtStep <= APPEAL_LASTS_DAYS)
    .sort((a, b) => b.sentAtStep - a.sentAtStep || a.id.localeCompare(b.id));
  for (const message of letters) if (pressed(message.fromPolityId)) return { polityId: message.fromPolityId, name: nameOf(message.fromPolityId), how: "letter" };
  const allies = world.polityAgreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "alliance" && (agreement.polityId === polityId || agreement.otherPolityId === polityId))
    .map((agreement) => (agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId))
    .filter((ally) => ally !== targetId && atWar(world.polityAgreements, ally, targetId))
    .sort();
  return allies[0] === undefined ? null : { polityId: allies[0], name: nameOf(allies[0]), how: "ally" };
}

/** The assembly of a power that holds the power of war, other than the chamber that refused. */
function assemblyFor(world: WorldState, chamberId: string) {
  const chamber = world.material.institutions.find((institution) => institution.id === chamberId);
  if (chamber === undefined) return undefined;
  return world.material.institutions.find((institution) => institution.polityId === chamber.polityId && institution.id !== chamber.id && institution.franchise === "citizens"
    && institution.advisory !== true && institution.powers?.includes("war") === true);
}

/** Whether the people have been asked about a question. */
const asked = (world: WorldState, procedureId: string): boolean => world.genericEntities.some((entity) => entity.kind === "ratification" && entity.label === markerOf(procedureId));

/**
 * The questions of war the Senate refused, with an appeal behind them, are put to the people. Each is counted once.
 */
export function theAppealGoesToThePeople(input: AppealInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  for (const procedure of world.material.politicalProcedures) {
    if (procedure.outcome !== "failed" || !WAR_MOTION.test(procedure.label) || procedure.resolvedAtStep === null || input.toDay - procedure.resolvedAtStep > APPEAL_WINDOW_DAYS) continue;
    if (asked(world, procedure.id)) continue;
    const chamber = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
    const assembly = procedure.institutionId === null ? undefined : assemblyFor(world, procedure.institutionId);
    if (chamber === undefined || assembly === undefined) continue;
    const target = targetOfWarMotion(world, procedure, chamber.polityId);
    if (target === null || atWar(world.polityAgreements, chamber.polityId, target)) continue;
    const appeal = theAppealBehind(world, chamber.polityId, target);
    if (appeal === null) continue;
    const put = { ...procedure, id: `appeal-${procedure.id}`.slice(0, 100), institutionId: assembly.id, voteRecordId: null, outcome: null, stage: "gathering_support" as const, concerns: [...new Set([...(procedure.concerns ?? []), "war" as const])] } as PoliticalProcedure;
    const count = countVote(`appeal-${procedure.id}`.slice(0, 100), put, assembly, blocLeanings(world, put, assembly), input.toDay);
    const carried = count.outcome === "passed";
    const targetName = world.map.polities.find((polity) => polity.id === target)?.name ?? target;
    const what = carried
      ? `The ${chamber.name} would not take up the appeal of ${appeal.name}. The consul put it to the ${assembly.name}, and the people voted the war on ${targetName}, ${count.yesWeight} to ${count.noWeight}.`
      : `The ${chamber.name} would not take up the appeal of ${appeal.name}, and neither would the ${assembly.name} when the consul put it to the people, ${count.noWeight} to ${count.yesWeight}. There will be no war on ${targetName} for it.`;
    world = {
      ...world,
      genericEntities: [...world.genericEntities, GenericEntitySchema.parse({
        id: `appeal-${procedure.id}`.slice(0, 100), kind: "ratification", label: markerOf(procedure.id), ownerRef: { kind: "polity", id: chamber.polityId },
        attributes: { procedureId: procedure.id, atStep: input.toDay, carried, yes: count.yesWeight, no: count.noWeight, present: count.presentWeight, appealOf: appeal.polityId, againstPolityId: target, byThePeople: true },
        createdAtStep: input.toDay,
      })],
      material: {
        ...world.material,
        // The people's word stands in the Senate's place: the motion is carried, and is read as a war the chamber had carried.
        politicalProcedures: carried
          ? world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id
            ? { ...candidate, outcome: "passed" as const, resolvedAtStep: input.toDay, outcomeReason: `Carried by the ${assembly.name} on the appeal of ${appeal.name}, the ${chamber.name} having refused it.`.slice(0, 400) }
            : candidate))
          : world.material.politicalProcedures,
        polityLegitimacy: adjustPolityLegitimacy(world.material.polityLegitimacy, chamber.polityId, carried ? APPEAL_BPS : -Math.round(APPEAL_BPS / 2), carried ? `The people voted the war on appeal` : `The people would not take the appeal either`, procedure.id),
      },
    };
    facts.push(draft({
      localId: safeLocalId(`appeal_to_people_${procedure.id}`).slice(0, 60), kind: carried ? "war_voted_by_the_people" : "appeal_refused_by_the_people", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: carried ? 70 : 45,
      summary: what.slice(0, 400),
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: chamber.polityId }, { kind: "polity", id: target }, { kind: "polity", id: appeal.polityId }],
    }));
  }
  return { world, facts };
}

/**
 * The war the people voted on an appeal is made by the consul, the month after, as the war the Senate carried is. Only for a power whose consul is nobody's in play;
 * the war is then the ruler's act in the name of the state, with its cause told in the Senate's and the people's words.
 */
export function decideTheAppealWar(world: WorldState, excludedPolityIds: ReadonlySet<string>, rulerOf: (polityId: string) => Character | undefined, day: number): StatecraftDecision[] {
  const decisions: StatecraftDecision[] = [];
  for (const entity of world.genericEntities) {
    const attributes = entity.attributes ?? {};
    if (entity.kind !== "ratification" || attributes["byThePeople"] !== true || attributes["carried"] !== true) continue;
    if (day - Number(attributes["atStep"] ?? -Infinity) > 120 || entity.ownerRef?.kind !== "polity") continue;
    const polityId = entity.ownerRef.id;
    const target = String(attributes["againstPolityId"] ?? "");
    if (target === "" || excludedPolityIds.has(polityId) || atWar(world.polityAgreements, polityId, target)) continue;
    const ruler = rulerOf(polityId);
    if (ruler === undefined) continue;
    const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
    const appealOf = String(attributes["appealOf"] ?? "");
    decisions.push({
      polityId, actorCharacterId: ruler.id, act: "declare_war", targetPolityId: target,
      why: `the people voted the war on ${name(target)} at the appeal of ${name(appealOf)}`.slice(0, 400),
      deltas: [WorldDeltaSchema.parse({
        op: "agreement_open", localId: safeLocalId(`war_${polityId}_${target}`).slice(0, 60), kind: "war", polityId, otherPolityId: target,
        terms: `${name(polityId)} is at war with ${name(target)}, by the vote of its people, for ${name(appealOf)}.`.slice(0, 600), forDays: null, sourceMessageRef: null, visibility: "public",
        reason: `${ruler.name} makes the war the people voted on the appeal of ${name(appealOf)}.`.slice(0, 240),
      })],
      facts: [fact({
        localId: safeLocalId(`why_war_${polityId}_${target}`).slice(0, 60), kind: "war_cause", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 80,
        summary: `${ruler.name} took ${name(polityId)} to war with ${name(target)}: the people had voted it, for ${name(appealOf)}, when the Senate would not.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: polityId }, { kind: "polity", id: target }, { kind: "character", id: ruler.id }],
      })],
    });
  }
  return decisions.slice(0, 1);
}

// ── The weak call for help ─────────────────────────────────────────────────

/** How far from its own capital a pressed people looks for a power to call on, in the map's kilometres. */
const CALLS_REACH_KM = 900;
/** The least a pressed people holds against its enemy, as a share, for it to be `pressed`. */
const PRESSED_BELOW = 0.7;

/**
 * A people hard pressed in a war it is not winning writes to the two strongest powers within reach that are not its enemies, asking for aid (the Mamertines wrote to
 * Carthage and to Rome together: Polybius 1.10). Once in three hundred days, by rule, for a ruler nobody plays; what the others do with the letter is theirs, and the
 * letter stands as the cause of a war (`theAppealBehind`).
 */
export function decideCallsForHelp(world: WorldState, excludedPolityIds: ReadonlySet<string>, playedByModel: ReadonlySet<string>, rulerOf: (polityId: string) => Character | undefined, day: number): StatecraftDecision[] {
  if (day < 60) return [];
  const board = readBoard(world);
  const capitalOf = (polityId: string): string | undefined => {
    const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
    return world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id;
  };
  const decisions: StatecraftDecision[] = [];
  for (const reading of [...board.values()].sort((a, b) => a.polityId.localeCompare(b.polityId))) {
    if (decisions.length >= 2 || reading.wars.length === 0 || excludedPolityIds.has(reading.polityId) || reading.leaderId !== null) continue;
    // A people with no ruler in the books (the Campanian legion) speaks through its first man.
    const ruler = rulerOf(reading.polityId) ?? world.characters.filter((character) => character.alive && character.polityId === reading.polityId).sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
    if (ruler === undefined || playedByModel.has(ruler.id)) continue;
    if (world.diplomacy.some((message) => message.fromPolityId === reading.polityId && message.kind === "military_aid_request" && day - message.sentAtStep < 300)) continue;
    const foes = warsOf(world.polityAgreements, reading.polityId);
    const theirs = foes.reduce((sum, foe) => sum + (board.get(foe)?.fielded ?? 0), 0);
    if (theirs <= 0 || reading.fielded >= PRESSED_BELOW * theirs) continue;
    const home = capitalOf(reading.polityId);
    if (home === undefined) continue;
    const callable = [...board.values()]
      .filter((other) => other.polityId !== reading.polityId && !foes.includes(other.polityId) && other.leaderId === null && other.strength >= 5_000)
      .map((other) => ({ other, km: (() => { const there = capitalOf(other.polityId); return there === undefined ? null : kmBetween(world, home, there, CALLS_REACH_KM); })() }))
      .filter((entry): entry is { other: typeof entry.other; km: number } => entry.km !== null)
      .sort((a, b) => b.other.strength - a.other.strength || a.other.polityId.localeCompare(b.other.polityId))
      .slice(0, 2);
    const foeName = board.get(foes[0]!)?.name ?? foes[0]!;
    for (const { other } of callable) {
      decisions.push({
        polityId: reading.polityId, actorCharacterId: ruler.id, act: "letter", targetPolityId: other.polityId,
        why: `hard pressed by ${foeName}, it asks ${other.name} for help`.slice(0, 400),
        deltas: [WorldDeltaSchema.parse({
          op: "diplomatic_message_send", localId: safeLocalId(`call_${reading.polityId}_${other.polityId}`).slice(0, 60), kind: "military_aid_request",
          fromPolityId: reading.polityId, fromCharacterRef: ruler.id, toPolityId: other.polityId, toCharacterRef: null,
          subject: `${reading.name} asks ${other.name} for help`.slice(0, 200),
          terms: `${reading.name} is hard pressed by ${foeName}. It asks ${other.name} to take it under its protection and to send men.`.slice(0, 600),
          replyWithinDays: 60, inReplyToRef: null, visibility: "polity", reason: `${reading.name} is the weaker in its war and calls for help.`.slice(0, 240),
        })],
        facts: [],
      });
    }
  }
  return decisions;
}
