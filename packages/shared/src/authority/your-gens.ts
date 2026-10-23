import { currentAgeYears } from "../characters/age";
import { gensById, nobilitasOf, type Gens } from "../world/gentes";
import type { WorldState } from "../world/world-state";

/**
 * The player's own gens, as he may read it: its name and weight, whether he is a noble or a new man, the images in its atrium, the rites
 * it keeps, its living members, its friends by marriage and its enemies. In the words of the age and no figures a Roman would not have had:
 * "great", "of some weight"; "three of your branch have sat in the consul's chair".
 *
 * Everything here is public in the city (a gens's honours and its feuds were the talk of the forum), so there is nothing to withhold;
 * a man with no gens (a stranger, a slave) has none.
 */

export interface GensMember {
  readonly name: string;
  /** "the first man of the gens", "your son", "his wife"; null where there is nothing to say. */
  readonly note: string | null;
  readonly age: number;
  readonly you: boolean;
}

export interface GensReading {
  /** "the Cornelii". */
  readonly name: string;
  /** "A patrician gens", "A plebeian gens", "A royal house", "A great house of Carthage". */
  readonly kindLabel: string;
  /** Who he is in it: "You are Gnaeus Cornelius Blasio, of the Blasiones." */
  readonly you: string;
  /** What his name is worth: a noble, of a gens with consuls, or a new man. */
  readonly nobilitas: { readonly label: string; readonly sentence: string };
  /** Its weight in a sentence. */
  readonly weight: string;
  /** What he himself has held of the curule chairs, in a sentence; null where none. */
  readonly yourHonours: string | null;
  /** "Twelve of your name have an image in the atrium." Null where none. */
  readonly imagines: string | null;
  /** The head of the gens. */
  readonly head: { readonly name: string; readonly you: boolean } | null;
  readonly sacra: readonly string[];
  readonly sacraKeeper: string | null;
  readonly tomb: string | null;
  readonly members: readonly GensMember[];
  readonly clients: string | null;
  readonly feuds: readonly { readonly against: string; readonly why: string; readonly heat: string }[];
  readonly alliances: readonly { readonly with: string; readonly how: string; readonly strength: string }[];
  /** The last few honours, newest first: "Consul in 275: Lucius Cornelius Lentulus Caudinus". */
  readonly honours: readonly string[];
}

const NUMBER_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const wordOf = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

/** A branch's name in the plural, as the Romans said it: the Scipiones, the Maximi, the Pictores, the Caninae. */
export function pluralOfCognomen(cognomen: string): string {
  if (cognomen.endsWith("us")) return `${cognomen.slice(0, -2)}i`;
  if (cognomen.endsWith("o")) return `${cognomen}nes`;
  if (cognomen.endsWith("or") || cognomen.endsWith("er")) return `${cognomen}es`;
  if (cognomen.endsWith("a")) return `${cognomen.slice(0, -1)}ae`;
  return `${cognomen}es`;
}

/** How heavy a gens's name is, as the forum would say it. */
export function weightInWords(dignitasBps: number): string {
  if (dignitasBps >= 7_000) return "Its name is among the greatest in the city.";
  if (dignitasBps >= 4_500) return "Its name carries weight in the Senate.";
  if (dignitasBps >= 2_500) return "Its name is known, but is not one of the great ones.";
  return "Its name counts for little yet.";
}

const heatInWords = (intensityBps: number): string => (intensityBps >= 6_000 ? "bitter" : intensityBps >= 3_000 ? "deep" : "old and cooling");
const strengthInWords = (strengthBps: number): string => (strengthBps >= 7_000 ? "close" : strengthBps >= 4_000 ? "firm" : "fading");

function kindLabelOf(gens: Gens): string {
  if (gens.kind === "royal") return "A royal house";
  if (gens.polityId === "rome") return gens.ordo === "plebeian" ? "A plebeian gens" : "A patrician gens";
  return "A great house";
}

