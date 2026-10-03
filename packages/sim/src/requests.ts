import {
  allOffices,
  answerDueOf,
  appointersOf,
  completeOrderAttempt,
  abandonOrderAttempt,
  computeOpinion,
  decideOrderAttempt,
  formationOf,
  holderOf,
  nextRankUp,
  putInPost,
  rankForRole,
  ranksIn,
  receiveOrderAttempt,
  seniorityOf,
  type Character,
  type Commitment,
  type FactProposalDraft,
  type GovernmentInstitution,
  type Office,
  type OrderAttempt,
  type OrderAttemptDecision,
  type QuestionConcern,
  type RankTemplate,
  type RequestAsk,
  type WorldState,
} from "@chronica/shared";
import { isKin, willingnessOf } from "./apply/asking";
import { orderAnswerCauses } from "./apply/apply-deltas";
import { sovereignChamberOf } from "./constitutions";
import { remember, type Grievance } from "./grievances";
import type { IdFactory } from "./ports";
import { statedConcerns } from "./questions";
import { deservesPromotion } from "./ranks";

/**
 * Every request is answered (E14, L4).
 *
 * A man asked for something answered only if the model was asked about him,
 * and the model was asked about a man only if his turn came round inside a
 * budget of twenty calls; a turn owed and dropped took the request with it.
 * So "ask Ogulnius to take me as his legate" waited for ever, and so did every
 * legionary's request to his centurion.
 *
 * Now each request has a day it is owed an answer by (`answerDueOf`): a week
 * for an order, a fortnight for a favour, a fortnight more once put off.
 * Past it, and whenever the world stops waiting for the man's turn, the
 * engine answers for him, with no model call:
 *
 * - whether it is his to give at all -- the office that puts a question, the
 *   post that is his to fill, the army a legate would serve in, the money --
 *   and if not, "it is not mine to give; it lies with" whoever's it is;
 * - whether he will, by what he thinks of the man, blood, party, what the
 *   favour means to his own, and his temper (`willingnessOf`);
 * - yes, and it is done there and then; yes, for a price the asker now owes
 *   (a promise `promises.ts` holds him to); or no, with the reason.
 *
 * A yes the engine can carry out is carried out, whoever said it: the model's
 * "I will" to a structured ask is the act, not a sentence about one.
 */

export interface RequestsInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly offices: readonly Office[];
  readonly ids: IdFactory;
  readonly playerCharacterId: string | null;
}

/** Days an accepted request with nothing to read it by is left before it is closed by the promise behind it. */
export const ACCEPTED_LAPSE_DAYS = 30;
/** Days the price of a granted favour is owed for. */
const PRICE_DAYS = 90;

const OPEN: ReadonlySet<OrderAttempt["status"]> = new Set(["issued", "received", "delayed"]);

/** The tick's part: what has fallen due is answered, what was granted is done, and what was granted to no purpose is closed. */
export function answerRequests(input: RequestsInput): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let world = input.world;
  for (const original of input.world.orderAttempts) {
    const attempt = world.orderAttempts.find((candidate) => candidate.id === original.id) ?? original;
    if (attempt.recipientRef.kind !== "character" || attempt.issuerRef.kind !== "character" || attempt.recipientRef.id === input.playerCharacterId) continue;
    if (OPEN.has(attempt.status) && answerDueOf(attempt) <= input.toDay) {
      const decided = answerFor(world, attempt, input);
      world = decided.world;
      facts.push(...decided.facts);
    } else if (attempt.status === "accepted") {
      const settled = settleAccepted(world, attempt, input);
      world = settled.world;
      facts.push(...settled.facts);
    }
  }
  return { world, facts };
}

/**
 * The men the world has stopped waiting for: whatever is still put to them
 * is answered now, by the engine, rather than left for a turn that will not
 * come (`MAX_OWED_BURSTS`).
 */
export function answerForTheSilent(world: WorldState, characterIds: readonly string[], input: Omit<RequestsInput, "world">): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;
  const silent = new Set(characterIds.filter((id) => id !== input.playerCharacterId));
  if (silent.size === 0) return { world, facts };
  for (const attempt of world.orderAttempts) {
    if (!OPEN.has(attempt.status) || attempt.issuerRef.kind !== "character" || attempt.recipientRef.kind !== "character" || !silent.has(attempt.recipientRef.id)) continue;
    const decided = answerFor(next, next.orderAttempts.find((candidate) => candidate.id === attempt.id) ?? attempt, input);
    next = decided.world;
    facts.push(...decided.facts);
  }
  return { world: next, facts };
}

