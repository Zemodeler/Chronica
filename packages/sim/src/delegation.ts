import {
  aptitude,
  readDepartments,
  type StandardLever,
  bandWord,
  type SubSkill,
  type AuthorityDomain,
  type Character,
  type WorldState,
} from "@chronica/shared";

/**
 * Whose hands an order actually passes through (VISION §13).
 *
 * "NPC competence, personality, authority and corruption should affect how
 * broad orders are executed" is listed under Design Principles to Preserve,
 * and it was the largest gap left in the engine: a character's skills were
 * printed into their own cognition prompt as a line of prose and **no code
 * anywhere read them**. A corrupt quaestor and an honest one differed only in
 * whatever the model happened to do with that sentence, which meant the
 * difference survived exactly as long as the model's attention did.
 *
 * VISION's own example is two officials given "find the money for two new
 * legions": the competent one reorganises spending and negotiates manageable
 * credit, the corrupt one raids vulnerable funds and conceals the contracts.
 * Both accomplish the order. The difference is in what it cost and what it
 * left behind.
 *
 * So the split is the one the whole engine runs on. **Code owns how well it
 * goes and what it costs**: waste, delay, and what quietly goes missing, all
 * derived from canonical skills and mind. **The model owns what they actually
 * did**, told plainly what sort of workman this is so it can write the
 * difference rather than invent it.
 *
 * And what goes missing is not a special case: it lands as an ordinary
 * private fact, which is exactly what `oversight.ts` discovers and what a
 * rival can prosecute. Corruption is a story here, not a modifier.
 */

/** Which skill answers for which kind of work. */
const SKILL_FOR_DOMAIN: Readonly<Record<AuthorityDomain, keyof Character["skills"]>> = {
  fiscal: "stewardship",
  military: "martial",
  civil: "stewardship",
  diplomatic: "diplomacy",
  religious: "piety",
  judicial: "learning",
  social: "diplomacy",
};

/** The finer skill each kind of work turns on. */
const SUBSKILL_FOR_DOMAIN: Readonly<Record<AuthorityDomain, SubSkill>> = {
  fiscal: "taxation",
  military: "logistics",
  civil: "scholarship",
  diplomatic: "arbitration",
  religious: "rites",
  judicial: "scholarship",
  social: "rhetoric",
};

/** The lever whose head a kind of work answers to. */
const LEVER_FOR_DOMAIN: Readonly<Record<AuthorityDomain, StandardLever>> = {
  fiscal: "tax_roll",
  military: "supply",
  civil: "public_works_cost",
  diplomatic: "peace_talks",
  religious: "public_rites",
  judicial: "courts",
  social: "foreign_letters",
};

export const leverForDomain = (domain: AuthorityDomain): StandardLever => LEVER_FOR_DOMAIN[domain];

/** Words that say what kind of work a project is, where its kind and name say anything at all. */
const WORK_WORDS: readonly (readonly [AuthorityDomain, RegExp])[] = [
  ["religious", /\b(temple|shrine|altar|sanctuar\w*|rite|rites|sacrifice|priest\w*|oracle|festival|games|cult)\b/i],
  ["military", /\b(fort\w*|wall|walls|camp|legion\w*|fleet|ships?|warships?|quinquereme\w*|levy|siege|arsenal|garrison|muster)\b/i],
  ["fiscal", /\b(tax\w*|census|mint|coin\w*|treasury|tribute|toll|customs|loan|debt)\b/i],
  ["diplomatic", /\b(embass\w*|envoy|treaty|alliance|legation)\b/i],
  ["judicial", /\b(court|courts|law|laws|trial|code|tribunal)\b/i],
  ["social", /\b(grain dole|distribution|feast|dole|colony|colonists|settlement of veterans)\b/i],
];

/**
 * Which kind of work a project is, so the right gifts answer for it: a temple
 * is built as well as a priest can build it, a fort as a soldier can, a
 * census as a tax man can. Every project used to be civil work, so a
 * general's gifts and a pontiff's never counted for anything they built.
 */
export function domainOfWork(kind: string, label: string): AuthorityDomain {
  const said = `${kind} ${label}`.replace(/_/g, " ");
  return WORK_WORDS.find(([, words]) => words.test(said))?.[0] ?? "civil";
}

