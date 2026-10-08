import { z } from "zod";
import { type Character, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { dispositionOf, natureInWords } from "./disposition";
import { conductInWords } from "./nature";
import { feudForTheVoice } from "./feuds-in-letters";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";

/**
 * The letters a power writes the player, in the sender's own voice.
 *
 * Letters between powers nobody plays are basic, written from templates
 * (`letter-craft.ts`) and cost nothing. A letter the PLAYER reads is the one
 * place the world speaks to him, so it is worded by the model, like a letter
 * from a person: the rules have decided what it says -- the wrong, the demand,
 * the deadline, the threat -- and the model says it as that man would, from
 * who he is.
 *
 * What the model may not do is change what was decided. Every letter is
 * checked: a deadline the template named must be named, an ultimatum must still
 * say it is war if refused, and anything the model cannot be trusted with
 * keeps the template's words. At most `VOICE_CAP` letters are voiced in a turn,
 * in a single call, the most threatening first; the rest keep the template.
 */

/** Letters the model words for the player in one turn. */
export const VOICE_CAP = 4;

const VoicedSchema = z.object({
  // One bad letter must not cost the rest: each is judged on its own below.
  letters: z.array(z.object({ id: z.string(), subject: z.string().max(600).default(""), body: z.string().max(3_000) })).max(VOICE_CAP * 2),
});

export const VOICE_SYSTEM_PROMPT = [
  "You write letters between rulers in the third century BC Mediterranean, each in the first person, as the sender.",
  "For every letter you are given who is writing, what he is like, and what the letter must say. You decide HOW he says it, never WHAT.",
  "Rules:",
  "- Keep every demand, term, deadline, threat and grievance in the substance, exactly. Do not add new demands, offers, names, places or facts.",
  "- If the substance names a number of days, the letter names it. If it says war follows a refusal, the letter says so, in his own way.",
  "- Write as the man is: a proud one is cold, a frightened one pleads, a courtly one is warm, a cruel one threatens, a faithless one hedges. Never as a modern person.",
  "- 60 to 170 words. Plain, period diction. No headings, no lists, no sign-off name.",
  'Answer with JSON and nothing else: {"letters":[{"id":"<the id given>","subject":"<a short subject line>","body":"<the letter>"}]}',
].join("\n");

/** Whether the model left the substance as it was, as far as can be checked without reading it. */
export function keepsTheSubstance(message: DiplomaticMessage, body: string, days: number | null): boolean {
  if (days !== null && !new RegExp(`\\b${days}\\b|${numberWord(days)}`, "i").test(body)) return false;
  if (message.onRefusal === "war" && !/\bwar\b|\barms\b|\bsword\b|\bfight|\bbattle|\bwar-?s?\b|\bhostil/i.test(body)) return false;
  return true;
}

const WORDS: Readonly<Record<number, string>> = { 30: "thirty|month", 40: "forty", 45: "forty-five|forty five", 60: "sixty|two months" };
const numberWord = (n: number): string => WORDS[n] ?? String(n);

export interface VoiceInput {
  readonly world: WorldState;
  readonly port: SimModelPort;
  readonly playerCharacterId: string | null;
  readonly playerPolityId: string | null;
  /** The messages to word, most pressing first, already chosen. */
  readonly messages: readonly DiplomaticMessage[];
  /** The player's own people's dispatches, worded in the same call within the same cap: what each says, as the rules wrote it. */
  readonly dispatches?: readonly Dispatch[];
}

/** A report to the player from somebody who works for him, worded in the same call as the letters. */
export interface Dispatch {
  readonly id: string;
  readonly sender: Character;
  /** What it says, as the rules wrote it, shading and all. */
  readonly substance: string;
}

/** What the model is told about one dispatch. */
function briefDispatch(world: WorldState, item: Dispatch): string {
  const d = dispositionOf(item.sender, world.instant.day);
  const nature = natureInWords(d);
  return [
    `LETTER [${item.id}] (a report to his commander)`,
    `From ${item.sender.name}, who serves under the man who will read it. Write it as him.`,
    `What he is like: ${nature.length === 0 ? "even-tempered" : nature.join("; ")}.`,
    `It must say, in substance, as he says it: ${item.substance}`,
    "He tells it his own way: keep what he claims and what he asks, as written. Do not correct it.",
  ].join("\n");
}

/** The letters to word this turn: rule-written, to the player's power or to him, not yet voiced, the heaviest first. */
export function lettersToVoice(world: WorldState, playerCharacterId: string | null, playerPolityId: string | null): DiplomaticMessage[] {
  if (playerPolityId === null && playerCharacterId === null) return [];
  const writtenByRule = new Set(world.statecraft.log.filter((entry) => entry.act === "letter").map((entry) => `${entry.polityId}>${entry.targetPolityId ?? ""}@${entry.day}`));
  const weight = (message: DiplomaticMessage): number => (message.kind === "ultimatum" ? 3 : message.kind === "warning" ? 2 : 1);
  return world.diplomacy
    .filter((message) => message.voicedByModel !== true && message.status === "awaiting_reply"
      && (message.toPolityId === playerPolityId || (playerCharacterId !== null && message.toCharacterId === playerCharacterId))
      && message.fromPolityId !== playerPolityId
      && [message.sentAtStep, message.sentAtStep - 1, message.sentAtStep + 1].some((day) => writtenByRule.has(`${message.fromPolityId}>${message.toPolityId}@${day}`)))
    .sort((a, b) => weight(b) - weight(a) || b.sentAtStep - a.sentAtStep)
    .slice(0, VOICE_CAP);
}

/** What the model is told about one letter. */
function brief(world: WorldState, message: DiplomaticMessage): string {
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const writer: Character | undefined = world.characters.find((character) => character.id === message.fromCharacterId);
  const d = writer === undefined ? null : dispositionOf(writer, world.instant.day);
  const days = message.replyDueByStep === null ? null : Math.max(1, message.replyDueByStep - message.sentAtStep);
  const nature = d === null ? [] : natureInWords(d);
  const conduct = writer === undefined ? [] : conductInWords(world, writer);
  return [
    `LETTER [${message.id}] (${message.kind})`,
    `From ${writer?.name ?? "the ruler"} of ${nameOf(message.fromPolityId)}, to ${nameOf(message.toPolityId)}.`,
    `What he is like: ${nature.length === 0 ? "even-tempered" : nature.join("; ")}.${conduct.length === 0 ? "" : ` ${conduct.slice(0, 3).join(" ")}`}`,
    feudForTheVoice(world, writer, message.toCharacterId) ?? "",
    `Subject: ${message.subject}`,
    `It must say, in substance: ${message.terms}`,
    days === null ? "No deadline." : `Deadline: ${days} days.`,
    message.onRefusal === "war" ? "If refused, or left unanswered, it is war." : "",
  ].filter((line) => line !== "").join("\n");
}

export interface VoiceResult {
  readonly world: WorldState;
  readonly calls: number;
  readonly voiced: number;
  readonly failure: string | null;
  /** The dispatches that were worded: each id and what he now says. */
  readonly dispatches: ReadonlyMap<string, string>;
}

/** One call, up to `VOICE_CAP` letters, each checked. Whatever fails keeps its template. */
export async function voiceLetters(input: VoiceInput): Promise<VoiceResult> {
  const { world, messages } = input;
  const reports = input.dispatches ?? [];
  if (messages.length === 0 && reports.length === 0) return { world, calls: 0, voiced: 0, dispatches: new Map(), failure: null };
  let raw: string;
  try {
    raw = await input.port.complete("voice_letters", VOICE_SYSTEM_PROMPT, [...messages.map((message) => brief(world, message)), ...reports.map((item) => briefDispatch(world, item))].join("\n\n"));
  } catch (error) {
    return { world, calls: 1, voiced: 0, dispatches: new Map(), failure: `voice_letters: ${error instanceof Error ? error.message : String(error)}` };
  }
  let json: unknown;
  try { json = extractJson(raw); } catch { return { world, calls: 1, voiced: 0, dispatches: new Map(), failure: "voice_letters: no letters in the answer" }; }
  const parsed = VoicedSchema.safeParse(json);
  if (!parsed.success) return { world, calls: 1, voiced: 0, dispatches: new Map(), failure: "voice_letters: the answer was not the letters asked for" };
  const given = new Map(messages.map((message) => [message.id, message]));
  const written = new Map<string, { subject: string; body: string }>();
  const reported = new Map<string, string>();
  const reportIds = new Set(reports.map((item) => item.id));
  for (const letter of parsed.data.letters) {
    // A subordinate's own report: any body of a fair length that is his, never more than a fact may hold.
    if (reportIds.has(letter.id)) {
      const item = reports.find((candidate) => candidate.id === letter.id)!;
      if (letter.body.trim().length >= 40) reported.set(letter.id, `${item.sender.name} writes: ${letter.body.trim()}`.slice(0, 400));
      continue;
    }
    const message = given.get(letter.id);
    if (message === undefined) continue;
    const days = message.replyDueByStep === null ? null : Math.max(1, message.replyDueByStep - message.sentAtStep);
    if (!keepsTheSubstance(message, letter.body, days)) continue;
    if (letter.body.trim().length < 40 || letter.body.trim().length > 1_150 || letter.subject.trim().length < 3) continue;
    written.set(letter.id, { subject: letter.subject.trim().slice(0, 240), body: letter.body.trim() });
  }
  const diplomacy = world.diplomacy.map((message) => {
    const said = written.get(message.id);
    // Voiced, or tried and left as it was: either way the model is not asked again.
    return said === undefined ? (given.has(message.id) ? { ...message, voicedByModel: true } : message) : { ...message, subject: said.subject.slice(0, 240), terms: said.body.slice(0, 1_200), voicedByModel: true };
  });
  return { world: { ...world, diplomacy }, calls: 1, voiced: written.size + reported.size, failure: null, dispatches: reported };
}
