import { PEACE_AT, TRUCE_AT, computeOpinion, stableHash, warStanding, warWeariness, warsOf, type Character, type DiplomaticMessage, type TradeTerms, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { dispositionOf, leastOdds, peaceReluctance } from "./disposition";
import { favouredNeighbour, hasQuirk } from "./quirks";
import { perceivedRatio } from "./perceive";
import type { Intent, LetterFacts, Reason } from "./letter-craft";
import { tradeVerdict } from "./trade-verdict";
import { feudCounsel, feudLikingShift, quarrelBetween, type Quarrel } from "./feuds-in-letters";

/**
 * What a person would say to a letter, decided by who they are -- before anyone
 * words it.
 *
 * This is the substance. The world AI words it from templates for letters
 * between powers nobody is playing (`statecraft.ts`); the model words it for the
 * player (`letter-voice.ts`). Where the model answers for somebody -- and it
 * answers every letter the player writes, at the moment he sends it
 * (`letter-reply.ts`) -- this is counsel, not command: it is put before the
 * model as what his interests and nature say (`adviceOnALetter`), and the
 * model's yes or no, or terms of its own, stand. Only the one impossibility is
 * held by the engine (`holdAnswerToAuthority`). Pure and deterministic.
 */
export interface Verdict {
  readonly accepted: boolean;
  readonly intent: Intent;
  readonly reason: Reason;
  /** In a few words, for the ledger. */
  readonly why: string;
  readonly extra: Partial<LetterFacts>;
  /** A man who cannot afford to threaten, or to be proud, says so in his tone. */
  readonly weak: boolean;
  /** Days he takes counsel before answering, if the term allows. */
  readonly slowness: number;
  /** An offer of trade he would not take as written but would on these terms: answered "countered", the terms sent back. */
  readonly counter?: TradeTerms;
  /** An offer of trade or a notice of embargo written to somebody who does not decide it: the one who does. */
  readonly redirect?: { readonly characterId: string; readonly name: string };
  /** The quarrel between his gens and the writer's, where there is one hot enough to be heard (feuds-in-letters.ts): counsel, and a coolness in the words. */
  readonly feud?: Quarrel;
}

/** The days between a power's reviews of what has come in: no answer is quicker than the next. */
export const STEP_DAYS = 30;

/** Kinds of letter whose answer is the answerer's nature at work in a large matter. */
export const LARGE_MATTERS = new Set<DiplomaticMessage["kind"]>(["ultimatum", "warning", "protest", "tribute_demand", "peace_offer", "peace_talks", "alliance_offer", "military_aid_request", "trade_offer", "embargo_notice"]);

/**
 * What the rules would say to a letter, as counsel to the one who answers it.
 *
 * Said to the model in the answerer's own section, in terms of what his
 * interests and nature make of the matter. It is advice and the line says so:
 * the answer is his, and he may go against it with a reason. The one thing
 * said as a bar is a letter written to somebody who does not decide it, for the
 * engine will not take his yes or no there (`holdAnswerToAuthority`).
 */
export function adviceOnALetter(verdict: Verdict): string {
  if (verdict.redirect !== undefined) {
    return `      This is not yours to decide: ${verdict.redirect.name} answers for your power in such matters. Answer "countered", saying so and naming him; the engine will not carry out a yes or a no from you here.`;
  }
  if (verdict.counter !== undefined) {
    const free = verdict.counter.exempt.length > 0 ? `, ${verdict.counter.exempt.join(", ")} free` : "";
    return `      What your interests and nature say: you would not sign this as written (${verdict.why}). Terms you could keep: customs capped at ${verdict.counter.tariffCapBps ?? "no cap"}${free}. This is counsel, and the answer is yours: take it, or answer otherwise and give your reason. To deal on other terms, answer "countered" with counterTrade set to them.`;
  }
  const counsel = `      What your interests and nature say: ${verdict.accepted ? "yes" : "no"} (${verdict.why}). This is counsel, and the answer is yours: follow it, or go against it with a reason, in your own words.`;
  return verdict.feud === undefined ? counsel : `${counsel}\n${feudCounsel(verdict.feud)}`;
}

export function letterVerdict(world: WorldState, message: DiplomaticMessage, answerer: Character): Verdict | null {
  // A feud between the two men's gentes sours his liking for the writer by a few points (bounded), and is named in the counsel and the words.
  const quarrel = quarrelBetween(world, answerer.id, message.fromCharacterId);
  const verdict = decide(world, message, answerer, feudLikingShift(quarrel));
  if (verdict === null || quarrel === null) return verdict;
  return { ...verdict, feud: quarrel, extra: { ...verdict.extra, feud: quarrel } };
}

function decide(world: WorldState, message: DiplomaticMessage, answerer: Character, feudShift: number): Verdict | null {
  const day = world.instant.day;
  const d = dispositionOf(answerer, day);
  const trust = world.polityStances.find((stance) => stance.polityId === message.toPolityId && stance.towardPolityId === message.fromPolityId)?.trustScore ?? 0;
  const proposes = new Set(message.proposes ?? []);
  // What he thinks of the man who wrote, as a man: a friend is given what a stranger would not be, and an enemy is not.
  const liking = Math.max(-60, Math.min(60, computeOpinion(answerer, message.fromCharacterId) + feudShift));
  const near = readBoard(world).get(message.toPolityId)?.neighbours.map((neighbour) => neighbour.polityId) ?? [];
  const unforgiven = favouredNeighbour(answerer, near, "grudge_bearer") === message.fromPolityId;
  const fondOf = favouredNeighbour(answerer, near, "loyal_friend") === message.fromPolityId;
  // What is particular to him (quirks.ts): small, and the same every time.
  const suspicious = hasQuirk(answerer, "suspicious") ? 1 : 0;
  const generous = hasQuirk(answerer, "generous") ? 1 : 0;
  const stubborn = hasQuirk(answerer, "stubborn") ? 1 : 0;
  const tender = hasQuirk(answerer, "tender_hearted") ? 1 : 0;
  const bias = (fondOf ? 25 : 0) - (unforgiven ? 25 : 0);
  const reluctance = peaceReluctance(d) - 8 * tender - Math.round(liking / 6) + 6 * suspicious + (unforgiven ? 8 : 0) - (fondOf ? 8 : 0);
  const omen = hasQuirk(answerer, "superstitious") && stableHash([answerer.id, "omen", String(Math.floor(day / 30))]) % 4 === 0 ? STEP_DAYS : 0;
  const slowness = Math.round(Math.max(0, Math.min(2, d.fear * 0.7 + (1 - d.nerve) * 0.7 + d.steadiness * 0.4 - 0.6))) * STEP_DAYS + omen;
  const done = (accepted: boolean, intent: Intent, reason: Reason, why: string, extra: Partial<LetterFacts> = {}, weak = false): Verdict =>
    ({ accepted, intent, reason, why, extra, weak, slowness });

  // Trade is weighed by what his power's books say (`trade-verdict.ts`): customs given up, bread, trust, what already stands.
  if (message.kind === "trade_offer" || message.kind === "embargo_notice") {
    return tradeVerdict(world, message, answerer, { d, trust, liking, bias, suspicious, generous, stubborn, unforgiven, fondOf, slowness });
  }

  if (message.kind === "peace_talks") {
    // Talking costs nothing a tired or losing power, or one six months into its war, will not give -- unless he is proud, and not beaten.
    const tired = warWeariness(world, message.toPolityId, message.fromPolityId).score;
    const losing = warStanding(world, message.toPolityId, message.fromPolityId).score <= -20;
    const long = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes(message.toPolityId) && [agreement.polityId, agreement.otherPolityId].includes(message.fromPolityId) && day - agreement.sinceStep >= 180);
    const accepted = losing || (long && d.pride + 0.15 * stubborn < 0.7) || tired >= TRUCE_AT - 10 + reluctance;
    return done(accepted, accepted ? "talks_accept" : "talks_refuse", accepted ? "tired" : d.pride >= 0.7 ? "not_beaten" : "none", accepted ? "tired of the war" : "not yet");
  }

  // An ultimatum, a demand, a complaint: the answer is how he weighs the quarrel against the odds.
  if (message.kind === "ultimatum" || message.kind === "warning" || message.kind === "protest" || message.kind === "tribute_demand") {
    const there = readBoard(world).get(message.toPolityId)?.neighbours.find((neighbour) => neighbour.polityId === message.fromPolityId);
    // Our strength over theirs: what he would fight at, and what he would not.
    const odds = there === undefined ? 1 : perceivedRatio(world, answerer, there);
    // A man who is stubborn, or who hates the writer, gives way later; one who likes him, sooner.
    const pride = d.pride + 0.15 * stubborn + (unforgiven ? 0.15 : 0) + (liking < -30 ? 0.1 : 0) - (liking > 30 ? 0.12 : 0) - (fondOf ? 0.15 : 0);
    const wouldFight = odds >= leastOdds(d) * 0.8 || (pride >= 0.85 && odds >= 0.3);
    const threat = message.kind === "ultimatum" && (message.onRefusal ?? null) !== null;
    // A man with a clear conscience and a weak hand gives way; a proud or strong one does not.
    const yields = !wouldFight && !(pride >= 0.7 && odds >= 0.5);
    const redress = message.kind === "ultimatum" || message.kind === "tribute_demand" ? yields : (yields || (d.honour >= 0.7 && pride < 0.6));
    return done(redress, redress ? "submit" : "defy", redress ? "weakness" : "none", redress ? "gave way" : threat ? "defied the threat" : "would not", { matter: message.subject }, redress);
  }

  if (message.kind === "peace_offer" || proposes.has("peace") || proposes.has("truce")) {
    const tired = warWeariness(world, message.toPolityId, message.fromPolityId).score;
    const losing = warStanding(world, message.toPolityId, message.fromPolityId).score <= -30;
    const accepted = losing || tired >= (proposes.has("truce") && !proposes.has("peace") ? TRUCE_AT : PEACE_AT - 10) + reluctance;
    return done(accepted, accepted ? "peace_accept" : "peace_refuse", accepted ? (losing ? "losing" : "tired") : d.pride >= 0.6 ? "not_beaten" : "none", accepted ? "tired or beaten" : "not beaten");
  }
  // A pact not to make war is weighed as a quiet border: the frightened and the sociable take it, the proud who bear a grudge
  // do not. It had no counsel at all, and the answerer was left to guess (hand run, Hieron's pact: M5).
  if (proposes.has("non_aggression") && !proposes.has("alliance")) {
    const needed = -15 - 20 * (d.fear - 0.5) - 15 * (d.sociability - 0.5) + 10 * suspicious - liking / 6 - bias;
    const accepted = !unforgiven && trust >= needed;
    return done(accepted, accepted ? "peace_accept" : "peace_refuse", accepted ? "friendship" : unforgiven ? "distrust" : "no_quarrel", accepted ? "a quiet border" : unforgiven ? "an old grievance" : "no reason to bind ourselves");
  }
  if (proposes.has("alliance")) {
    const sharedEnemy = warsOf(world.polityAgreements, message.toPolityId).some((enemy) => warsOf(world.polityAgreements, message.fromPolityId).includes(enemy));
    // The sociable and the frightened look for friends; the proud and self-sufficient want more before they bind themselves.
    // A power whose own government has named its want of a friend as a high worry, and means to seek a protector, is not
    // told "no quarrel of ours" by its counsellors when a protector writes (hand run, Mettius: M5).
    const lonely = (world.polityOutlooks.find((outlook) => outlook.polityId === message.toPolityId)?.concerns ?? []).some((concern) => /\bno (?:ally|friend|protector)\b/i.test(concern.label) && concern.level === "high");
    const needed = 20 - 30 * (d.sociability - 0.5) - 20 * (d.fear - 0.5) - liking / 4 + 15 * suspicious - 8 * generous - bias - (lonely ? 25 : 0);
    const accepted = trust >= needed || (trust >= needed - 20 && (sharedEnemy || lonely));
    return done(accepted, accepted ? "alliance_accept" : "alliance_refuse", accepted ? (sharedEnemy ? "common_enemy" : "friendship") : d.honour >= 0.7 ? "honour" : sharedEnemy ? "distrust" : "no_quarrel", accepted ? (lonely && !sharedEnemy ? "a protector at need" : "a friend") : sharedEnemy ? "no trust enough to bind ourselves, enemy or no" : "no quarrel of ours", { matter: sharedEnemy ? "our common enemy" : "those who threaten us" });
  }
  if (message.kind === "military_aid_request") {
    const accepted = trust >= 40 - 30 * (d.honour - 0.5) - 20 * (d.sociability - 0.5) - liking / 3 + 10 * suspicious - 15 * generous - bias && warsOf(world.polityAgreements, message.toPolityId).length === 0;
    return done(accepted, accepted ? "aid_accept" : "aid_refuse", accepted ? "friendship" : "cannot_spare", accepted ? "a friend in need" : "no men to spare");
  }
  return null;
}