// ── What is asked ─────────────────────────────────────────────────────────

/**
 * What a request asks, where it said so; else read off its words, so a
 * request written before asks were kept, or by a hand that did not fill one
 * in, still has something to be carried out by.
 */
export function askOfRequest(attempt: OrderAttempt): RequestAsk {
  if (attempt.ask !== undefined) return attempt.ask;
  const words = attempt.instruction;
  if (/\blegat(e|us)\b/i.test(words)) return { kind: "take_as_legate" };
  if (/\b(optio|signifer|standard-bearer|centurion|centurio|decurion|promot\w*|make me|raise me)\b/i.test(words)) return { kind: "appoint_to_post" };
  if (/\b(put|lay|bring|move|propose|raise)\b.{0,60}\b(senate|assembly|comitia|council|people|plebs|vote)\b/i.test(words)) return { kind: "put_question" };
  if (/\b(speak|vote|stand)\s+(for|with)\b|\b(back|support|endorse)\s+(me|my|him|his)\b/i.test(words)) return { kind: "speak_for" };
  const money = /\b(lend|give|grant|advance|pay)\b.{0,40}?(\d[\d,]*)/i.exec(words);
  if (money !== null) return { kind: "grant_funds", amount: Number(money[2]!.replace(/,/g, "")) };
  return { kind: "other" };
}

