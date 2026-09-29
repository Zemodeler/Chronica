import { readPerson } from "./acquaintance";
import { currentAgeYears } from "./age";
import { deriveAuthoritySummary } from "./authority-projection";
import { allOffices, type Office, type ScenarioGovernmentRules } from "./character";
import { familyLinksOf, reciprocalFamilyLinkKind, type FamilyLinkKind } from "./family";
import { computeOpinion } from "./opinion";
import { skillsInWords, standingInWords, traitsInWords } from "./skills-in-words";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * The bronze mirror: who the player is now, as the world has it.
 *
 * Everything on the character sheet was read once, when the page loaded, and
 * much of it from the declaration rather than the world: the location was
 * where he stood at the opening, the key relations were the four to eight
 * people the model wrote into his file, and the office in the subtitle was the
 * one he declared. A son born to him never appeared; a senator he spent three
 * years writing to never appeared; a dead brother stayed alive in the list;
 * a consul who had laid down his office was still one.
 *
 * What does not change -- where he was born, his culture, his backstory -- is
 * still the declaration's to say. Everything that can change is read here.
 *
 * The relations obey the acquaintance rule (`acquaintance.ts`): his own view
 * of each person, and the ties he holds or that are public. What they think
 * of him is their private state and is never read.
 */

export type MirrorFamilyRole = "parent" | "partner" | "sibling" | "child" | "other_relative";

export interface MirrorRelation {
  readonly characterId: string;
  readonly name: string;
  /** "Your father", "a friend of yours", "elder brother" as declared. */
  readonly relationship: string;
  readonly notes: string;
  readonly category: "family" | "other";
  readonly familyRole: MirrorFamilyRole | null;
  readonly alive: boolean;
  /** Your own view of them, in words. Null for kin you have no feeling recorded toward. */
  readonly regard: string | null;
}

export interface MirrorMoneyChange {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly whenLabel: string;
}

export interface MirrorReading {
  readonly alive: boolean;
  readonly locationLabel: string;
  readonly polityLabel: string | null;
  readonly ageNow: number;
  /** The office he holds, or last held; null when he has never held one and the declared role stands. */
  readonly officeTitle: string | null;
  readonly currencyName: string;
  readonly moneyBalance: number;
  readonly moneyChanges: readonly MirrorMoneyChange[];
  readonly authority: readonly string[];
  readonly traits: readonly string[];
  readonly standing: string;
  readonly skills: readonly string[];
  readonly relations: readonly MirrorRelation[];
}

/** What the declaration said of someone, used only for its words: the world decides who is on the list. */
export interface DeclaredRelation {
  readonly name: string;
  readonly relationship: string;
  readonly notes: string;
}

export interface MirrorInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly government?: ScenarioGovernmentRules | undefined;
  readonly clock?: ScenarioClock | undefined;
  readonly declared?: readonly DeclaredRelation[] | undefined;
}

/** How many people outside the family the mirror lists: the ones that matter most, not everyone met. */
const OTHERS_SHOWN = 10;

const ROLE_OF: Readonly<Partial<Record<FamilyLinkKind, MirrorFamilyRole>>> = {
  parent: "parent",
  child: "child",
  sibling: "sibling",
  spouse_or_partner: "partner",
  other_relative: "other_relative",
  guardian: "other_relative",
  ward: "other_relative",
};

