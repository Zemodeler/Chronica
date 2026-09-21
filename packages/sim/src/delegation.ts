import {
  bandWord,
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

/** Nobody is charged more than half again, or robbed of more than a fifth. */
const MAX_WASTE_BPS = 5_000;
const MAX_DELAY_BPS = 6_000;
const MAX_SKIM_BPS = 2_000;

export function assessExecution(world: WorldState, characterId: string, domain: AuthorityDomain): ExecutionHand | null {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined || !character.alive) return null;

  const competence = character.skills[SKILL_FOR_DOMAIN[domain]];
  if (typeof competence !== "number") return null;
  const mind = character.mind;

  // Fidelity is honesty and duty against the pull of wanting things. A man
  // with no appetites is faithful whatever his honesty, and a greedy honest
  // man is mostly faithful; it takes both to make a thief.
  const appetite = Math.max(mind.drives.wealth, mind.drives.status);
  const fidelity = Math.max(0, Math.min(100,
    Math.round((mind.temperament.honesty * 0.5) + (mind.drives.duty * 0.3) + ((100 - appetite) * 0.2)),
  ));

  // Below the middle of the range it costs more and takes longer; above it,
  // a little less. Nobody does a job for nothing by being good at it.
  const shortfall = Math.max(0, 50 - competence);
  const surplus = Math.max(0, competence - 50);
  const wasteBps = Math.min(MAX_WASTE_BPS, Math.round(shortfall * 90) - Math.round(surplus * 20));
  const delayBps = Math.min(MAX_DELAY_BPS, Math.round(shortfall * 110) - Math.round(surplus * 30));

  // A thief needs both the inclination and a weak enough conscience, and even
  // then takes a cut rather than the sum: a man who empties the chest is
  // caught the same week and knows it.
  const skimBps = fidelity >= 45 ? 0 : Math.min(MAX_SKIM_BPS, Math.round((45 - fidelity) * 40));

  const care = mind.temperament.discipline >= 65 ? "meticulous" : mind.temperament.discipline <= 35 ? "slapdash" : "workmanlike";
  const honestyWord = skimBps > 0 ? ", and not to be left alone with money" : fidelity >= 75 ? ", and straight about it" : "";
  return {
    characterId,
    name: character.name,
    competence,
    fidelity,
    wasteBps: Math.max(-2_000, wasteBps),
    delayBps: Math.max(-3_000, delayBps),
    skimBps,
    words: `${bandWord(competence)} at this kind of work and ${care} about it${honestyWord}`,
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
