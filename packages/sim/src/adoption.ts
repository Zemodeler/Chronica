import {
  adoptedRomanName,
  allianceBetween,
  boundedId,
  currentAgeYears,
  familyLinksOf,
  gensById,
  ordoOfRomanName,
  parseRomanName,
  stableHash,
  type Character,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";

/**
 * A Roman adopts a son.
 *
 * Adoption was how a house without a son kept its name, its rites and its images. The adoptee took the adopter's praenomen, nomen and
 * cognomen and kept his old nomen as an -ianus cognomen: Publius Cornelius Scipio Aemilianus was born an Aemilius. He entered the gens
 * with its sacra and its imagines, and he inherited as a son. A man still under his father's power was adopted (adoptio) with his father's
 * consent; a man his own master was adrogated (adrogatio), which the pontifices inquired into and the assembly of the curiae approved.
 *
 * What this models, by rule and not by vote:
 *
 * - the adopter is a man of Rome, grown, with no living son of his own, and at least eighteen years older than the adoptee (the
 *   pontifices asked that an adopter be too old to have a son of his own; Gellius 5.19);
 * - the adoptee is a free man of Rome, and of the adopter's order: a patrician gens takes a patrician, a plebeian gens a plebeian. The
 *   road from the plebs to the patriciate by adoption is not open in this age, and a patrician does not go over to the plebs by it;
 * - a man whose father lives needs him to give him up, which he will not do for a man he hates;
 * - an adrogation needs a pontiff alive to inquire into it, where the world has pontiffs at all (the competence layer's say over the
 *   assembly is not asked: this is the pontifical gate by rule).
 *
 * The family graph, the social link and the contract of adoption are the same ones the merchant firms' succession writes
 * (`house-succession.ts`), so both read the same way in the inspector.
 */

/** The most years by which the adopter must be older than the adoptee. */
export const ADOPTER_AT_LEAST_YEARS_OLDER = 18;
/** The youngest an adopted son may be and the youngest an adopter. */
export const ADOPTEE_MIN_AGE = 14;
export const ADOPTER_MIN_AGE = 32;

const living = (world: WorldState, id: string): Character | undefined => world.characters.find((character) => character.id === id && character.alive);

/** The sons a man has living, adopted or born. */
export function livingSons(world: WorldState, parent: Character): Character[] {
  return familyLinksOf(world, parent.id, world.elapsedStep)
    .filter((view) => view.kind === "parent")
    .map((view) => living(world, view.counterpartCharacterId))
    .filter((child): child is Character => child !== undefined && child.gender === "male");
}

const pontiffAlive = (world: WorldState): boolean => {
  const anyPontiffOffice = world.material.officeSeats.some((seat) => /pontif/i.test(seat.officeId));
  if (!anyPontiffOffice) return true;
  return world.material.officeSeats.some((seat) => /pontif/i.test(seat.officeId) && seat.status === "held" && seat.holderCharacterId !== null && living(world, seat.holderCharacterId) !== undefined);
};

/** Why the adoption cannot be made, in plain words; null where it may. */
export function adoptionBar(world: WorldState, adopter: Character, adoptee: Character, atStep: number): string | null {
  if (!adopter.alive || !adoptee.alive) return "one of them is dead";
  const roman = parseRomanName(adopter.name);
  const adopterNomen = adopter.nomen ?? roman.nomen;
  if (adopterNomen === null || adopterNomen === undefined) return `${adopter.name} has no gens to give`;
  if (adopter.gender !== "male" || adoptee.gender !== "male") return "only a man adopts a son, and only a son is adopted";
  if (adoptee.legalStatus !== "free" || adopter.legalStatus !== "free") return "only a free man adopts or is adopted";
  if (adoptee.dynastyId === adopter.dynastyId && adopter.dynastyId !== null) return `${adoptee.name} is of the gens already`;
  const adopterAge = currentAgeYears(adopter, atStep);
  const adopteeAge = currentAgeYears(adoptee, atStep);
  if (adopterAge < ADOPTER_MIN_AGE) return `${adopter.name} is too young to adopt`;
  if (adopteeAge < ADOPTEE_MIN_AGE) return `${adoptee.name} is too young to be adopted`;
  if (adopterAge - adopteeAge < ADOPTER_AT_LEAST_YEARS_OLDER) return `${adopter.name} is less than ${ADOPTER_AT_LEAST_YEARS_OLDER} years older than ${adoptee.name}: he could have been his father by birth only if the pontifices allowed it, and they do not`;
  const order = adopter.ordo ?? ordoOfRomanName(adopter.name);
  const adopteeOrder = adoptee.ordo ?? ordoOfRomanName(adoptee.name);
  if (order !== adopteeOrder) {
    return order === "patrician"
      ? `a patrician gens does not take a plebeian: the road from the plebs to the patriciate by adoption is not open`
      : `a plebeian gens does not take a patrician: a patrician does not go over to the plebs by adoption`;
  }
  if (livingSons(world, adopter).length > 0) return `${adopter.name} has a son of his own`;
  const father = familyLinksOf(world, adoptee.id, atStep)
    .filter((view) => view.kind === "child")
    .map((view) => living(world, view.counterpartCharacterId))
    .find((parent): parent is Character => parent !== undefined && parent.gender === "male");
  if (father !== undefined) {
    const feeling = father.relations.find((relation) => relation.subjectCharacterId === adopter.id)?.causes.reduce((sum, cause) => sum + cause.score, 0) ?? 0;
    if (feeling < -10) return `${father.name} will not give his son to ${adopter.name}`;
  } else if (!pontiffAlive(world)) return "there is no pontiff to inquire into an adrogation";
  return null;
}

export interface Adopted {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  readonly adopteeName: string;
}

/**
 * Adopt `adoptee` as `adopter`'s son, if it may be done; returns null with the reason in `bar` otherwise.
 * Writes the new name and its parts, the gens, the order, the family and social links, the contract, the heir; the
 * estate follows by `settleEstate` as the heir's. The old tie of blood to his natural father is ended as a tie of inheritance, kept as kinship.
 */
export function adoptIntoGens(world: WorldState, adopterId: string, adopteeId: string, atStep: number): Adopted | { readonly bar: string } {
  const adopter = world.characters.find((character) => character.id === adopterId);
  const adoptee = world.characters.find((character) => character.id === adopteeId);
  if (adopter === undefined || adoptee === undefined) return { bar: "somebody is not in the world" };
  const bar = adoptionBar(world, adopter, adoptee, atStep);
  if (bar !== null) return { bar };

  const adopterParts = parseRomanName(adopter.name);
  const oldParts = parseRomanName(adoptee.name);
  const name = adoptedRomanName(
    { praenomen: adopter.praenomen ?? adopterParts.praenomen, nomen: adopter.nomen ?? adopterParts.nomen, cognomen: adopter.cognomen ?? adopterParts.cognomen },
    { praenomen: adoptee.praenomen ?? oldParts.praenomen, nomen: adoptee.nomen ?? oldParts.nomen, cognomen: adoptee.cognomen ?? oldParts.cognomen },
    adoptee.name,
  );
  const taken = new Set(world.characters.filter((character) => character.id !== adoptee.id).map((character) => character.name));
  const finalName = taken.has(name) ? adoptee.name : name;
  const reparsed = parseRomanName(finalName);
  const naturalFathers = familyLinksOf(world, adoptee.id, atStep).filter((view) => view.kind === "child").map((view) => view.link.id);
  const naturalFatherIds = familyLinksOf(world, adoptee.id, atStep).filter((view) => view.kind === "child").map((view) => view.counterpartCharacterId);

  const next: WorldState = {
    ...world,
    characters: world.characters.map((character) => {
      if (character.id === adopter.id) return { ...character, heirCharacterId: adoptee.id };
      if (character.id !== adoptee.id) return character;
      return {
        ...character, name: finalName, dynastyId: adopter.dynastyId ?? character.dynastyId, ordo: adopter.ordo ?? character.ordo,
        polityId: adopter.polityId ?? character.polityId,
        ...(reparsed.praenomen === null ? {} : { praenomen: reparsed.praenomen }),
        ...(reparsed.nomen === null ? {} : { nomen: reparsed.nomen }),
        ...(reparsed.cognomen === null ? {} : { cognomen: reparsed.cognomen }),
      };
    }),
    // His birth's tie to the man who fathered him no longer carries the estate; it stays as kinship.
    familyLinks: [
      ...world.familyLinks.map((link) => (naturalFathers.includes(link.id) && link.endedAtStep === null ? { ...link, endedAtStep: atStep } : link)),
      ...naturalFatherIds.map((fatherId) => ({
        id: boundedId("family", fatherId, "birth-father-of", adoptee.id), characterId: fatherId, relatedCharacterId: adoptee.id, kind: "other_relative" as const,
        startedAtStep: atStep, endedAtStep: null, visibility: "public" as const, provenanceEventId: null,
      })),
      {
        id: boundedId("family", adoptee.id, "adopted-by", adopter.id), characterId: adopter.id, relatedCharacterId: adoptee.id, kind: "parent" as const,
        startedAtStep: atStep, endedAtStep: null, visibility: "public" as const, provenanceEventId: null,
      },
    ],
    socialLinks: [...world.socialLinks, {
      id: boundedId("social", adopter.id, "kin", adoptee.id, atStep), subjectCharacterId: adopter.id, targetCharacterId: adoptee.id, kind: "kin" as const,
      sourceEventId: null, createdAtStep: atStep, visibility: "public" as const,
    }],
    lifeContracts: [...world.lifeContracts, {
      id: boundedId("adoption", adopter.id, adoptee.id, atStep), type: "adoption_or_heir_designation" as const, partyCharacterIds: [adopter.id, adoptee.id], institutionId: null,
      eligibilityRequirementIds: [], status: "active" as const, visibility: "public" as const, startedAtStep: atStep, endedAtStep: null, sourceEventId: null,
      resolutionReason: `${adopter.name} adopts ${finalName} to carry his name, his rites and his images.`.slice(0, 400),
    }],
  };
  const gens = gensById(next, adopter.dynastyId);
  return {
    world: next,
    adopteeName: finalName,
    facts: [{
      localId: `adoption_${adopter.id}_${adoptee.id}`.slice(0, 60), kind: "adoption",
      summary: `${adopter.name} has adopted ${adoptee.name}, who is now ${finalName}${gens === undefined ? "" : ` of ${gens.plural}`}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: adopter.id }, { kind: "character", id: adoptee.id }, ...(adopter.polityId === null ? [] : [{ kind: "polity" as const, id: adopter.polityId }])],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
    }],
  };
}

/** How often, in a hundred, a gens's childless first man adopts in a year (the rate of rare things). */
export const ADOPTION_PER_YEAR_PERCENT = 12;

/**
 * Without a son, a first man of a gens looks about for one, as the Romans did: a young man of a gens his own is tied to by marriage
 * (a nephew by his wife's side, a sister's son), of his own order and the right age gap, is adopted into the name; failing that he names
 * a young kinsman of his own gens his heir. Once a year and rarely (`ADOPTION_PER_YEAR_PERCENT`). Returns the world unchanged where he does not.
 */
export function aGensKeepsItsName(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const year = Math.floor(toDay / 365);
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const gens of world.gentes) {
    if (gens.princepsId === null || gens.kind !== "noble" || gens.polityId !== "rome") continue;
    const head = living(next, gens.princepsId);
    if (head === undefined || currentAgeYears(head, toDay) < 45 || livingSons(next, head).length > 0) continue;
    if (stableHash([gens.id, head.id, year, "adopts"]) % 100 >= ADOPTION_PER_YEAR_PERCENT) continue;
    const tied = next.characters
      .filter((character) => character.alive && character.gender === "male" && character.dynastyId !== null && character.dynastyId !== gens.id && character.polityId === head.polityId
        && allianceBetween(next, gens.id, character.dynastyId) > 0 && adoptionBar(next, head, character, toDay) === null)
      .sort((x, y) => allianceBetween(next, gens.id, y.dynastyId) - allianceBetween(next, gens.id, x.dynastyId) || y.prestigeBps - x.prestigeBps || x.id.localeCompare(y.id));
    const chosen = tied[0];
    if (chosen !== undefined) {
      const done = adoptIntoGens(next, head.id, chosen.id, toDay);
      if ("bar" in done) continue;
      next = done.world;
      facts.push(...done.facts);
      continue;
    }
    const own = next.characters
      .filter((character) => character.alive && character.gender === "male" && character.dynastyId === gens.id && character.id !== head.id && currentAgeYears(character, toDay) >= ADOPTEE_MIN_AGE)
      .sort((x, y) => y.prestigeBps - x.prestigeBps || x.id.localeCompare(y.id))[0];
    if (own === undefined || head.heirCharacterId === own.id) continue;
    next = { ...next, characters: next.characters.map((character) => (character.id === head.id ? { ...character, heirCharacterId: own.id } : character)) };
    facts.push({
      localId: `heir_${head.id}_${year}`.slice(0, 60), kind: "heir_named",
      summary: `${head.name}, having no son, names ${own.name} of his own gens his heir.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: head.id }, { kind: "character", id: own.id }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
    });
  }
  return { world: next, facts };
}
