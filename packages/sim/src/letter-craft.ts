import { stableHash, type Character } from "@chronica/shared";
import { dispositionOf } from "./disposition";
import { flourishOf } from "./quirks";

/**
 * How a ruler writes, when no model is asked (docs/plans/a-living-world.md).
 *
 * The world AI made war, peace and alliance by rule and said nothing: a power
 * went to war without a word to its enemy, and a letter it was sent was
 * answered by one of eight stock sentences, the same for a proud king and a
 * frightened one. Letters between powers nobody is playing are written here,
 * from templates, in a voice the writer's own mind chooses:
 *
 * - **Tone** is the part of him that speaks first: the sociable and honourable
 *   write courteously; the proud and unsociable coldly; the plain-spoken
 *   bluntly; the frightened plead; the cruel and bold threaten; the faithless
 *   hedge. Continuous, never a type -- six scores, and the highest speaks, with
 *   a small stable difference between two men who score alike.
 * - **Substance** is the rules': what is asked, what is refused and why, what
 *   the deadline is. This module only words it.
 * - **Wording** is picked from banks by a hash of the writer and the matter, so
 *   the same man always sounds like himself and no two sound alike.
 *
 * Letters to or from the player are not written here. The rules decide what
 * they say, and the model voices it (`letter-voice.ts`).
 */

export type Tone = "courteous" | "blunt" | "threatening" | "pleading" | "cold" | "evasive";
export type Firmness = "soft" | "firm" | "hard";

export type Intent =
  | "complaint" | "demand" | "ultimatum"
  | "peace_offer" | "peace_accept" | "peace_refuse"
  | "talks_accept" | "talks_refuse"
  | "alliance_offer" | "alliance_accept" | "alliance_refuse"
  | "aid_accept" | "aid_refuse"
  | "submit" | "defy" | "stall"
  | "trade_accept" | "trade_refuse" | "trade_counter" | "trade_redirect"
  | "embargo_yield" | "embargo_protest";

/** Why a letter says what it says, in the terms of what moved the writer. */
export type Reason = "not_beaten" | "tired" | "losing" | "no_quarrel" | "cannot_spare" | "distrust" | "friendship" | "common_enemy" | "price" | "honour" | "weakness" | "customs" | "at_war" | "embargoed" | "grain" | "not_mine" | "none";

export interface LetterFacts {
  readonly us: string;
  readonly them: string;
  /** The wrong, claim or matter, as a short noun phrase: "the ground you took at Rhegium". */
  readonly matter?: string;
  /** Days allowed for an answer. */
  readonly days?: number;
  readonly reason?: Reason;
  /** What is asked, as a phrase: "that you withdraw your men from our border". */
  readonly ask?: string;
}

export interface Letter {
  readonly subject: string;
  readonly body: string;
  readonly tone: Tone;
}

/**
 * A power's name as a person would say it in a letter: "Epirus" for "Kingdom of
 * Epirus", "the Mamertines" for "Mamertines of Messana". Names are for the
 * records; letters say what people say.
 */