/**
 * How a particular person carries out somebody else's work.
 *
 * Nobody here is a type. Cost, time, waste and what goes missing are each a
 * smooth function of the person's own skill, seasoning, zeal, caution,
 * discipline and honesty, so no two people are the same hand: a careful man
 * with middling skill and a driven one with the same skill cost different
 * sums and take different times, and the words the prompt gets name only what
 * is actually marked in them.
 */
export interface ExecutionHand {
  readonly characterId: string;
  readonly name: string;
  /** The relevant skill, 0-100. */
  readonly competence: number;
  /** How faithfully they carry out somebody else's business, 0-100. */
  readonly fidelity: number;
  /** What an incompetent hand costs on top, in basis points. */
  readonly wasteBps: number;
  /** How much longer it takes them, in basis points. */
  readonly delayBps: number;
  /** What quietly does not arrive, in basis points. Zero for most people. */
  readonly skimBps: number;
  /** What sort of workman this is, for the prompt that has to write them. */
  readonly words: string;
}

/** Nobody is charged more than seven-tenths again, or robbed of more than a fifth. */
const MAX_WASTE_BPS = 7_000;
const MAX_DELAY_BPS = 9_000;
const MAX_SKIM_BPS = 2_000;

/** Seasoning: nothing at eighteen, all of it by about fifty-eight. */
const seasoningOf = (ageYears: number): number => Math.max(0, Math.min(1, (ageYears - 18) / 40));

/**
 * Who this particular person is as a workman, in words the prompt can use.
 *
 * Each clause appears only where that trait is marked in them, so two people
 * with the same skill read differently if their temperaments differ.
 */
function workmanInWords(competence: number, seasoning: number, zeal: number, caution: number, discipline: number, fidelity: number, skimming: boolean): string {
  const marked = [
    seasoning >= 0.6 && competence >= 55 ? "has done this many times" : seasoning <= 0.25 ? "new to this kind of work" : "",
    zeal >= 0.7 ? (competence < 55 ? "in a hurry to be seen succeeding, and it shows in the bills" : "driven, and quick") : zeal <= 0.25 ? "in no hurry about anything" : "",
    caution >= 65 ? "careful to the point of slowness" : caution <= 30 ? "inclined to rush a decision" : "",
    discipline >= 65 ? "meticulous" : discipline <= 35 ? "slapdash" : "",
    skimming ? "not to be left alone with money" : fidelity >= 75 ? "straight about it" : "",
  ].filter((part) => part !== "");
  return `${bandWord(competence)} at this kind of work${marked.length === 0 ? "" : `; ${marked.join(", ")}`}`;
}

/** Honesty and duty against the pull of wanting things. */
function fidelityOf(mind: Character["mind"]): number {
  const appetite = Math.max(mind.drives.wealth, mind.drives.status);
  return Math.max(0, Math.min(100, Math.round((mind.temperament.honesty * 0.5) + (mind.drives.duty * 0.3) + ((100 - appetite) * 0.2))));
}

