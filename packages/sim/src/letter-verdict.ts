import { PEACE_AT, TRUCE_AT, computeOpinion, stableHash, warStanding, warWeariness, warsOf, type Character, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { dispositionOf, leastOdds, peaceReluctance } from "./disposition";
import { favouredNeighbour, hasQuirk } from "./quirks";
import { perceivedRatio } from "./perceive";
import type { Intent, LetterFacts, Reason } from "./letter-craft";

/**
 * What a person would say to a letter, decided by who they are -- before anyone
 * words it.
 *
 * This is the substance. The world AI words it from templates for letters
 * between powers nobody is playing (`statecraft.ts`); the model words it for the
 * player (`letter-voice.ts`); and when the model is answering for somebody it is
 * held to it, as a ruler is held to his nature in the large matters
 * (`nature.ts`): it may say it as he would say it, but not say yes where he
 * would say no. Pure and deterministic.
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
}

/** The days between a power's reviews of what has come in: no answer is quicker than the next. */
export const STEP_DAYS = 30;

/** Kinds of letter whose answer is the answerer's nature at work in a large matter. */
export const LARGE_MATTERS = new Set<DiplomaticMessage["kind"]>(["ultimatum", "warning", "protest", "tribute_demand", "peace_offer", "peace_talks", "alliance_offer", "military_aid_request"]);

export function letterVerdict(world: WorldState, message: DiplomaticMessage, answerer: Character): Verdict | null {
  const day = world.instant.day;
  const d = dispositionOf(answerer, day);
  const trust = world.polityStances.find((stance) => stance.polityId === message.toPolityId && stance.towardPolityId === message.fromPolityId)?.trustScore ?? 0;
  const proposes = new Set(message.proposes ?? []);
  // What he thinks of the man who wrote, as a man: a friend is given what a stranger would not be, and an enemy is not.
  const liking = Math.max(-60, Math.min(60, computeOpinion(answerer, message.fromCharacterId)));
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
  if (proposes.has("alliance")) {
    const sharedEnemy = warsOf(world.polityAgreements, message.toPolityId).some((enemy) => warsOf(world.polityAgreements, message.fromPolityId).includes(enemy));
    // The sociable and the frightened look for friends; the proud and self-sufficient want more before they bind themselves.
    const needed = 20 - 30 * (d.sociability - 0.5) - 20 * (d.fear - 0.5) - liking / 4 + 15 * suspicious - 8 * generous - bias;
    const accepted = trust >= needed || (trust >= needed - 20 && sharedEnemy);
    return done(accepted, accepted ? "alliance_accept" : "alliance_refuse", accepted ? (sharedEnemy ? "common_enemy" : "friendship") : d.honour >= 0.7 ? "honour" : "no_quarrel", accepted ? "a friend" : "no quarrel of ours", { matter: sharedEnemy ? "our common enemy" : "those who threaten us" });
  }
  if (message.kind === "military_aid_request") {
    const accepted = trust >= 40 - 30 * (d.honour - 0.5) - 20 * (d.sociability - 0.5) - liking / 3 + 10 * suspicious - 15 * generous - bias && warsOf(world.polityAgreements, message.toPolityId).length === 0;
    return done(accepted, accepted ? "aid_accept" : "aid_refuse", accepted ? "friendship" : "cannot_spare", accepted ? "a friend in need" : "no men to spare");
  }
  return null;
}
