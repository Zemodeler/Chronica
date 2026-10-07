import { WorldDeltaSchema, PEACE_AT, agreementsBetween, fitStrengthOf, readDepartments, warStanding, warWeariness, type Character, type WorldDelta, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { commandersTemper } from "./statecraft";
import { writeLetter } from "./letter-craft";
import { moodInWords } from "./moods";
import { quirksOf } from "./quirks";
import { perceivedRatio } from "./perceive";
import { LARGE_MATTERS, letterVerdict } from "./letter-verdict";
import { hasGrievance } from "./treaties";
import { dispositionOf, leastOdds, peaceReluctance } from "./disposition";

/**
 * Nature binds the person, whoever plays them (no model call anywhere here).
 *
 * The rules play most of the world and read a ruler's whole mind
 * (`disposition.ts`). When the model plays somebody it used to be handed his
 * temperament as a few words of prose and left to act on them -- and a model
 * asked "what do you do?" answers like a sensible strategist whoever you tell
 * it it is. A cowardly king opened hopeless wars; a man of honour broke
 * treaties on a whim; a man who would not shed blood ordered an execution.
 *
 * Two things fix that, both from the same numbers the rules use:
 *
 * - `conductInWords` tells the model, in terms of what the engine will hold him
 *   to, how this person decides -- the odds he will take, whether he forgives,
 *   whether his word binds him, how he takes peace.
 * - `natureObjects` is the engine holding him to it, in the large matters only
 *   (war, peace, oaths, battle, bloodshed): an act the person would not do is
 *   not carried out, and the reason is written down so the model and the
 *   player can see it was his nature that stopped it.
 *
 * Small acts are never gated; only the ones that change a nation.
 */

/** What an act of war needs of the man who makes it: his own odds, his own honour. */
export function conductInWords(world: WorldState, character: Character): string[] {
  const d = dispositionOf(character, world.instant.day);
  const lines: string[] = [];
  const odds = leastOdds(d);
  if (d.nerve >= 0.65) lines.push(`You take a fight at even odds, or worse, rather than wait: you would rather lose by daring than win by waiting.`);
  else if (d.nerve <= 0.3 || d.fear >= 0.7) lines.push(`You do not start a war you are not far the stronger in -- about ${odds.toFixed(1)} to 1 in your favour, or better. A hopeless war is not one you will open, however it is put to you.`);
  if (d.grudge >= 0.65) lines.push("You do not forgive. An old wrong is a live one, and you will go to some length to answer it.");
  else if (d.grudge <= 0.3) lines.push("You let old wrongs go. Revenge for its own sake is not in you.");
  if (d.honour >= 0.7) lines.push("Your sworn word binds you at cost to yourself. You will not break a peace or a treaty without a wrong done to you first.");
  else if (d.honour <= 0.3) lines.push("A treaty binds you only while it suits you.");
  if (d.pride >= 0.7) lines.push("You will not be the first to ask for peace unless you are beaten, and a war you could be winning is not one you will end.");
  else if (d.pride <= 0.3) lines.push("You take peace readily when a war is going badly, and are not ashamed to ask for it.");
  if (d.greed >= 0.65) lines.push("You look first at what a thing would bring you or your power: land, gold, standing.");
  if (d.fear >= 0.65) lines.push("You see threats before chances, and would strike first at a neighbour who is growing too strong.");
  if (d.steadiness <= 0.3) lines.push("You act on mood, and may reverse yourself within the week.");
  else if (d.steadiness >= 0.7) lines.push("You do what you have planned, and you do not change your mind for a clever argument.");
  lines.push(...moodInWords(character, world.instant.day));
  // And what is particular to him: the settled habits of his mind (quirks.ts).
  lines.push(...quirksOf(character).map((quirk) => quirk.words));
  if (lines.length > 0) lines.push("This is who you are, and the engine will not carry out a large act that goes against it: a war, a peace, a broken oath, a battle, a killing.");
  return lines;
}

/**
 * A model's answer to a letter on a large matter, brought into line with who the
 * answerer is. The model may word it, not reverse it: a frightened king does not
 * say yes to a war, nor a proud one to a humiliation. The words are replaced
 * with the rule's own, so the answer reads as what it now is. Anything else is
 * returned as it came.
 */
export function bindAnswerToNature(world: WorldState, actorId: string, act: WorldDelta): { readonly act: WorldDelta; readonly brought: string | null } {
  if (act.op !== "diplomatic_message_answer" || (act.answer !== "accepted" && act.answer !== "refused")) return { act, brought: null };
  const message = world.diplomacy.find((candidate) => candidate.id === act.messageRef);
  const actor = world.characters.find((character) => character.id === actorId);
  if (message === undefined || actor === undefined || !LARGE_MATTERS.has(message.kind)) return { act, brought: null };
  const verdict = letterVerdict(world, message, actor);
  // Written to somebody who does not decide it, he only says who does, whatever the model had him say.
  if (verdict === null || (verdict.redirect === undefined && (act.answer === "accepted") === verdict.accepted)) return { act, brought: null };
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const letter = writeLetter(actor, world.instant.day, verdict.intent, { us: nameOf(message.toPolityId), them: nameOf(message.fromPolityId), reason: verdict.reason, ...verdict.extra }, "{us} answers {them}", verdict.weak);
  // A pact he would sign on terms of his own is answered "countered" with them, which sends them back as an offer (`counterTrade`).
  const answer = verdict.redirect !== undefined || verdict.counter !== undefined ? "countered" : verdict.accepted ? "accepted" : "refused";
  const bound = WorldDeltaSchema.parse({ ...act, answer, answerText: letter.body, refusedClauses: [], addedTerms: null, ...(verdict.counter === undefined ? {} : { counterTrade: verdict.counter }), reason: letter.body.slice(0, 240) });
  return { act: bound, brought: `${actor.name} would not have answered "${message.subject}" as the model had him: it is not in him (${verdict.why}).` };
}

const rulerOfPolity = (world: WorldState, polityId: string): Character | undefined => readDepartments(world).rulers(polityId).find((ruler) => ruler.alive);

/**
 * Why a person would not do this, in his own terms, or null if it is not
 * against his nature. Only the large matters are ever refused.
 */
export function natureObjects(world: WorldState, actorId: string, delta: WorldDelta): string | null {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined || !actor.alive) return null;
  const d = dispositionOf(actor, world.instant.day);

  // ── War and peace: only his to make if he is the ruler ─────────────────
  if (delta.op === "agreement_open" && (delta.kind === "war" || delta.kind === "peace" || delta.kind === "truce") && rulerOfPolity(world, delta.polityId)?.id === actorId) {
    const ours = delta.polityId;
    const theirs = delta.otherPolityId;
    if (delta.kind === "war") {
      const neighbour = readBoard(world).get(ours)?.neighbours.find((reading) => reading.polityId === theirs);
      // A hopeless war is not one a frightened man opens.
      if (neighbour !== undefined && perceivedRatio(world, actor, neighbour) < leastOdds(d) * 0.7) {
        return `${actor.name} would not open a war at these odds: ${neighbour.name} is stronger than he can answer, and he is not a man who gambles like that.`;
      }
      // Nor does a man of honour break a sworn peace with no wrong done him.
      const sworn = agreementsBetween(world.polityAgreements, ours, theirs).some((agreement) => agreement.status === "active" && (agreement.kind === "peace" || agreement.kind === "alliance" || agreement.kind === "foedus"));
      const wronged = hasGrievance(world, ours, theirs);
      if (sworn && !wronged && d.honour >= 0.75) return `${actor.name} will not break his sworn word to ${world.map.polities.find((polity) => polity.id === theirs)?.name ?? theirs} with no wrong done to him: it is not in him.`;
    } else {
      // A proud man in a war he is not losing does not sue for peace.
      const weary = warWeariness(world, ours, theirs).score;
      const standing = warStanding(world, ours, theirs).score;
      if (d.pride >= 0.8 && standing > -20 && weary < PEACE_AT - 10 + peaceReluctance(d)) {
        return `${actor.name} will not be the one to ask for peace: he is not beaten, and he is too proud to sue for it.`;
      }
    }
  }

  // ── Battle: a commander's own sense of the odds ────────────────────────
  if (delta.op === "force_engage" && delta.posture === "offer_battle") {
    const mine = world.material.forces.find((force) => force.id === delta.forceRef);
    const theirs = world.material.forces.find((force) => force.id === delta.targetForceRef);
    if (mine !== undefined && theirs !== undefined && mine.commanderCharacterId === actorId) {
      const temper = commandersTemper(actor);
      const men = fitStrengthOf(mine);
      const foe = fitStrengthOf(theirs);
      if (foe > 0 && men < 0.6 * temper.wants * foe) return `${actor.name} will not give battle at these odds: ${men.toLocaleString("en-GB")} against ${foe.toLocaleString("en-GB")} is not a fight he takes.`;
    }
  }

  // ── Bloodshed: a gentle man does not order a man killed out of hand ─────
  if (delta.op === "character_death" && delta.manner === "execution" && delta.byCharacterRef === actorId && d.cruelty <= 0.2) {
    return `${actor.name} will not have a man put to death out of hand: it is not in his nature, whatever the argument for it.`;
  }
  return null;
}
