import {
  boundedId,
  childrenOf,
  createCanonicalNpc,
  currentAgeYears,
  DAYS_PER_YEAR,
  familyLinksOf,
  stableHash,
  type Character,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";

/**
 * Children, born to the couples the world already records.
 *
 * Every other way into `world.characters` is somebody needing a person: an
 * order, an answer, the narrator. Nobody was ever simply born, so a house with
 * no son stayed without one for ever, primogeniture found no heir, and the
 * population only grew where history had asked for a man by name.
 *
 * A birth needs a wife and a husband, both living, married by a
 * `spouse_or_partner` tie, and in the same province -- a consul three years on
 * campaign fathers nobody at home. The mother's age sets the rate. Rolled at
 * her own life review and hashed on it, for the reason `mortality.ts` gives:
 * a replay that lands its hops differently must still be the same world.
 *
 * The rates are the engine's, not the scenario's. Mortality varies with a
 * world's medicine and its wars; how often a married woman of twenty-five bore
 * a child did not vary much between Rome and Carthage, and a rule kept in the
 * scenario would reach only games begun after it was written.
 */

/** A year's chance of a birth, by the mother's age, in basis points. Natural fertility before contraception, trimmed for the years lost to nursing. */
const FERTILITY_BY_AGE: readonly { readonly from: number; readonly to: number; readonly perYearBps: number }[] = [
  { from: 15, to: 19, perYearBps: 3_000 },
  { from: 20, to: 29, perYearBps: 4_000 },
  { from: 30, to: 34, perYearBps: 3_500 },
  { from: 35, to: 39, perYearBps: 2_500 },
  { from: 40, to: 44, perYearBps: 1_000 },
];

/** Nine months carrying and most of a year nursing: no mother bears twice inside this. */
export const MIN_DAYS_BETWEEN_BIRTHS = 450;

/** What a birth costs the mother, per birth, in basis points. The commonest way a young woman died. */
export const CHILDBED_MORTALITY_BPS = 150;

export interface Birth {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  readonly childId: string;
}

/** The day a person was born, whether they were born in play or before it opened. */
function bornAtStep(character: Pick<Character, "ageYearsAtStart" | "birthStep">): number {
  return character.birthStep ?? -character.ageYearsAtStart * DAYS_PER_YEAR;
}

/** Her living husband, if she has one and he is where she is. */
export function husbandAtHand(world: WorldState, mother: Character, atStep: number): Character | undefined {
  return familyLinksOf(world, mother.id, atStep)
    .filter((view) => view.kind === "spouse_or_partner")
    .map((view) => world.characters.find((character) => character.id === view.counterpartCharacterId))
    .find((spouse): spouse is Character => spouse !== undefined
      && spouse.alive
      && spouse.gender === "male"
      && spouse.locationProvinceId === mother.locationProvinceId
      && !spouse.disqualifyingStatuses.includes("captured"));
}

/** Her chance of a birth this review, on the million-point scale the life rolls use. Zero where she cannot. */
export function birthChance(world: WorldState, mother: Character, atStep: number, reviewDays: number): number {
  if (!mother.alive || mother.gender !== "female") return 0;
  if (mother.disqualifyingStatuses.includes("captured") || mother.disqualifyingStatuses.includes("incapacitated")) return 0;
  const age = currentAgeYears(mother, atStep);
  const band = FERTILITY_BY_AGE.find((candidate) => age >= candidate.from && age <= candidate.to);
  if (band === undefined) return 0;
  if (husbandAtHand(world, mother, atStep) === undefined) return 0;
  const youngest = childrenOf(world, mother.id)
    .map((id) => world.characters.find((character) => character.id === id))
    .filter((child): child is Character => child !== undefined)
    .reduce((latest, child) => Math.max(latest, bornAtStep(child)), Number.NEGATIVE_INFINITY);
  if (atStep - youngest < MIN_DAYS_BETWEEN_BIRTHS) return 0;
  return Math.round(band.perYearBps * (reviewDays / 365) * 100);
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

/**
 * What the child is called, from the father's name.
 *
 * The scenario's name pools belong to dialogue and never reach the tick. The
 * eldest son taking his father's name was the Roman habit and common among
 * the Greeks; everybody after him is known, until somebody names them better,
 * as whose child they are.
 */
function nameFor(world: WorldState, father: Character, gender: Character["gender"]): string {
  const siblings = childrenOf(world, father.id)
    .map((id) => world.characters.find((character) => character.id === id))
    .filter((child): child is Character => child !== undefined && child.gender === gender);
  const name = gender === "male" && siblings.length === 0
    ? `${father.name} the Younger`
    : `${ORDINALS[siblings.length] ?? `${siblings.length + 1}th`} ${gender === "male" ? "son" : "daughter"} of ${father.name}`;
  return name.slice(0, 120);
}

/**
 * A child, born today to this mother and her husband.
 *
 * The child belongs to the father's power and house, lives where the mother
 * does, and starts with the average of the parents' gifts and a third of the
 * father's standing -- enough that a king's son is somebody, not enough that
 * every infant's fever is foreshadowed. Both parents are recorded as parents,
 * which is what primogeniture reads.
 *
 * The child's id is the mother's and the day's, not the next off a counter:
 * once the great houses had wives (L10) children were born in every long
 * span, and a counter's id differed with how the span was cut into hops -- a
 * world that replays differently is not one to trust (`mortality.test.ts`).
 * A mother bears at most once inside `MIN_DAYS_BETWEEN_BIRTHS`, so it is unique.
 */
export function bearChild(
  world: WorldState,
  mother: Character,
  atStep: number,
  isSignificant: (character: Character) => boolean,
): Birth | null {
  const father = husbandAtHand(world, mother, atStep);
  if (father === undefined) return null;
  const gender: Character["gender"] = stableHash([mother.id, atStep, "birth", "sex"]) % 2 === 0 ? "male" : "female";
  const average = (a: number, b: number): number => Math.round((a + b) / 2);
  const childId = boundedId("child", mother.id, atStep);
  const created = createCanonicalNpc(world, {
    characterId: childId,
    name: nameFor(world, father, gender),
    locationProvinceId: mother.locationProvinceId,
    polityId: father.polityId ?? mother.polityId,
    createdAtStep: atStep,
    creationReason: `Born to ${mother.name} and ${father.name}.`,
    ageYearsAtStart: 0,
    startingMoney: 0,
    gender,
    cultureId: father.cultureId,
    faithId: father.faithId,
    dynastyId: father.dynastyId,
    prestigeBps: Math.round(father.prestigeBps / 3),
    skills: {
      martial: average(father.skills.martial, mother.skills.martial),
      intrigue: average(father.skills.intrigue, mother.skills.intrigue),
      learning: average(father.skills.learning, mother.skills.learning),
      piety: average(father.skills.piety, mother.skills.piety),
      stewardship: average(father.skills.stewardship, mother.skills.stewardship),
      diplomacy: average(father.skills.diplomacy, mother.skills.diplomacy),
      body: average(father.skills.body, mother.skills.body),
      subSkills: {},
    },
  });
  if (created === null) return null;

  const parentLink = (parentId: string, suffix: string): WorldState["familyLinks"][number] => ({
    id: `family-${childId}-${suffix}`,
    characterId: parentId,
    relatedCharacterId: childId,
    kind: "parent",
    startedAtStep: atStep,
    endedAtStep: null,
    visibility: "public",
    provenanceEventId: null,
  });
  const next: WorldState = {
    ...created.world,
    familyLinks: [...created.world.familyLinks, parentLink(mother.id, "mother"), parentLink(father.id, "father")],
  };

  // A great house's heir is the whole world's news; a farmer's daughter is her
  // own people's. Polity visibility reaches only powers named in the refs, so
  // the power is named.
  const notable = isSignificant(father) || isSignificant(mother);
  const polityId = father.polityId ?? mother.polityId;
  return {
    world: next,
    childId,
    facts: [{
      localId: `birth_${childId}`,
      kind: "birth",
      summary: `${mother.name} has given ${father.name} a ${gender === "male" ? "son" : "daughter"}, ${created.character.name}.`,
      affectedRefs: [
        { kind: "character", id: childId },
        { kind: "character", id: mother.id },
        { kind: "character", id: father.id },
        ...(polityId === null ? [] : [{ kind: "polity" as const, id: polityId }]),
      ],
      visibility: notable ? "public" : "polity",
      discoveryState: notable ? "public" : "polity",
      knowableInDays: 0,
      significance: notable ? 60 : 25,
    }],
  };
}
