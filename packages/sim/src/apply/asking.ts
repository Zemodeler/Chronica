import {
  allOffices,
  assessOrderStanding,
  computeOpinion,
  familyLinksOf,
  interestLean,
  stableHash,
  BINDING_ANSWER_DAYS,
  CONCERN_IN_WORDS,
  REQUESTED_ANSWER_DAYS,
  type BlocInterest,
  type FactProposalDraft,
  type GovernmentInstitution,
  type Office,
  type OrderAttempt,
  type PoliticalProcedure,
  type QuestionConcern,
  type RequestAsk,
  type WorldState,
} from "@chronica/shared";
import { defianceOf, factionAgainst } from "../insubordination";
import { statedConcerns } from "../questions";

/**
 * Asking a man for something, and whether he says yes.
 *
 * Two things a person cannot do on his own word: put a question to a chamber
 * he may not call, and have something that is another man's to give. A
 * private man's motion went before the Senate in the name of whichever consul
 * liked him best, who was never asked (L5); a request to a man to take one as
 * his legate was refused with the sentence for an unconvened motion (E13), or
 * waited for an answer that never came (E14). Both are a man asked, and both
 * are answered here by what the man asked feels and wants -- the same reading
 * `insubordination.ts` gives an order he would rather not carry out.
 */

/** What the blocs a man's own parties sit in want: his interests, as the house reads them. */
export function interestsOf(world: WorldState, characterId: string): BlocInterest[] {
  const groups = new Set([
    ...world.material.groupMemberships.filter((membership) => membership.characterId === characterId && membership.leftAtStep === null).map((membership) => membership.groupId),
    ...world.material.politicalGroups.filter((group) => group.active && group.leaderCharacterId === characterId).map((group) => group.id),
  ]);
  return [...new Set(world.material.institutions.flatMap((institution) => institution.votingBlocs)
    .filter((bloc) => bloc.groupId != null && groups.has(bloc.groupId))
    .flatMap((bloc) => bloc.interests ?? []))];
}

/** Whether two men stand in the same party. */
function ofOneParty(world: WorldState, one: string, other: string): boolean {
  const groupsOf = (characterId: string): Set<string> => new Set(world.material.groupMemberships
    .filter((membership) => membership.characterId === characterId && membership.leftAtStep === null)
    .map((membership) => membership.groupId));
  const mine = groupsOf(one);
  return [...groupsOf(other)].some((groupId) => mine.has(groupId) && world.material.politicalGroups.some((group) => group.id === groupId && group.active));
}

export const isKin = (world: WorldState, one: string, other: string): boolean =>
  familyLinksOf(world, one, world.elapsedStep).some((link) => link.counterpartCharacterId === other);

export interface Willingness {
  readonly willing: boolean;
  /** Willing, but only just: he will do it, for something in return. */
  readonly conditional: boolean;
  /** Why, in words the asker would be given. */
  readonly why: string;
}

/** How well a man must think of another to lean his way; to do it for that alone; and how ill, to refuse him whatever he asks. */
const FRIENDLY_REGARD = 40;
const DEVOTED_REGARD = 60;
const HOSTILE_REGARD = -40;
/** The band above a refusal in which a yes comes with a price. */
const CONDITIONAL_BAND_BPS = 1_500;

export interface Favour {
  /** What is asked, for the roll: the same favour asked twice gets the same answer. */
  readonly key: string;
  /** What a question is about, for whether it meets what he wants. */
  readonly concerns?: readonly QuestionConcern[];
  /** What the act is aimed at, for whether he wanted it already. */
  readonly aimedAt?: readonly string[];
}

/**
 * Whether a man would do this for the man asking. Kin always would. Otherwise
 * what he feels for him, the parties they stand in, whether the favour meets
 * what his party wants or what he wanted already, and how far above the man
 * asking he stands; and a share of temper the asker cannot see, rolled on the
 * favour itself so that asking again is answered the same.
 */