const nameOf = (world: WorldState, id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;

/** Where it is not his to give, whose it is. */
type Grantable =
  | { readonly ok: true; readonly carryOut: (world: WorldState) => WorldState; readonly done: string; readonly refused: string; readonly concerns?: readonly QuestionConcern[]; readonly merit?: boolean }
  | { readonly ok: false; readonly reason: string; readonly refused: string; readonly liesWith?: string };

/** The rank asked for: named, or in the words, or the next up from where he stands. */
function rankAsked(world: WorldState, asker: Character, ask: RequestAsk, instruction: string): { readonly rank: RankTemplate; readonly templateId: string } | undefined {
  const service = asker.service;
  const force = world.material.forces.find((candidate) => candidate.id === service?.forceId);
  const formation = force === undefined || service?.formationId == null ? undefined : formationOf(force, service.formationId);
  const establishment = world.establishments.find((candidate) => candidate.polityId === force?.polityId);
  if (service === undefined || formation === undefined || establishment === undefined) return undefined;
  const here = ranksIn(establishment, formation.templateId);
  const named = ask.ref === undefined ? undefined : here.find((rank) => rank.id === ask.ref) ?? rankForRole(establishment, ask.ref);
  const said = named ?? rankForRole(establishment, instruction);
  const rank = said !== undefined && here.some((candidate) => candidate.id === said.id) ? said : nextRankUp(establishment, formation.templateId, service.rankId);
  return rank === undefined ? undefined : { rank, templateId: formation.templateId };
}

function grantable(world: WorldState, attempt: OrderAttempt, ask: RequestAsk, input: Omit<RequestsInput, "world">): Grantable {
  const askerId = attempt.issuerRef.id;
  const giverId = attempt.recipientRef.id;
  const asker = world.characters.find((character) => character.id === askerId)!;
  const giver = world.characters.find((character) => character.id === giverId)!;
  const offices = allOffices(world, input.offices);
  const atStep = input.toDay;
  switch (ask.kind) {
    case "put_question": {
      const institution: GovernmentInstitution | undefined = world.material.institutions.find((candidate) => candidate.id === ask.ref)
        ?? (giver.polityId === null ? undefined : sovereignChamberOf(world, giver.polityId) ?? undefined)
        ?? world.material.institutions.find((candidate) => candidate.polityId === giver.polityId && (candidate.convenedByOfficeIds ?? []).length > 0);
      const refused = `${giver.name} would not put ${asker.name}'s question to the ${institution?.name ?? "chamber"}`;
      if (institution === undefined) return { ok: false, reason: "there is no chamber for it to be put to", refused };
      const conveners = institution.convenedByOfficeIds ?? [];
      const convenes = world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === giverId && conveners.includes(seat.officeId));
      if (conveners.length > 0 && !convenes) {
        const holders = world.material.officeSeats.filter((seat) => seat.status === "held" && conveners.includes(seat.officeId) && seat.holderCharacterId !== null)
          .map((seat) => `${nameOf(world, seat.holderCharacterId!)}, ${offices.find((office) => office.id === seat.officeId)?.label ?? seat.officeId}`);
        const labels = conveners.map((officeId) => offices.find((office) => office.id === officeId)?.label ?? officeId);
        const liesWith = holders.length > 0 ? holders.slice(0, 3).join("; ") : `a ${labels.join(", a ")}`;
        return { ok: false, reason: `it is not his to put; it lies with ${liesWith}`, liesWith, refused };
      }
      const label = attempt.instruction.slice(0, 200);
      return {
        ok: true,
        refused,
        concerns: statedConcerns({ label, type: "vote", subjectKind: "polity" }),
        done: `${giver.name} put ${asker.name}'s question, "${label}", to the ${institution.name}`,
        carryOut: (current) => {
          // Put already -- by his own hand, in the answer that said yes -- is put once.
          if (current.material.politicalProcedures.some((procedure) => procedure.outcome === null && procedure.sponsorCharacterId === giverId && procedure.label === label)) return current;
          const id = input.ids.next("procedure");
          return {
            ...current,
            material: {
              ...current.material,
              politicalProcedures: [...current.material.politicalProcedures, {
                id, type: "vote" as const, institutionId: institution.id, sponsorCharacterId: giverId, subjectKind: "polity" as const, subjectId: institution.polityId,
                label, eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support" as const, resolutionMechanism: "vote" as const,
                openedAtStep: atStep, deadlineStep: atStep + 20, resolvedAtStep: null, visibility: "public" as const, voteRecordId: null, outcome: null,
                outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: statedConcerns({ label, type: "vote", subjectKind: "polity" }),
              }],
            },
          };
        },
      };
    }
    case "appoint_to_post": {
      const asked = rankAsked(world, asker, ask, attempt.instruction);
      const service = asker.service;
      const force = world.material.forces.find((candidate) => candidate.id === service?.forceId);
      const refused = `${giver.name} would not make ${asker.name} ${asked?.rank.label ?? "an officer"}`;
      if (asked === undefined || force === undefined || service === undefined || service.formationId === null) return { ok: false, reason: `${asker.name} serves in no army with posts to give`, refused };
      const { rank } = asked;
      const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId)!;
      const current = establishment.ranks.find((candidate) => candidate.id === service.rankId);
      if (current !== undefined && seniorityOf(current) >= seniorityOf(rank)) return { ok: false, reason: `${asker.name} is ${current.label} already, which is no less`, refused };
      const unitIndex = rank.level === "unit" || rank.level === "sub" ? service.unitIndex : null;
      const givers = appointersOf(world, force, rank, service.formationId, unitIndex);
      if (!givers.includes(giverId)) {
        const liesWith = givers.length === 0 ? `the commander of ${force.name}` : givers.map((id) => nameOf(world, id)).join(" or ");
        return { ok: false, reason: `it is not his to give; it lies with ${liesWith}`, liesWith, refused };
      }
      const holder = holderOf(world, force, service.formationId, unitIndex, rank.id);
      if (holder !== null && holder !== askerId) return { ok: false, reason: `${nameOf(world, holder)} is ${rank.label} there, and the post is not empty`, refused };
      return {
        ok: true,
        refused,
        merit: true,
        done: `${giver.name} made ${asker.name} ${rank.label} in ${force.name}`,
        carryOut: (now) => putInPost(now, force.id, { formationId: service.formationId!, unitIndex, rankId: rank.id, characterId: askerId }, atStep),
      };
    }
    case "take_as_legate": {
      const force = world.material.forces.find((candidate) => candidate.id === ask.ref && (candidate.commanderCharacterId === giverId || candidate.controllerCharacterId === giverId))
        ?? world.material.forces.find((candidate) => candidate.commanderCharacterId === giverId || candidate.controllerCharacterId === giverId);
      const refused = `${giver.name} would not take ${asker.name} as his legate`;
      if (force === undefined) return { ok: false, reason: "he has no army to take a legate into", liesWith: "a man who commands one", refused };
      const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
      const legate = establishment === undefined ? undefined : rankForRole(establishment, "legate");
      const legates = legate === undefined ? 0 : (force.posts ?? []).filter((post) => post.rankId === legate.id && post.characterId !== askerId).length;
      if (legates >= LEGATES_ENOUGH) return { ok: false, reason: "he has legates enough", refused };
      const formation = (force.formations ?? [])[0];
      return {
        ok: true,
        refused,
        done: `${giver.name} took ${asker.name} as his legate in ${force.name}`,
        carryOut: (now) => {
          const posted = legate === undefined || formation === undefined ? now : putInPost(now, force.id, { formationId: formation.id, unitIndex: null, rankId: legate.id, characterId: askerId }, atStep);
          if (posted.authorityGrants.some((grant) => grant.holder.id === askerId && grant.scope.kind === "force" && grant.scope.id === force.id && grant.revokedAtStep === null)) return posted;
          return {
            ...posted,
            authorityGrants: [...posted.authorityGrants, {
              id: input.ids.next("grant"), holder: { kind: "character" as const, id: askerId }, source: "delegation" as const, sourceRef: attempt.id,
              domain: "military" as const, scope: { kind: "force" as const, id: force.id }, powers: ["command" as const], standing: "delegated" as const,
              legitimacyBps: 10_000, visibility: "public" as const, grantedAtStep: atStep, expiresAtStep: null, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
            }],
          };
        },
      };
    }
    case "speak_for": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === ask.ref && candidate.outcome === null)
        ?? [...world.material.politicalProcedures].reverse().find((candidate) => candidate.outcome === null
          && (candidate.sponsorCharacterId === askerId || (candidate.subjectKind === "character" && candidate.subjectId === askerId)));
      const refused = `${giver.name} would not speak for ${asker.name}`;
      if (procedure === undefined) return { ok: false, reason: `there is no question of ${asker.name}'s before any house for him to speak to`, refused };
      return {
        ok: true,
        refused,
        concerns: statedConcerns(procedure),
        done: `${giver.name} spoke for "${procedure.label}", as ${asker.name} asked`,
        carryOut: (now) => ([...now.material.supportPositions].reverse().find((position) => position.procedureId === procedure.id && position.supporterKind === "character" && position.supporterId === giverId)?.position === "support" ? now : {
          ...now,
          material: {
            ...now.material,
            supportPositions: [...now.material.supportPositions, {
              id: input.ids.next("support"), procedureId: procedure.id, supporterKind: "character" as const, supporterId: giverId, position: "support" as const,
              influenceWeight: Math.round(giver.prestigeBps / 100), visibility: "public" as const,
              reasons: [{ kind: "favour" as const, label: `${asker.name} asked it of him.`.slice(0, 200), score: 50, sourceId: askerId }],
              provenanceEventIds: [], changedAtStep: atStep,
            }],
          },
        }),
      };
    }
    case "grant_funds": {
      const amount = ask.amount === undefined || !Number.isFinite(ask.amount) ? 0 : Math.round(ask.amount);
      const refused = `${giver.name} would not give ${asker.name} ${amount > 0 ? amount : "the money"}`;
      if (amount <= 0) return { ok: false, reason: "he was not told how much", refused };
      // His own purse, or a chest his office lets him spend from without a vote.
      const chests = world.material.officeSeats
        .filter((seat) => seat.status === "held" && seat.holderCharacterId === giverId)
        .flatMap((seat) => offices.filter((office) => office.id === seat.officeId && office.treasuryAccountId !== null && office.treasuryPermissions.includes("spend_without_vote")))
        .map((office) => office.treasuryAccountId!);
      const purse = [giver.personalAccountId, ...chests].map((id) => world.material.accounts.find((account) => account.id === id))
        .find((account) => account !== undefined && account.balance >= amount);
      const into = world.material.accounts.find((account) => account.id === asker.personalAccountId);
      if (purse === undefined || into === undefined || purse.balance < amount) return { ok: false, reason: "he has not the money", refused };
      return {
        ok: true,
        refused,
        done: `${giver.name} gave ${asker.name} ${amount}`,
        carryOut: (now) => ({
          ...now,
          material: {
            ...now.material,
            accounts: now.material.accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - amount }
              : account.id === into.id ? { ...account, balance: account.balance + amount } : account)),
            transactions: [...now.material.transactions, {
              id: input.ids.next("txn"), atStep, kind: "transfer" as const, amount, sourceAccountId: purse.id, destinationAccountId: into.id,
              cause: { kind: "action" as const, id: attempt.id, explanation: `Given to ${asker.name} at his asking`.slice(0, 240) }, visibility: "private" as const,
            }].slice(-500),
          },
        }),
      };
    }
    case "other":
      return {
        ok: true,
        refused: `${giver.name} would not do what ${asker.name} asked (${attempt.instruction.slice(0, 160)})`,
        done: `${giver.name} agreed to what ${asker.name} asked (${attempt.instruction.slice(0, 160)})`,
        // Nothing the engine can do for him: his promise is what is on the record (`settleAccepted`).
        carryOut: (now) => now,
      };
  }
}

