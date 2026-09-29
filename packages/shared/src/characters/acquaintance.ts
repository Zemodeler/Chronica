import { knowsAlready } from "./access";
import { currentAgeYears } from "./age";
import { beliefInWords } from "./beliefs-in-words";
import type { Office } from "./character";
import { computeOpinion, opinionLabel } from "./opinion";
import { skillsInWords, standingInWords, traitsInWords } from "./skills-in-words";
import type { SocialLink, SocialLinkKind } from "./relationship-dimensions";
import type { OrderAttempt } from "../authority/order-attempt";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * Everyone you know, and what you know of them.
 *
 * The engine keeps a per-character belief store -- claims with a kind, a
 * confidence and a source -- and a trait-observation ledger where two
 * independent observers must name a trait before it sticks. Both are written
 * by the simulation and read only by NPC cognition and an admin inspector.
 * The player got a name and a relationship label.
 *
 * This is hearsay, not truth, and the seams matter:
 *
 * - `knowsPerson` is not used. It once ended in a polity-standing hatch that
 *   made a consul acquainted with every character alive; even split, it is a
 *   station predicate. `knowsAlready` is the honest one: a relation with an
 *   actual cause, or a family link.
 *
 * - What a man is known for comes from `Character.traits`, which is public by
 *   construction: `observeTraits` only promotes a trait after two independent
 *   observers name it. The corroboration threshold does the epistemic work,
 *   so no who-said-what ledger is needed.
 *
 * - `assessExecution` is off limits entirely, not trimmed. It reads
 *   `mind.temperament.honesty` and `mind.drives`, and its "not to be left
 *   alone with money" clause fires on skimBps > 0 -- it would name a man a
 *   thief before he had stolen anything and before anyone had discovered it,
 *   which is precisely what `oversight.ts` exists to make happen slowly.
 *
 * - What they think of you is never read. `computeOpinion` in that direction
 *   is their private state. What you get instead is evidence you could
 *   actually have: public ties, how they have answered your orders.
 */

/** How you came to have heard of them at all. */
export type Acquaintance = "dealt_with" | "corresponded" | "heard_of";

export interface HearsayReading {
  /** "It is said", "You suspect", "You know" -- never a confidence. */
  readonly prefaceLabel: string;
  readonly claim: string;
  readonly fromLabel: string | null;
  readonly whenLabel: string | null;
}

export interface TieReading {
  readonly kind: SocialLinkKind;
  readonly label: string;
}

export interface PersonReading {
  readonly id: string;
  readonly name: string;
  readonly how: Acquaintance;
  /** Public by nature: anyone in the room would know these. */
  readonly officeLabel: string | null;
  readonly polityLabel: string | null;
  readonly whereLabel: string | null;
  readonly ageLabel: string | null;
  readonly standingLabel: string;
  /** What he is known for: corroborated traits only. */
  readonly knownForLabels: readonly string[];
  /** What he is said to be good at. Empty unless you have actually dealt with him. */
  readonly reputedSkillLabels: readonly string[];
  /** Your own view of him, which is yours to have. */
  readonly yourOpinionLabel: string;
  /** Ties you hold toward him, and public ties either way. */
  readonly ties: readonly TieReading[];
  /** How he has answered you. Evidence, never a score. */
  readonly towardYouLabels: readonly string[];
  readonly heard: readonly HearsayReading[];
  readonly alive: boolean;
}

const TIE_WORDS: Readonly<Record<SocialLinkKind, string>> = {
  kin: "kin of yours", spouse: "your spouse", friend: "a friend of yours",
  patron: "your patron", client: "a client of yours", rival: "a rival of yours",
  commander: "your commander", subordinate: "under your command",
  creditor: "owed money by you", debtor: "in your debt",
  ally: "an ally of yours", enemy: "an enemy of yours",
};

const ORDER_WORDS: Readonly<Record<string, string>> = {
  refused: "refused you",
  ignored: "ignored you",
  delayed: "kept you waiting",
  subverted: "did the opposite of what you asked",
  carried_out: "did as you asked",
  accepted: "took your instruction",
};

const countWord = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export interface AcquaintanceInput {
  readonly world: WorldState;
  readonly viewerId: string;
  /** People the viewer has a conversation thread with; the dialogue layer knows these, world state does not. */
  readonly conversationPartnerIds?: readonly string[] | undefined;
  readonly offices?: readonly Office[] | undefined;
  readonly clock?: ScenarioClock | undefined;
}

/**
 * Anybody the viewer has heard of, by any of three routes.
 *
 * The first two are disjoint lists in the codebase today -- world state knows
 * who you have dealings with, the dialogue layer knows who you have written
 * to, and neither consults the other. The third is what makes a man you have
 * never met appear with nothing but rumour under his name, which is the most
 * interesting entry in the list.
 */