export function willingnessOf(world: WorldState, askerId: string, askedId: string, favour: Favour): Willingness {
  const asked = world.characters.find((character) => character.id === askedId);
  const asker = world.characters.find((character) => character.id === askerId);
  if (asked === undefined || asker === undefined || !asked.alive) return { willing: false, conditional: false, why: "he is not there to ask" };
  if (askedId === askerId) return { willing: true, conditional: false, why: "it was his own to do" };
  if (isKin(world, askedId, askerId)) return { willing: true, conditional: false, why: `${asker.name} is family, and family is not refused` };
  // A devoted friend does not need asking twice, and a man's enemy does him no favours.
  const regard = computeOpinion(asked, askerId);
  if (regard >= DEVOTED_REGARD) return { willing: true, conditional: false, why: `he would do anything for ${asker.name}` };
  if (regard <= HOSTILE_REGARD) return { willing: false, conditional: false, why: `he has no love for ${asker.name}` };

  const against: string[] = [];
  const forIt: string[] = [];
  const asking: OrderAttempt = {
    id: favour.key, actionId: favour.key, issuerRef: { kind: "character", id: askerId }, recipientRef: { kind: "character", id: askedId },
    claimedAuthorityGrantId: null, authorityCheck: { authorized: false, grant: null, standing: null, reason: "" }, instruction: "",
    standing: "requested", status: "issued", recipientDecisionReason: null, issuedAtStep: world.elapsedStep, decidedAtStep: null, consequenceFactRefs: [], servesRef: null,
  };
  const defiance = defianceOf(world, asking);
  let chance = defiance?.chanceBps ?? 0;
  if (defiance !== null && defiance.why !== "he did not care to") against.push(defiance.why);
  // A great man does not lend his name to a lesser one's business lightly.
  const above = asked.prestigeBps - asker.prestigeBps;
  if (above > 0) chance += above / 4;
  if (above >= 4_000) against.push(`${asker.name} is nobody he owes a hearing`);
  const concerns = favour.concerns ?? [];
  const lean = interestLean(interestsOf(world, askedId), concerns);
  chance -= lean * 40;
  if (lean <= -20) against.push(`${concerns.map((concern) => CONCERN_IN_WORDS[concern]).join(" and ")} is against all his party stands for`);
  if (lean >= 20) forIt.push(`${concerns.map((concern) => CONCERN_IN_WORDS[concern]).join(" and ")} is what his party wants`);
  if (regard >= FRIENDLY_REGARD) {
    chance -= 2_000;
    forIt.push(`he thinks well of ${asker.name}`);
  }
  if (ofOneParty(world, askedId, askerId)) {
    chance -= 1_500;
    forIt.push("they stand in one party");
  }
  const aimedAt = favour.aimedAt ?? [];
  if (asked.ambitions.some((ambition) => ambition.status === "active" && ambition.targetId !== null && aimedAt.includes(ambition.targetId))) {
    chance -= 3_000;
    forIt.push("he had wanted it long before he was asked");
  }
  chance = Math.max(0, Math.min(9_500, Math.round(chance)));
  const roll = stableHash([askerId, askedId, favour.key, "willing"]) % 10_000;
  if (roll < chance) return { willing: false, conditional: false, why: against.length > 0 ? against.join(", and ") : "he did not care to" };
  return {
    willing: true,
    conditional: chance > 0 && roll < chance + CONDITIONAL_BAND_BPS,
    why: forIt.length > 0 ? forIt.join(", and ") : "he saw no harm in it",
  };
}

/** The question as far as its concerns go, before it exists. */
type Question = Pick<PoliticalProcedure, "label" | "type" | "subjectKind"> & { readonly concerns?: readonly QuestionConcern[] | undefined };

/** The living men who hold an office that may convene this chamber, the asker aside. */
export function convenersOf(world: WorldState, institution: GovernmentInstitution, exceptId: string | null = null): string[] {
  const conveners = institution.convenedByOfficeIds ?? [];
  return [...new Set(world.material.officeSeats
    .filter((seat) => seat.status === "held" && conveners.includes(seat.officeId) && seat.holderCharacterId !== null && seat.holderCharacterId !== exceptId)
    .map((seat) => seat.holderCharacterId!))]
    .filter((id) => world.characters.some((character) => character.id === id && character.alive && character.polityId === institution.polityId));
}

/**
 * The magistrates a man would ask to put his question, likeliest first: the
 * one he named, then by what each thinks of him, his party, and what the
 * question means to theirs.
 */
export function convenersByLikelihood(world: WorldState, askerId: string, institution: GovernmentInstitution, question: Question, namedId: string | null = null): string[] {
  const concerns = [...new Set([...(question.concerns ?? []), ...statedConcerns(question)])];
  const score = (id: string): number => {
    const convener = world.characters.find((character) => character.id === id)!;
    return computeOpinion(convener, askerId) + interestLean(interestsOf(world, id), concerns)
      + (ofOneParty(world, id, askerId) ? 20 : 0) - (factionAgainst(world, convener, askerId) === null ? 0 : 20);
  };
  const prestige = (id: string): number => world.characters.find((character) => character.id === id)?.prestigeBps ?? 0;
  return convenersOf(world, institution, askerId)
    .sort((a, b) => Number(b === namedId) - Number(a === namedId) || score(b) - score(a) || prestige(b) - prestige(a) || a.localeCompare(b));
}

/** How many magistrates a man asks before he gives his motion up. */
const ASKED_AT_MOST = 3;

