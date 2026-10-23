import {
  DoctrineSchema,
  boundedId,
  formationTemplateOf,
  lineForCategory,
  type Doctrine,
  type DoctrineEffect,
  type Force,
  type FormationLine,
  type WorldState,
} from "@chronica/shared";

/**
 * A hired band is its own people's (docs/plans/playtest-fixes.md, "Defection gaps closed").
 *
 * A company a contract raises (`service_contract_open` with `company`) was a row of men under the employer's power, and `formArmies` drew it up by the employer's
 * establishment: a hired Gaulish company came out as "Legio II (hastati, principes, triarii)", because the Roman establishment's default body takes any infantry it
 * has no other word for. A mercenary band was never a legion. It is drawn up here by its own people's way of fighting, under its captain, with the pay he was hired at,
 * the arms its people carry, and the practice of its people for a doctrine of its own: the Gauls charge and do not hold, the Iberians are at home in rough ground,
 * the Numidians ride down a beaten line, the Balearic slingers screen it, the Campanians fight as the Samnites did, the Greeks stand in the phalanx.
 * The unit structure (the company, the troop, the band) is read from the scenario's own establishments where one of them keeps a body of that people (Carthage's
 * contingents; Syracuse's mercenary band for the Campanians), and from the table below where none does. Deterministic; no model call.
 */

export interface HiredPeople {
  readonly id: string;
  /** What the people are called as an adjective: "Gallic". */
  readonly name: string;
  /** Words (the start of a word of the company's label, its duties or its captain's name) that say whose they are. */
  readonly words: readonly string[];
  /** The kind of troops they are when the writer named none that fits. */
  readonly category: string;
  /** The formation's own name where no establishment has one. */
  readonly formation: string;
  /** What they carry, in the words of the age. */
  readonly arms: string;
  readonly doctrine: { readonly label: string; readonly description: string; readonly effects: readonly DoctrineEffect[] };
}

const effect = (lever: DoctrineEffect["lever"], direction: DoctrineEffect["direction"], band: DoctrineEffect["band"]): DoctrineEffect => ({ lever, direction, band });

export const HIRED_PEOPLES: readonly HiredPeople[] = [
  {
    id: "gauls", name: "Gallic", words: ["gallic", "gaul", "galatian", "celt", "ligurian", "boii", "insubr", "senon"], category: "infantry", formation: "Gallic foot",
    arms: "long swords of soft iron, oblong shields, and the torque for armour (Polybius 2.28-30)",
    doctrine: { label: "The charge of the Gauls", description: "They come on with a rush and a roar, great in the first shock; if it is held they bend, and their swords bend with them (Polybius 2.33).", effects: [effect("frontal_weight", "raise", "marked"), effect("steadiness", "lower", "slight")] },
  },
  {
    id: "iberians", name: "Iberian", words: ["iberian", "spanish", "celtiberian", "lusitan", "spaniard"], category: "infantry", formation: "Iberian foot",
    arms: "the curved falcata, the small round shield and the javelin (Polybius 3.114)",
    doctrine: { label: "The Iberian way in broken ground", description: "Hill men and hunters: they are quick over rough ground and strong in the first rush (Polybius 3.114).", effects: [effect("rough_ground", "raise", "slight"), effect("frontal_weight", "raise", "slight")] },
  },
  {
    id: "numidians", name: "Numidian", words: ["numidian", "massyl", "masaesyl", "libyan horse"], category: "cavalry", formation: "Numidian horse",
    arms: "javelins, a small shield, and horses ridden without saddle or bridle (Livy 35.11)",
    doctrine: { label: "The Numidian ride", description: "Light horse that harry a line, fall back and come again, and ride down men who are running (Polybius 3.65, 15.12).", effects: [effect("pursuit", "raise", "marked"), effect("screen", "raise", "slight"), effect("steadiness", "lower", "slight")] },
  },
  {
    id: "balearics", name: "Balearic", words: ["balearic", "slinger", "baleares"], category: "light-infantry", formation: "Balearic slingers",
    arms: "three slings, one for the long cast, one for the short and one for the middle, and stones carried by the pouch (Livy 38.29)",
    doctrine: { label: "The slingers' screen", description: "Their stones open a battle at a range no javelin reaches, and a line is thinned before it closes (Livy 38.29).", effects: [effect("screen", "raise", "marked")] },
  },
  {
    id: "campanians", name: "Campanian", words: ["campanian", "mamertin", "samnite", "oscan"], category: "infantry", formation: "Campanian foot",
    arms: "the oblong scutum, the javelin and the bronze breastplate of the Samnites (Livy 9.40)",
    doctrine: { label: "The Campanian line", description: "Soldiers of fortune from the Campanian towns, who fought as the Samnites did and sold the service to Syracuse and Carthage alike.", effects: [effect("frontal_weight", "raise", "slight")] },
  },
  {
    id: "greeks", name: "Greek", words: ["greek", "hellen", "hoplite", "achaean", "aetolian", "cretan"], category: "infantry", formation: "Greek hoplites",
    arms: "the round aspis, the long spear and the short sword, in the phalanx (Polybius 18.29)",
    doctrine: { label: "The hoplite phalanx", description: "Shield to shield, spears levelled, they hold the front and do not like the rough (Polybius 18.29-32).", effects: [effect("steadiness", "raise", "slight"), effect("rough_ground", "lower", "slight")] },
  },
];