/** The reading for a character, or null where he is of no gens. */
export function readYourGens(world: Pick<WorldState, "characters" | "gentes" | "familyLinks" | "socialLinks" | "elapsedStep">, characterId: string): GensReading | null {
  const self = world.characters.find((character) => character.id === characterId);
  if (self === undefined || self.dynastyId === null) return null;
  const gens = gensById(world, self.dynastyId);
  if (gens === undefined) return null;
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const nobilitas = nobilitasOf(world, self);
  const roman = gens.polityId === "rome" && gens.kind === "noble";

  const branch = nobilitas.stirps === null ? "" : `, of the branch of the ${pluralOfCognomen(nobilitas.stirps)}`;
  const you = `You are ${self.name} of ${gens.plural}${roman ? branch : ""}.`;

  const consulsOf = (count: number): string => (count === 1 ? "once" : `${wordOf(count)} times`);
  let label: string;
  let sentence: string;
  if (!roman) {
    label = gens.kind === "royal" ? "Of the royal house" : "Of a great house";
    sentence = gens.kind === "royal" ? "You are of the house that rules, and your name is your claim." : "Your family is one of the great families of your city, and its name is your standing.";
  } else if (nobilitas.tier === "nobilis") {
    label = "A noble";
    sentence = `Your own branch has sat in the consul's chair ${consulsOf(nobilitas.inStirps)} before you, and your gens ${gens.honours.filter((honour) => honour.kind === "consul").length === 1 ? "once" : `${wordOf(gens.honours.filter((honour) => honour.kind === "consul").length)} times`}. The electors will think of you for it.`;
  } else if (nobilitas.tier === "gentilis") {
    label = "Of a noble gens";
    sentence = `Your gens has had consuls (${wordOf(nobilitas.inGens)}), though none of your own branch before you. It helps with the electors, but less than a consul among your own fathers would.`;
  } else {
    label = "A new man";
    sentence = nobilitas.own > 0
      ? "Nobody of your name sat in the consul's chair before you. You are the first of it, and your sons will be nobles."
      : "Nobody of your name has sat in the consul's chair. You stand on your own deeds, and the electors know it.";
  }

  const head = gens.princepsId === null ? undefined : byId.get(gens.princepsId);
  const sinceOpening = world.elapsedStep;
  const living = world.characters.filter((character) => character.dynastyId === gens.id && character.alive);
  const kinOfYou = new Map<string, string>();
  for (const link of world.familyLinks) {
    if (link.endedAtStep !== null) continue;
    const other = link.characterId === characterId ? link.relatedCharacterId : link.relatedCharacterId === characterId ? link.characterId : null;
    if (other === null) continue;
    const otherCharacter = byId.get(other);
    if (otherCharacter === undefined) continue;
    const mine = link.characterId === characterId;
    const label2 = link.kind === "spouse_or_partner" ? (otherCharacter.gender === "female" ? "your wife" : "your husband")
      : link.kind === "parent" ? (mine ? (otherCharacter.gender === "female" ? "your daughter" : "your son") : (otherCharacter.gender === "female" ? "your mother" : "your father"))
        : link.kind === "sibling" ? (otherCharacter.gender === "female" ? "your sister" : "your brother") : null;
    if (label2 !== null) kinOfYou.set(other, label2);
  }
  // His wife (or husband) is of another gens and keeps it, but she is of his household and is written beside the rest.
  const spouses = world.characters.filter((character) => character.alive && character.dynastyId !== gens.id && (kinOfYou.get(character.id) === "your wife" || kinOfYou.get(character.id) === "your husband"));
  const members: GensMember[] = [...living, ...spouses]
    .map((character) => ({ character, rank: character.id === characterId ? 0 : character.id === gens.princepsId ? 1 : kinOfYou.has(character.id) ? 2 : 3 }))
    .sort((a, b) => a.rank - b.rank || b.character.prestigeBps - a.character.prestigeBps || a.character.id.localeCompare(b.character.id))
    .slice(0, 14)
    .map(({ character }) => ({
      name: character.name,
      note: character.id === characterId ? "you" : character.id === gens.princepsId ? "the first man of the gens" : kinOfYou.get(character.id) ?? null,
      age: currentAgeYears(character, sinceOpening),
      you: character.id === characterId,
    }));

  const yourConsulships = gens.honours.filter((honour) => honour.characterId === characterId);
  const yourHonours = yourConsulships.length === 0 ? null
    : `You have been ${yourConsulships.map((honour) => `${honour.kind === "consul" ? "consul" : honour.kind === "censor" ? "censor" : "dictator"}`).join(" and ")}.`;
  const clientsCount = world.socialLinks.filter((link) => link.kind === "client" && living.some((member) => member.id === link.subjectCharacterId)).length
    + world.socialLinks.filter((link) => link.kind === "patron" && living.some((member) => member.id === link.targetCharacterId)).length;

  return {
    name: gens.plural,
    kindLabel: kindLabelOf(gens),
    you,
    nobilitas: { label, sentence },
    weight: weightInWords(gens.dignitasBps),
    yourHonours,
    imagines: gens.imagines === 0 ? null : `${upper(wordOf(gens.imagines))} of your name ${gens.imagines === 1 ? "has" : "have"} an image in the atrium.`,
    head: head === undefined ? null : { name: head.name, you: head.id === characterId },
    sacra: gens.sacra,
    sacraKeeper: gens.sacraKeeperId === null ? null : byId.get(gens.sacraKeeperId)?.name ?? null,
    tomb: gens.tomb,
    members,
    clients: clientsCount === 0 ? null : clientsCount === 1 ? "One client looks to your gens." : `${upper(wordOf(clientsCount))} clients look to your gens.`,
    feuds: gens.feuds.slice().sort((a, b) => b.intensityBps - a.intensityBps).map((feud) => ({ against: gensById(world, feud.againstGensId)?.plural ?? "another gens", why: feud.reason, heat: heatInWords(feud.intensityBps) })),
    alliances: gens.alliances.slice().sort((a, b) => b.strengthBps - a.strengthBps).map((alliance) => {
      const groom = byId.get(alliance.groomId)?.name;
      const bride = byId.get(alliance.brideId)?.name;
      return { with: gensById(world, alliance.withGensId)?.plural ?? "another gens", how: groom !== undefined && bride !== undefined ? `by the marriage of ${groom} and ${bride}` : "by marriage", strength: strengthInWords(alliance.strengthBps) };
    }),
    honours: gens.honours.slice(-5).reverse().map((honour) => {
      const yearsAgo = Math.max(0, Math.round((sinceOpening - honour.atStep) / 365));
      return `${upper(honour.kind)}, ${yearsAgo === 0 ? "this year" : yearsAgo === 1 ? "a year ago" : `${wordOf(yearsAgo)} years ago`}: ${honour.who}`;
    }),
  };
}