/**
 * A motion a man may not put himself, put by a magistrate who agrees to put
 * it, or by nobody. The first of them willing moves it, and the record says
 * he agreed; where none will, it is refused naming who declined and why.
 */
export function askAConvener(
  world: WorldState,
  askerId: string,
  institution: GovernmentInstitution,
  question: Question,
  namedId: string | null,
  offices: readonly Office[],
): { readonly sponsorId: string; readonly fact: FactProposalDraft } | { readonly declined: string } {
  const asker = world.characters.find((character) => character.id === askerId);
  const conveners = convenersByLikelihood(world, askerId, institution, question, namedId);
  const labels = (institution.convenedByOfficeIds ?? []).map((officeId) => allOffices(world, offices).find((office) => office.id === officeId)?.label ?? officeId);
  if (conveners.length === 0) return { declined: `Only a ${labels.join(", a ")} may put a question to the ${institution.name}, and none is in office to put it.` };
  const concerns = [...new Set([...(question.concerns ?? []), ...statedConcerns(question)])];
  const refusals: string[] = [];
  for (const convenerId of conveners.slice(0, ASKED_AT_MOST)) {
    const convener = world.characters.find((character) => character.id === convenerId)!;
    const answer = willingnessOf(world, askerId, convenerId, { key: `put:${question.label}`, concerns });
    if (!answer.willing) {
      refusals.push(`${convener.name} would not (${answer.why})`);
      continue;
    }
    return {
      sponsorId: convenerId,
      fact: {
        localId: `put_${askerId}_${convenerId}`.slice(0, 60),
        kind: "motion_put_for_another",
        summary: `${convener.name} agreed to put ${asker?.name ?? "another man"}'s motion, "${question.label}", to the ${institution.name}: ${answer.why}.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: convenerId }, { kind: "character", id: askerId }, { kind: "institution", id: institution.id }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 40,
      },
    };
  }
  return { declined: `Nobody who may put a question to the ${institution.name} would put "${question.label}" for ${asker?.name ?? "him"}: ${refusals.join("; ")}.` };
}

/**
 * An order or a request, as the record keeps it: the standing the man asking
 * had, and the day he is owed his answer by.
 */
export function orderAttemptFor(
  world: WorldState,
  offices: readonly Office[],
  ids: { next(prefix: string): string },
  request: { readonly issuerId: string; readonly recipientId: string; readonly instruction: string; readonly ask?: RequestAsk | undefined; readonly servesRef?: string | null },
): OrderAttempt {
  const issuerRef = { kind: "character" as const, id: request.issuerId };
  const recipientRef = { kind: "character" as const, id: request.recipientId };
  const verdict = assessOrderStanding({ world, offices, issuerRef, recipientRef });
  return {
    id: ids.next("order"),
    actionId: ids.next("action"),
    issuerRef,
    recipientRef,
    claimedAuthorityGrantId: verdict.grant?.id ?? null,
    authorityCheck: { authorized: verdict.standing === "binding", grant: verdict.grant, standing: verdict.grant?.standing ?? null, reason: verdict.reason },
    instruction: request.instruction.slice(0, 400),
    standing: verdict.standing,
    status: "issued",
    recipientDecisionReason: null,
    issuedAtStep: world.elapsedStep,
    decidedAtStep: null,
    consequenceFactRefs: [],
    servesRef: request.servesRef ?? null,
    ...(request.ask === undefined ? {} : { ask: request.ask }),
    answerDueByStep: world.elapsedStep + (verdict.standing === "binding" ? BINDING_ANSWER_DAYS : REQUESTED_ANSWER_DAYS),
  };
}

/** A favour asked of a man in the order's own words: put to him, and the asker knows he asked. */
export function askOf(
  world: WorldState,
  offices: readonly Office[],
  ids: { next(prefix: string): string },
  request: { readonly issuerId: string; readonly recipientId: string; readonly instruction: string; readonly ask?: RequestAsk | undefined },
): { readonly world: WorldState; readonly attempt: OrderAttempt; readonly fact: FactProposalDraft } {
  const attempt = orderAttemptFor(world, offices, ids, request);
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? "somebody";
  return {
    world: { ...world, orderAttempts: [...world.orderAttempts, attempt] },
    attempt,
    fact: {
      localId: `asked_${attempt.id}`.slice(0, 60),
      kind: "request_made",
      summary: `${name(request.issuerId)} asked ${name(request.recipientId)}: ${request.instruction}`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: request.issuerId }, { kind: "character", id: request.recipientId }],
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      knownToRefs: [{ kind: "character", id: request.issuerId }, { kind: "character", id: request.recipientId }],
      significance: 25,
    },
  };
}