export function assessExecution(world: WorldState, characterId: string, domain: AuthorityDomain): ExecutionHand | null {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined || !character.alive) return null;

  const skill = character.skills[SKILL_FOR_DOMAIN[domain]];
  if (typeof skill !== "number") return null;
  // The work's own finer skill weighs as much as the skill it belongs to: a
  // quaestor's gift for the tax roll, a legate's for feeding an army.
  // And a hand in his power's service works under whoever is in charge of
  // that kind of work: a seventh better, or worse, for the head above him.
  const lift = character.polityId === null ? 0 : readDepartments(world).headLift({ kind: "polity", id: character.polityId }, LEVER_FOR_DOMAIN[domain]);
  const competence = Math.max(0, Math.min(100, Math.round(((skill + aptitude(character, SUBSKILL_FOR_DOMAIN[domain])) / 2) * (1 + lift))));
  const mind = character.mind;

  // Fidelity is honesty and duty against the pull of wanting things. A man
  // with no appetites is faithful whatever his honesty, and a greedy honest
  // man is mostly faithful; it takes both to make a thief.
  const fidelity = fidelityOf(mind);

  // Below the middle of the range it costs more and takes longer; above it,
  // a little less. Nobody does a job for nothing by being good at it.
  const shortfall = Math.max(0, 50 - competence);
  const surplus = Math.max(0, competence - 50);
  const zeal = Math.max(0, Math.min(1, ((character.traits.includes("ambitious") ? Math.max(70, mind.drives.status) : mind.drives.status) - 30) / 60));
  const seasoning = seasoningOf(character.ageYearsAtStart + Math.floor(world.instant.day / 365));
  const { caution, discipline } = mind.temperament;
  const skilled = competence / 100;
  // Skill sets the base; what the person is like moves it, smoothly:
  //  - experience is worth most to those with the skill to use it, in time and in money;
  //  - zeal hurries the work, and a hurry without skill is paid for in waste;
  //  - caution costs time and saves money; a slapdash man wastes, a meticulous one does not;
  //  - a clumsy man's whole job goes worse, not only the part he is clumsy at.
  let wasteBps = Math.round(shortfall * 90) - Math.round(surplus * 20)
    - Math.round(seasoning * skilled * 1_400)
    + Math.round(zeal * (1 - skilled) * 3_000)
    + Math.round((50 - discipline) * 14)
    - Math.round((caution - 50) * 8);
  let delayBps = Math.round(shortfall * 110) - Math.round(surplus * 30)
    - Math.round(seasoning * skilled * 2_400)
    - Math.round(zeal * 2_200)
    + Math.round((caution - 50) * 25)
    + Math.round((50 - discipline) * 12);
  if (competence < 35) { wasteBps = Math.round(wasteBps * 1.3); delayBps = Math.round(delayBps * 1.3); }
  wasteBps = Math.min(MAX_WASTE_BPS, wasteBps);
  delayBps = Math.min(MAX_DELAY_BPS, delayBps);

  // A thief needs both the inclination and a weak enough conscience, and even
  // then takes a cut rather than the sum: a man who empties the chest is
  // caught the same week and knows it. One who is good at the work takes more:
  // he knows how to make it look like the work.
  const skimBps = fidelity >= 45 ? 0 : Math.min(MAX_SKIM_BPS, Math.round((45 - fidelity) * 40 * (0.6 + skilled * 0.9)));

  return {
    characterId,
    name: character.name,
    competence,
    fidelity,
    wasteBps: Math.max(-3_000, wasteBps),
    delayBps: Math.max(-4_500, delayBps),
    skimBps,
    words: workmanInWords(competence, seasoning, zeal, caution, discipline, fidelity, skimBps > 0),
  };
}

/** What a sum becomes in these hands: what it really costs, and what does not arrive. */
export function throughHand(amount: number, hand: ExecutionHand | null): { readonly cost: number; readonly skimmed: number } {
  if (hand === null || amount <= 0) return { cost: Math.max(0, amount), skimmed: 0 };
  const cost = Math.max(1, Math.round(amount * (1 + hand.wasteBps / 10_000)));
  return { cost, skimmed: Math.round(amount * (hand.skimBps / 10_000)) };
}

/** How long a thing takes in these hands. Never less than a day. */
export function daysInHand(days: number, hand: ExecutionHand | null): number {
  if (hand === null || days <= 0) return Math.max(0, days);
  return Math.max(1, Math.round(days * (1 + hand.delayBps / 10_000)));
}

/**
 * How this person answers an instruction somebody else has given them.
 *
 * The cognition prompt already tells everybody that refuse, delay, ignore and
 * subvert are real answers. It tells them generically, so the answer that
 * comes back is whichever one the situation makes sensible -- and an honest
 * man and a treacherous one, handed the same order by the same authority,
 * answer it identically. A temperament nobody acts differently on is
 * decoration.
 *
 * Null for the middle of the range, which is most people, and deliberately:
 * this is carried in every portrait of anybody with an order outstanding, so
 * it has to cost nothing for the ordinary case. Somebody unremarkable answers
 * as the situation suggests, which is correct.
 *
 * The nemesis gets a longer version of this in `conductInWords`, built on this
 * same line so the two cannot drift apart.
 */
export function answersAnOrder(character: Character): string | null {
  const { honesty, caution } = character.mind.temperament;
  const { duty } = character.mind.drives;

  if (honesty >= 60 || duty >= 70) {
    return 'This one refuses outright when they will not do a thing -- "order_attempt_decide" with "refuse" and the reason in their own words -- or carries it out properly. They do not take "subvert": appearing to comply and doing otherwise is not in them.';
  }
  if (honesty <= 35) {
    return 'This one takes "subvert" where refusing would cost them: they appear to comply and do otherwise. Open refusal is for when they are strong enough that it is safe.';
  }
  if (caution >= 60) {
    return 'This one delays rather than refuses where they can -- "delay", with a reason that sounds like diligence.';
  }
  return null;
}