export function peopleYouKnow(input: AcquaintanceInput): readonly PersonReading[] {
  const { world, viewerId } = input;
  const corresponded = new Set(input.conversationPartnerIds ?? []);

  const heardOf = new Set<string>();
  for (const belief of world.characterBeliefs) {
    if (belief.holderCharacterId !== viewerId || belief.status !== "active") continue;
    if (belief.subjectEntityId !== null) heardOf.add(belief.subjectEntityId);
  }
  for (const observation of world.traitObservations) {
    if (observation.observerCharacterId === viewerId) heardOf.add(observation.characterId);
  }

  const how = (id: string): Acquaintance | null => {
    if (knowsAlready(world, viewerId, id)) return "dealt_with";
    if (corresponded.has(id)) return "corresponded";
    if (heardOf.has(id)) return "heard_of";
    return null;
  };

  return world.characters
    .filter((character) => character.id !== viewerId && how(character.id) !== null)
    .map((character) => readPerson({ ...input, subjectId: character.id })!)
    .filter((reading): reading is PersonReading => reading !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readPerson(
  input: AcquaintanceInput & { readonly subjectId: string },
): PersonReading | null {
  const { world, viewerId, subjectId } = input;
  const subject = world.characters.find((character) => character.id === subjectId);
  if (subject === undefined) return null;

  const corresponded = new Set(input.conversationPartnerIds ?? []);
  const dealtWith = knowsAlready(world, viewerId, subjectId);
  const how: Acquaintance = dealtWith ? "dealt_with" : corresponded.has(subjectId) ? "corresponded" : "heard_of";

  const viewer = world.characters.find((character) => character.id === viewerId);
  const nameOf = (id: string | null): string | null =>
    id === null ? null : world.characters.find((c) => c.id === id)?.name ?? null;
  const dateOf = (step: number | null): string | null =>
    step === null ? null : input.clock === undefined ? `day ${step}` : formatWorldDate({ day: step, minute: 0 }, input.clock);

  // Public by nature. A man's office is not a thing you have to be told.
  const seat = world.material.officeSeats.find(
    (candidate) => candidate.status === "held" && candidate.holderCharacterId === subjectId,
  );
  const office = seat === undefined ? undefined : (input.offices ?? []).find((o) => o.id === seat.officeId);

  // Ties: everything the viewer holds toward them, plus anything public
  // either way. A private tie of theirs is theirs.
  const ties: TieReading[] = world.socialLinks
    .filter((link) => {
      const between = (link.subjectCharacterId === viewerId && link.targetCharacterId === subjectId)
        || (link.subjectCharacterId === subjectId && link.targetCharacterId === viewerId);
      return between && (link.visibility === "public" || link.subjectCharacterId === viewerId);
    })
    .map((link: SocialLink): TieReading => ({ kind: link.kind, label: TIE_WORDS[link.kind] }));

  // How they have answered you: your own experience, not their private state.
  const answers = new Map<string, number>();
  for (const attempt of world.orderAttempts as readonly OrderAttempt[]) {
    if (attempt.issuerRef.id !== viewerId || attempt.recipientRef.id !== subjectId) continue;
    const said = ORDER_WORDS[attempt.status];
    if (said !== undefined) answers.set(said, (answers.get(said) ?? 0) + 1);
  }
  const towardYouLabels = [...answers.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([said, n]) => `${said} ${countWord(n)}`);

  const heard: HearsayReading[] = world.characterBeliefs
    .filter((belief) => belief.holderCharacterId === viewerId && belief.status === "active" && belief.subjectEntityId === subjectId)
    .sort((a, b) => b.learnedAtStep - a.learnedAtStep)
    .map((belief) => ({
      prefaceLabel: beliefInWords(belief.kind, belief.confidence),
      claim: belief.claim,
      fromLabel: nameOf(belief.sourceCharacterId),
      whenLabel: dateOf(belief.learnedAtStep),
    }));

  return {
    id: subject.id,
    name: subject.name,
    how,
    officeLabel: office?.label ?? null,
    polityLabel: subject.polityId === null ? null : world.map.polities.find((p) => p.id === subject.polityId)?.name ?? null,
    whereLabel: world.map.provinces.find((p) => p.id === subject.locationProvinceId)?.name ?? null,
    ageLabel: `about ${currentAgeYears(subject, world.elapsedStep)}`,
    standingLabel: standingInWords(subject.prestigeBps),
    knownForLabels: traitsInWords(subject.traits),
    // Gated on having dealt with them: what a man is good at is something you
    // learn by working with him or by his reputation reaching you, not
    // something you can read off a stranger.
    reputedSkillLabels: dealtWith ? skillsInWords(subject.skills) : [],
    yourOpinionLabel: opinionLabel(viewer === undefined ? 0 : computeOpinion(viewer, subjectId)),
    ties,
    towardYouLabels,
    heard,
    alive: subject.alive,
  };
}