function kinWord(kind: FamilyLinkKind, gender: "male" | "female"): string {
  const female = gender === "female";
  switch (kind) {
    case "parent": return female ? "Your mother" : "Your father";
    case "child": return female ? "Your daughter" : "Your son";
    case "sibling": return female ? "Your sister" : "Your brother";
    case "spouse_or_partner": return female ? "Your wife" : "Your husband";
    case "guardian": return "Your guardian";
    case "ward": return "Your ward";
    default: return "A relative";
  }
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

export function readTheMirror(input: MirrorInput): MirrorReading | null {
  const { world, characterId } = input;
  const me = world.characters.find((character) => character.id === characterId);
  if (me === undefined) return null;
  const offices: readonly Office[] = input.government?.offices ?? [];
  const byName = new Map((input.declared ?? []).map((relation) => [relation.name.trim().toLowerCase(), relation]));
  const declaredFor = (name: string): DeclaredRelation | undefined => byName.get(name.trim().toLowerCase());
  const polityName = (id: string | null): string | null => (id === null ? null : world.map.polities.find((polity) => polity.id === id)?.name ?? null);

  // --- Office, held or last held ---
  // A consul also sits in the Senate, and the first seat found named him a
  // senator. A magistracy with a term outranks a seat held for life, and
  // between two of either kind the one with more powers. The office's own
  // label already says whose it is ("Roman senator").
  const officeById = new Map(allOffices(world, offices).map((office) => [office.id, office]));
  const weightOf = (officeId: string): number => {
    const office = officeById.get(officeId);
    if (office === undefined) return -1;
    return (office.termDays == null ? 0 : 1_000) + office.authorisedActionIds.length + office.sponsorableCategories.length;
  };
  const held = world.material.officeSeats
    .filter((candidate) => candidate.status === "held" && candidate.holderCharacterId === characterId && officeById.has(candidate.officeId))
    .sort((a, b) => weightOf(b.officeId) - weightOf(a.officeId))[0];
  const lastHeld = [...me.officesHeld]
    .filter((entry) => officeById.has(entry.officeId))
    .sort((a, b) => b.lastHeldAtStep - a.lastHeldAtStep || weightOf(b.officeId) - weightOf(a.officeId))[0];
  const officeTitle = held !== undefined
    ? officeById.get(held.officeId)!.label
    : lastHeld !== undefined
      ? `Formerly ${officeById.get(lastHeld.officeId)!.label}`
      : null;

  // --- Money: his own purse ---
  const account = world.material.accounts.find((candidate) => candidate.id === me.personalAccountId);
  const moneyChanges: MirrorMoneyChange[] = account === undefined ? [] : world.material.transactions
    .filter((transaction) => transaction.sourceAccountId === account.id || transaction.destinationAccountId === account.id)
    .slice(-6)
    .map((transaction) => ({
      id: transaction.id,
      label: transaction.cause.explanation,
      amount: transaction.destinationAccountId === account.id ? transaction.amount : -transaction.amount,
      whenLabel: input.clock === undefined ? `day ${transaction.atStep}` : formatWorldDate({ day: transaction.atStep, minute: 0 }, input.clock),
    }));

  // --- Family, as the family graph has it now ---
  const family: MirrorRelation[] = [];
  const kinIds = new Set<string>();
  for (const view of familyLinksOf(world, characterId)) {
    // `view.kind` is the player's own part in the link -- "parent" means he
    // is the parent -- so the relative's part is its reciprocal.
    const theirs = reciprocalFamilyLinkKind(view.kind);
    const role = ROLE_OF[theirs];
    if (role === undefined || kinIds.has(view.counterpartCharacterId)) continue;
    const kin = world.characters.find((character) => character.id === view.counterpartCharacterId);
    if (kin === undefined) continue;
    kinIds.add(kin.id);
    const declared = declaredFor(kin.name);
    const feeling = me.relations.some((relation) => relation.subjectCharacterId === kin.id && relation.causes.length > 0);
    family.push({
      characterId: kin.id,
      name: kin.name,
      relationship: declared === undefined ? kinWord(theirs, kin.gender) : capitalise(declared.relationship),
      notes: declared?.notes ?? "",
      category: "family",
      familyRole: role,
      alive: kin.alive,
      regard: feeling ? readPerson({ world, viewerId: characterId, subjectId: kin.id, offices, clock: input.clock })?.yourOpinionLabel ?? null : null,
    });
  }

  // --- Everyone else who matters to him ---
  // Anyone he holds a feeling toward with an actual cause behind it, and
  // anyone he has a tie with that he holds or that is public: the same
  // evidence `readPerson` shows in the letter tray.
  const candidates = new Set<string>();
  for (const relation of me.relations) if (relation.causes.length > 0) candidates.add(relation.subjectCharacterId);
  for (const link of world.socialLinks) {
    if (link.subjectCharacterId === characterId) candidates.add(link.targetCharacterId);
    else if (link.targetCharacterId === characterId && link.visibility === "public") candidates.add(link.subjectCharacterId);
  }
  candidates.delete(characterId);
  for (const id of kinIds) candidates.delete(id);

  const weighed = [...candidates].flatMap((id) => {
    const person = readPerson({ world, viewerId: characterId, subjectId: id, offices, clock: input.clock });
    if (person === null) return [];
    const causes = me.relations.find((relation) => relation.subjectCharacterId === id)?.causes ?? [];
    const declared = declaredFor(person.name);
    // How much has passed between them: the strength of his feeling, each
    // tie, and whether he named them himself. The most recent breaks a tie.
    const weight = Math.abs(computeOpinion(me, id)) + person.ties.length * 25 + (declared === undefined ? 0 : 40);
    const latest = causes.reduce((most, cause) => Math.max(most, cause.occurredAtStep), -1);
    const strongest = [...causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    const relation: MirrorRelation = {
      characterId: id,
      name: person.name,
      relationship: declared !== undefined
        ? capitalise(declared.relationship)
        : person.ties[0] !== undefined
          ? capitalise(person.ties[0].label)
          : person.officeLabel !== null
            // The office's own label already says whose it is ("Roman consul").
            ? person.officeLabel
            : "Someone you have dealt with",
      notes: declared?.notes ?? (strongest !== undefined && strongest.label !== declared?.relationship ? strongest.label : ""),
      category: "other",
      familyRole: null,
      alive: person.alive,
      regard: person.yourOpinionLabel,
    };
    return [{ relation, weight, latest }];
  });
  const others = weighed
    .sort((a, b) => Number(b.relation.alive) - Number(a.relation.alive) || b.weight - a.weight || b.latest - a.latest || a.relation.name.localeCompare(b.relation.name))
    .slice(0, OTHERS_SHOWN)
    .map((entry) => entry.relation);

  return {
    alive: me.alive,
    locationLabel: world.map.provinces.find((province) => province.id === me.locationProvinceId)?.name ?? "Somewhere unrecorded",
    polityLabel: polityName(me.polityId),
    ageNow: currentAgeYears(me, world.elapsedStep),
    officeTitle,
    currencyName: world.material.currency.name,
    moneyBalance: account?.balance ?? 0,
    moneyChanges,
    authority: deriveAuthoritySummary(world, characterId, input.government),
    traits: traitsInWords(me.traits),
    standing: standingInWords(me.prestigeBps),
    skills: skillsInWords(me.skills),
    relations: [...family, ...others],
  };
}