const WORD = /[^a-z]+/u;
const wordsOf = (text: string): string[] => text.toLowerCase().split(WORD).filter((word) => word.length > 1);

/** The people a hired company is, read from what it was called, what it is for and who leads it; nobody's where none of the words fits. */
export function peopleOfCompany(texts: readonly string[]): HiredPeople | undefined {
  const words = texts.flatMap(wordsOf);
  for (const people of HIRED_PEOPLES) {
    if (people.words.some((mark) => words.some((word) => word.startsWith(mark)))) return people;
  }
  return undefined;
}

/** The unit structure the scenario's own establishments give a people: the first body of any power that matches its words, for the kind of troops the company is. */
function templateFor(world: Pick<WorldState, "establishments">, people: HiredPeople, categoryId: string): { readonly id: string; readonly label: string; readonly line: FormationLine} | undefined {
  for (const establishment of world.establishments) {
    for (const body of establishment.bodies) {
      if (!body.matches.some((match) => match.toLowerCase() === people.words[0])) continue;
      for (const id of body.formationIds) {
        const template = formationTemplateOf(establishment, id);
        if (template !== undefined && template.categoryId === categoryId) return { id: `${establishment.polityId}:${template.id}`, label: template.label, line: template.line };
      }
    }
  }
  return undefined;
}

export interface HiredBandInput {
  readonly forceId: string;
  /** The words that say whose it is: the company's label, the duties, the captain's name and his people. */
  readonly texts: readonly string[];
  readonly captainName: string;
  readonly atStep: number;
  readonly naval: boolean;
}

/**
 * Draws a hired company up as its own people's band: one formation of the band's own, under the captain, with the people's doctrine on the army's own account.
 * A company of no people the table knows is left for `formArmies`, as it was (a band of Cretans is a mercenary band by whatever the employer keeps).
 */
export function formTheHiredBand(world: WorldState, input: HiredBandInput): { readonly world: WorldState; readonly people: HiredPeople | null } {
  const force = world.material.forces.find((candidate) => candidate.id === input.forceId);
  if (force === undefined || input.naval) return { world, people: null };
  const people = peopleOfCompany(input.texts);
  if (people === undefined) return { world, people: null };
  const row = force.personnel[0];
  if (row === undefined) return { world, people: null };
  const template = templateFor(world, people, row.categoryId);
  const bodyId = boundedId(force.id, "band", people.id);
  const bodyLabel = `${people.name} band of ${input.captainName}`.slice(0, 80);
  const formationId = boundedId(bodyId, template?.id.split(":")[1] ?? people.id);
  const line = template?.line ?? lineForCategory({ naval: false, mobilityBps: row.categoryId === "cavalry" ? 9_000 : 5_000 });
  const doctrineId = boundedId("band-doctrine", force.id, people.id);
  const doctrine: Doctrine = DoctrineSchema.parse({
    id: doctrineId, label: people.doctrine.label, description: people.doctrine.description, origin: "practice", polityId: force.polityId, effects: people.doctrine.effects,
    upkeepAccountId: null, adoptedAtStep: input.atStep, adoptedByCharacterId: input.captainName === "" ? null : force.commanderCharacterId, forceId: force.id, settledThroughStep: null, lapsedAtStep: null,
  });
  const formed: Force = {
    ...force,
    name: /legio|legion|ala of|phalanx/iu.test(force.name) ? bodyLabel : force.name,
    personnel: [{ ...row, label: `${template?.label ?? people.formation}, ${people.arms.split(",")[0]}`.slice(0, 80), formationId }],
    formations: [{
      id: formationId, bodyId, bodyLabel, templateId: `irregular:${row.categoryId}`, line,
      // What a hired company brings: drilled and seasoned (`SOURCE_QUALITY.mercenary`), and drilling no further than its people's way allows.
      trainingBps: 3_500, experienceBps: 3_500, doctrineIds: [doctrineId], units: [], raisedAtStep: input.atStep,
    }],
  };
  return {
    world: {
      ...world,
      doctrines: world.doctrines.some((candidate) => candidate.id === doctrineId) ? world.doctrines : [...world.doctrines, doctrine],
      material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === force.id ? formed : candidate)) },
    },
    people,
  };
}