/** A general takes so many legates and no more. */
const LEGATES_ENOUGH = 2;
/** How well a man must think of another to raise him past his deserts. */
const RAISES_A_FRIEND = 40;

/**
 * The engine's answer for a man who was asked and has not answered: can he,
 * will he, and on what terms. Carried out on a yes, and the asker told.
 */
function answerFor(world: WorldState, attempt: OrderAttempt, input: Omit<RequestsInput, "world">): { world: WorldState; facts: FactProposalDraft[] } {
  const askerId = attempt.issuerRef.id;
  const giverId = attempt.recipientRef.id;
  const giver = world.characters.find((character) => character.id === giverId);
  const asker = world.characters.find((character) => character.id === askerId);
  const received = attempt.status === "issued" ? receiveOrderAttempt(attempt) : attempt;
  if (giver === undefined || asker === undefined || !giver.alive) {
    return decided(world, received, "ignore", `${giver?.name ?? "He"} was dead before he could answer.`, `${giver?.name ?? "The man asked"} never answered ${asker?.name ?? "him"}: he was dead.`, input, true);
  }
  const ask = askOfRequest(attempt);
  const can = grantable(world, attempt, ask, input);
  if (!can.ok) {
    const own = can.liesWith === undefined ? `${can.reason[0]!.toUpperCase()}${can.reason.slice(1)}.` : `It is not mine to give; it lies with ${can.liesWith}.`;
    return decided(world, received, "refuse", own, `${can.refused}: ${can.liesWith === undefined ? can.reason : `it is not his to give; it lies with ${can.liesWith}`}.`, input);
  }
  // Bound to obey, he does: his temper had its say when the order was given (`answerByTemper`).
  const willing = attempt.standing === "binding"
    ? { willing: true, conditional: false, why: "it was his duty" }
    : willingnessOf(world, askerId, giverId, { key: attempt.id, concerns: can.concerns ?? [], aimedAt: ask.ref === undefined ? [] : [ask.ref] });
  // A post is earned: a man raises one who has not earned it only for kin or a friend.
  if (willing.willing && can.merit === true && !deservesPromotion(asker, input.toDay) && !isKin(world, giverId, askerId) && computeOpinion(giver, askerId) < RAISES_A_FRIEND) {
    return decided(world, received, "refuse", `${asker.name} has not earned it yet.`, `${can.refused}: he has not earned it yet.`, input);
  }
  if (!willing.willing) return decided(world, received, "refuse", `${willing.why}.`, `${can.refused}: ${willing.why}.`, input);
  const accepted = decided(world, received, "accept", `${willing.why}.`, `${can.done}${willing.conditional ? `, for a price: ${asker.name} is to speak for ${giver.name}'s next question` : ""}.`, input);
  let next = can.carryOut(accepted.world);
  const now = next.orderAttempts.find((candidate) => candidate.id === attempt.id)!;
  if (ask.kind !== "other" && now.status === "accepted") {
    next = { ...next, orderAttempts: next.orderAttempts.map((candidate) => (candidate.id === now.id ? completeOrderAttempt(candidate, input.toDay) : candidate)) };
  }
  // A yes for a price: the asker now owes him, and is held to it.
  if (willing.conditional) next = owed(next, askerId, giverId, `${asker.name} will speak for ${giver.name}'s next question, for the favour done him.`, "political_support", input);
  // A yes the engine cannot carry out is his promise to do it.
  if (ask.kind === "other") next = owed(next, giverId, askerId, attempt.instruction.slice(0, 400) || `What ${asker.name} asked.`, "other", input);
  return { world: next, facts: accepted.facts };
}

function owed(world: WorldState, promisorId: string, beneficiaryId: string, description: string, actionKind: Commitment["actionKind"], input: Omit<RequestsInput, "world">): WorldState {
  const commitment: Commitment = {
    id: input.ids.next("commitment"), promisorCharacterId: promisorId, beneficiaryCharacterId: beneficiaryId, actionKind, description: description.slice(0, 400),
    conditions: "", requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: null, breachPressureKind: "humiliation",
    status: "pending", createdAtStep: input.toDay, reviewAtStep: input.toDay + PRICE_DAYS, resolvedAtStep: null, resolutionReason: null,
  };
  return { ...world, commitments: [...world.commitments, commitment] };
}

/** The answer written into the record: the attempt decided, the asker told, and what it does to the two men. */
function decided(
  world: WorldState,
  attempt: OrderAttempt,
  decision: OrderAttemptDecision,
  reason: string,
  told: string,
  input: Omit<RequestsInput, "world">,
  /** A dead man's silence is held against nobody. */
  quiet = false,
): { world: WorldState; facts: FactProposalDraft[] } {
  const answered = decideOrderAttempt(attempt, decision, reason.slice(0, 400), input.toDay);
  let next: WorldState = { ...world, orderAttempts: world.orderAttempts.map((candidate) => (candidate.id === attempt.id ? answered : candidate)) };
  if (!quiet) next = remember(next, orderAnswerCauses(next, answered, answered.standing) as Grievance[], input.toDay, `${answered.id}:answer`);
  const issuer = attempt.issuerRef;
  const recipient = attempt.recipientRef;
  return {
    world: next,
    facts: [{
      localId: `answered_${attempt.id}`.slice(0, 60),
      kind: `request_${answered.status}`,
      summary: told.slice(0, 600),
      affectedRefs: [issuer, recipient],
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      knownToRefs: [issuer, recipient],
      significance: input.playerCharacterId === issuer.id ? 45 : 20,
    }],
  };
}

/**
 * A yes that is still only a yes. With a structured ask, it is carried out
 * (the model's acceptance of "take me as your legate" is the taking). With
 * nothing the engine can read, it is closed after `ACCEPTED_LAPSE_DAYS` by the
 * promise behind it: carried out where he kept it, abandoned where he did not.
 * Before, such an attempt stayed accepted for ever (E6).
 */
function settleAccepted(world: WorldState, attempt: OrderAttempt, input: Omit<RequestsInput, "world">): { world: WorldState; facts: FactProposalDraft[] } {
  const ask = attempt.ask;
  if (ask !== undefined && ask.kind !== "other") {
    const can = grantable(world, attempt, ask, input);
    if (can.ok) {
      const done = can.carryOut(world);
      return {
        world: { ...done, orderAttempts: done.orderAttempts.map((candidate) => (candidate.id === attempt.id ? completeOrderAttempt(candidate, input.toDay) : candidate)) },
        facts: [closing(attempt, `${can.done}.`, input)],
      };
    }
    return {
      world: { ...world, orderAttempts: world.orderAttempts.map((candidate) => (candidate.id === attempt.id ? abandonOrderAttempt(candidate, input.toDay) : candidate)) },
      facts: [closing(attempt, `${can.refused}, though he had said he would: ${can.reason}.`, input)],
    };
  }
  // A part of an order with goals of its own is read by them (`settleDelegations`).
  const readable = world.orders.some((order) => order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)
    && (part.goals.length > 0 || part.workRefs.some((ref) => ref.kind !== "order_attempt"))));
  if (readable || attempt.decidedAtStep === null || input.toDay - attempt.decidedAtStep < ACCEPTED_LAPSE_DAYS) return { world, facts: [] };
  const promise = world.commitments.find((commitment) => commitment.promisorCharacterId === attempt.recipientRef.id && commitment.beneficiaryCharacterId === attempt.issuerRef.id
    && commitment.createdAtStep >= attempt.issuedAtStep);
  const kept = promise?.status === "fulfilled";
  if (promise !== undefined && !kept && !["broken", "failed", "cancelled"].includes(promise.status) && input.toDay < promise.reviewAtStep) return { world, facts: [] };
  const closed = kept ? completeOrderAttempt(attempt, input.toDay) : abandonOrderAttempt(attempt, input.toDay);
  const giver = nameOf(world, attempt.recipientRef.id);
  return {
    world: { ...world, orderAttempts: world.orderAttempts.map((candidate) => (candidate.id === attempt.id ? closed : candidate)) },
    facts: kept ? [] : [closing(attempt, `${giver} said yes to ${nameOf(world, attempt.issuerRef.id)} (${attempt.instruction.slice(0, 160)}), and nothing came of it.`, input)],
  };
}

function closing(attempt: OrderAttempt, summary: string, input: Omit<RequestsInput, "world">): FactProposalDraft {
  return {
    localId: `closed_${attempt.id}`.slice(0, 60),
    kind: "request_closed",
    summary: summary.slice(0, 600),
    affectedRefs: [attempt.issuerRef, attempt.recipientRef],
    visibility: "private",
    discoveryState: "private",
    knowableInDays: 0,
    knownToRefs: [attempt.issuerRef, attempt.recipientRef],
    significance: input.playerCharacterId === attempt.issuerRef.id ? 40 : 15,
  };
}