export function plainName(name: string): string {
  // A long descriptive name carries the name people use in brackets: "Arab tent-dwellers of the steppe (Scenitae)" is the Scenitae.
  const bracketed = /\(([A-Z][\w' -]{2,24})\)\s*$/.exec(name);
  if (bracketed !== null && name.length > 28) return /(ae|ii|oi|es|ans|ines|ites|ians)$/i.test(bracketed[1]!) ? `the ${bracketed[1]}` : bracketed[1]!;
  const stripped = name.replace(/^(the )?(kingdom|republic|empire|tyranny|principality|commonwealth|confederation|league|city|state|realm) of /i, "").replace(/ of [A-Z][\w' -]+$/, "");
  if (stripped !== name && stripped !== "") return /(ae|ii|oi|es|ans|ines|ites|ians)$/i.test(stripped) && !/^the /i.test(stripped) ? `the ${stripped}` : stripped;
  // "Seleucid Empire", "Achaean League": a power named for what it is, spoken of with its article.
  if (/ (empire|league|confederacy|confederation|kingdom|republic)$/i.test(name) && !/^the /i.test(name)) return `the ${name}`;
  return /(ae|ii|oi)$/i.test(name) && !/^the /i.test(name) ? `the ${name}` : name;
}

const unit = (key: string): number => (stableHash([key]) % 10_000) / 10_000;

/** How a ruler would write, as six scores, the highest winning. Weak means the writer cannot afford to threaten. */
export function toneOf(writer: Character, day: number, intent: Intent, weak = false): Tone {
  const d = dispositionOf(writer, day);
  const jitter = (tone: Tone): number => (unit(`${writer.id}:${tone}:tone`) - 0.5) * 0.12;
  const scores: Record<Tone, number> = {
    courteous: d.sociability * 0.55 + d.honour * 0.45,
    blunt: (1 - d.sociability) * 0.45 + d.nerve * 0.3 + (1 - d.pride) * 0.25,
    threatening: weak ? 0 : d.cruelty * 0.35 + d.nerve * 0.35 + d.pride * 0.3,
    pleading: d.fear * 0.65 + (1 - d.pride) * 0.35 + (weak ? 0.3 : 0),
    cold: d.pride * 0.5 + (1 - d.sociability) * 0.3 + d.steadiness * 0.2,
    evasive: (1 - d.honour) * 0.65 + (1 - d.steadiness) * 0.35,
  };
  // Some matters are not pleaded and some are not threatened.
  if (intent === "ultimatum" || intent === "defy") scores.pleading = 0;
  if (intent === "submit" || intent === "peace_accept" || intent === "alliance_accept" || intent === "trade_accept" || intent === "embargo_yield" || intent === "trade_redirect") scores.threatening *= 0.4;
  let best: Tone = "courteous";
  let top = -Infinity;
  for (const tone of Object.keys(scores) as Tone[]) {
    const score = scores[tone] + jitter(tone);
    if (score > top) { top = score; best = tone; }
  }
  return best;
}

export const firmnessOf = (tone: Tone): Firmness => (tone === "courteous" || tone === "pleading" ? "soft" : tone === "threatening" ? "hard" : "firm");

const pick = <T,>(options: readonly T[], seed: string): T => options[stableHash([seed]) % options.length]!;
const capitalised = (text: string): string => text.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase());
const fill = (text: string, facts: LetterFacts): string => capitalised(text
  .replaceAll("{us}", plainName(facts.us)).replaceAll("{them}", plainName(facts.them))
  .replaceAll("{matter}", facts.matter ?? "the matter between us").replaceAll("{days}", String(facts.days ?? 30))
  .replaceAll("{ask}", facts.ask ?? "that the matter be settled"));

/** The first thing said: the writer's own voice, before the business. */
const OPENINGS: Readonly<Record<Tone, readonly string[]>> = {
  courteous: ["{us} sends greeting to {them}, and writes as a friend.", "May the gods keep {them}. {us} writes with goodwill.", "{us} writes to {them} in the hope of continued friendship."],
  blunt: ["{us} writes plainly to {them}.", "{us} to {them}: I will not dress this up.", "To {them} from {us}, without ceremony."],
  threatening: ["{us} writes to {them}, and {them} would do well to read it with care.", "{us} has been patient with {them}. That is ending.", "Let {them} read this and understand it."],
  pleading: ["{us} writes to {them} in great anxiety, and begs a hearing.", "{us} comes to {them} as a petitioner, and hopes not in vain.", "We beg {them} to read this with a kind eye."],
  cold: ["{us} has the honour to inform {them}.", "{us} to {them}. Take note.", "{us} writes to {them} once, and expects to be understood."],
  evasive: ["{us} writes to {them} on a matter that perhaps need not have troubled either.", "Word has reached {us} that all is not well between us, and {us} would be glad to hear it false.", "{us} to {them}: a word, if {them} will allow it."],
};

/** The last thing said. */
const CLOSINGS: Readonly<Record<Tone, readonly string[]>> = {
  courteous: ["We remain, as ever, your friend.", "May the gods keep you both.", "We await your answer in good hope."],
  blunt: ["That is all.", "Answer, or do not.", "We have said what we mean."],
  threatening: ["Do not mistake our patience for weakness.", "We will not ask twice.", "Remember what we are."],
  pleading: ["We beg you, answer us kindly.", "Do not turn us away, we ask it on our knees.", "Our hope is in your mercy."],
  cold: ["We expect an answer.", "That is our position.", "The matter is stated."],
  evasive: ["No doubt it is all a misunderstanding.", "We say no more than we need.", "Take this as you will."],
};

type Bodies = Readonly<Record<Firmness, readonly string[]>>;

/** What is said, by intent and by how hard. */
const BODIES: Readonly<Record<Intent, Bodies>> = {
  complaint: {
    soft: ["We grieve to say that {matter} has hurt us. We ask {ask}, and do not doubt it was not meant.", "{matter} has troubled our people. Will {them} look into it, and see {ask}?"],
    firm: ["{matter} is a wrong to us. We ask {ask}.", "We cannot let {matter} pass. We ask {ask}."],
    hard: ["{matter} will not stand. We require {ask}, and soon.", "{them} has done {matter}, and means us to swallow it. We require {ask}."],
  },
  demand: {
    soft: ["We ask, as a friend, {ask}. {matter} makes it needful.", "Over {matter} we ask {ask}, and ask it earnestly."],
    firm: ["Over {matter}, we demand {ask}. Answer within {days} days.", "We require {ask}, for {matter}. You have {days} days."],
    hard: ["{matter} has gone on long enough. We demand {ask} within {days} days, and say now that we will not wait longer.", "We demand {ask}. {days} days."],
  },
  ultimatum: {
    soft: ["It grieves us, but we must ask {ask} within {days} days; if it is not done there will be war, which we do not wish.", "We ask {ask} within {days} days. If it is not done, we will be forced to war."],
    firm: ["We require {ask} within {days} days. If not, we are at war: {matter} leaves us no other course.", "Within {days} days we require {ask}. If not, war."],
    hard: ["We require {ask} within {days} days, or it is war and you will have chosen it. We are ready.", "You have {days} days. We require {ask}. After that we come."],
  },
  peace_offer: {
    soft: ["We have had enough of war, and offer peace on the ground each holds. We hope {them} has had enough too.", "Let this war end. We offer peace, and will not be hard about it."],
    firm: ["We offer peace on what each holds. {them} may take it or the war goes on.", "Peace, on terms that leave each what it has. Answer within {days} days."],
    hard: ["We will make peace if {them} asks for it on our terms. It is {them} who has most to lose.", "End it now, and accept what we say, or we will end it for you."],
  },
  peace_accept: {
    soft: ["The war has cost both of us dear. We gladly accept, and will keep our word.", "We accept your peace with relief, and mean it."],
    firm: ["We accept. The terms are fair and we will keep them.", "Peace is agreed. See that it is kept on your side."],
    hard: ["We accept. Understand that we do so because we choose to, not because we must.", "We take your peace. Remember who offered it first."],
  },
  peace_refuse: {
    soft: ["We would gladly have peace, but cannot yet: {reason}. We ask {them} to understand.", "We cannot accept now. {reason}. Perhaps another time."],
    firm: ["We refuse. {reason}.", "No peace: {reason}."],
    hard: ["We refuse, and will make {them} regret the asking. {reason}.", "No. {reason}. The war goes on."],
  },
  talks_accept: {
    soft: ["We will gladly send envoys to talk, and hope something comes of it.", "Let us talk. We will send our envoys."],
    firm: ["We will send envoys. We promise nothing beyond that.", "Our envoys will come to the table."],
    hard: ["We will listen. Do not expect more than that from us.", "Our envoys will attend. Do not waste their time."],
  },
  talks_refuse: {
    soft: ["We cannot yet talk, though we wish it. {reason}.", "Not yet, we beg you. {reason}."],
    firm: ["We will not talk now. {reason}.", "There is nothing to say yet. {reason}."],
    hard: ["We have nothing to say to {them}. {reason}.", "We will not talk with {them}. {reason}."],
  },
  alliance_offer: {
    soft: ["We would be glad of {them}'s friendship in arms, against those who threaten us both.", "Let us stand together, for each is safer with the other."],
    firm: ["We propose an alliance. We have a common enemy and common cause.", "We offer alliance, to stand against {matter}."],
    hard: ["We offer alliance. {them} would be unwise to refuse it, with {matter} as it is.", "Stand with us, or stand alone against {matter}."],
  },
  alliance_accept: {
    soft: ["We will stand with {them} gladly, and hold the friendship dear.", "Our friendship is yours, and our arms with it."],
    firm: ["We accept the alliance. We will stand with you.", "Agreed. Our men will come when called."],
    hard: ["We accept the alliance. Keep your own word as we shall keep ours.", "We stand with you. See that you stand with us."],
  },
  alliance_refuse: {
    soft: ["We value {them}, but cannot bind ourselves so: {reason}.", "We cannot join you in this, though we wish you well: {reason}."],
    firm: ["We decline the alliance. {reason}.", "No alliance. {reason}."],
    hard: ["We want no alliance with {them}. {reason}.", "We refuse. {reason}."],
  },
  aid_accept: {
    soft: ["Our men will come, and gladly.", "We will send what we can, and more if we may."],
    firm: ["We will send men. Do not delay them.", "Our men will march."],
    hard: ["We send men, and shall expect the debt to be remembered.", "Our men will come. You owe us for it."],
  },
  aid_refuse: {
    soft: ["We would help if we could, but: {reason}. Forgive us.", "We cannot spare men now: {reason}. We are sorry for it."],
    firm: ["We cannot send men. {reason}.", "No men: {reason}."],
    hard: ["We will not send men to {them}'s war. {reason}.", "Your war is your own. {reason}."],
  },
  submit: {
    soft: ["We have no wish to fight, and will do as you ask.", "We will do as you ask, to keep the peace between us."],
    firm: ["We will do as you ask. We have no choice we like better.", "Agreed. It is done."],
    hard: ["We will do it. Take care that you do not ask again.", "We yield this once. Do not think it will happen twice."],
  },
  defy: {
    soft: ["We cannot do as you ask, and are sorry for it, for it means war.", "We must refuse, though we know what it costs."],
    firm: ["We refuse. If it is war, it is war.", "No. We will not do it."],
    hard: ["We will not do it, and we do not fear what follows. Come when you will.", "Come and take it."],
  },
  trade_accept: {
    soft: ["We are glad to open our markets to {them} on these terms, and will keep them.", "Let our merchants trade freely, as written. We accept with a good heart."],
    firm: ["We accept the pact. Our merchants will trade on what is written.", "Agreed. The customs will be as you have set them down."],
    hard: ["We accept. Do not think the terms were given from weakness.", "We agree. Keep to your side of it, as we shall to ours."],
  },
  trade_refuse: {
    soft: ["We would gladly trade, but cannot grant this: {reason}.", "We cannot sign it as it stands, and are sorry for it: {reason}."],
    firm: ["We decline the pact. {reason}.", "No pact: {reason}."],
    hard: ["We will not sign it. {reason}.", "Our markets are not yours to bargain for. {reason}."],
  },
  trade_counter: {
    soft: ["We would gladly trade, but not on these terms: {reason}. We send others we can keep.", "Let us trade on terms both can bear: {reason}. Ours follow."],
    firm: ["We cannot sign as written: {reason}. We send terms we can keep.", "Not as written, but we will deal: {reason}. Our terms follow."],
    hard: ["Not as written. {reason}. Here is what we will sign.", "You ask too much: {reason}. These are our terms, and they are not much open to haggling."],
  },
  trade_redirect: {
    soft: ["This is not mine to decide, and I am sorry I cannot oblige you; {ask}.", "It is not for me to grant. Forgive me, and {ask}."],
    firm: ["This is not for me to answer. {ask}.", "I do not decide this. {ask}."],
    hard: ["You write to the wrong man. {ask}.", "It is not mine to give, and not yours to ask of me. {ask}."],
  },
  embargo_yield: {
    soft: ["We would not see our markets shut, and will do as you ask: {reason}.", "Let the markets stay open. We will do what you ask, for {reason}."],
    firm: ["We will do as you ask. Leave the markets open.", "Agreed. Do not shut the markets."],
    hard: ["We will do it, for our merchants' sake and not for yours.", "We yield this once. Do not think a threat will serve twice."],
  },
  embargo_protest: {
    soft: ["We protest, and regret it: {reason}. We beg you not to shut the markets.", "We cannot do as you ask, and ask you not to shut the markets over it: {reason}."],
    firm: ["We refuse. If you shut your markets, you shut them: {reason}.", "No. {reason}. The embargo will be your doing."],
    hard: ["Shut them, then. We shall not be threatened out of what is ours.", "We will not be told what to do by a closed door. {reason}."],
  },
  stall: {
    soft: ["Your letter has reached us, and we are considering it with care. We beg a little time.", "We have your letter, and need time to answer it rightly."],
    firm: ["We have received it. We will answer when we have considered.", "Your letter is before our council. Wait."],
    hard: ["We will answer when it suits us.", "Your letter will be answered in its time."],
  },
};

const REASONS: Readonly<Record<Reason, string>> = {
  not_beaten: "we are not beaten, and the war goes on",
  tired: "the war has cost us dear",
  losing: "we cannot go on",
  no_quarrel: "we have no quarrel that makes us yours",
  cannot_spare: "we have not men to spare",
  distrust: "we do not trust the terms",
  friendship: "we hold you in friendship",
  common_enemy: "we have a common enemy",
  price: "the price is too high",
  honour: "our honour does not permit it",
  weakness: "we are not in a state to",
  customs: "the customs it would give up are more than it is worth to us",
  at_war: "we are at war, and nothing crosses between us while it lasts",
  embargoed: "we have shut our markets to you, and have been given no cause to open them",
  grain: "our people cannot do without what crosses between us",
  not_mine: "it is not mine to decide",
  none: "that is our answer",
};

/** One letter, from one man, in his own voice. */
export function writeLetter(writer: Character, day: number, intent: Intent, facts: LetterFacts, subject: string, weak = false): Letter {
  const tone = toneOf(writer, day, intent, weak);
  const firmness = intent === "ultimatum" && firmnessOf(tone) === "soft" && tone !== "pleading" ? "firm" : firmnessOf(tone);
  const seed = `${writer.id}:${intent}:${facts.them}:${Math.floor(day / 30)}`;
  const withReason = { ...facts, reason: facts.reason ?? "none" };
  const body = fill(pick(BODIES[intent][firmness], `${seed}:body`).replaceAll("{reason}", REASONS[withReason.reason]), facts);
  // A stalled or evasive letter says little; a long one has an opening and a close.
  const brief = intent === "stall" || intent === "talks_accept" || intent === "aid_accept";
  const flourish = brief ? "" : flourishOf(writer, intent);
  const parts = [brief ? "" : fill(pick(OPENINGS[tone], `${seed}:open`), facts), body, flourish, brief ? "" : fill(pick(CLOSINGS[tone], `${seed}:close`), facts)].filter((part) => part !== "");
  return { subject: fill(subject, facts).slice(0, 240), body: capitalised(parts.join(" ")).slice(0, 1_190), tone };
}

