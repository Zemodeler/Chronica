import { personFor, seatFor, stableHash, type Focus, type Office, type SeatDraft } from "@chronica/shared";
import { PUNIC_IDS } from "./punic-ids";

/**
 * The people in the chairs of the five powers written out by hand (scenario v37).
 *
 * Rome's quaestors, tribunes, aediles, praetor, censors and priestly colleges;
 * Carthage's suffetes, judges and officers of the accounts; Syracuse's generals
 * and friends of the king; the councillors of the Mamertines and the Campanians
 * were offices with nobody in them, so the state's own list of its offices read
 * "Vacant" down the page. Where the sources name the man who held the post in
 * 270 he is that man, or the nearest we can put him to it: the Roman names
 * below are the consuls and censors of the 260s and 250s, who held the lesser
 * magistracies in the years before. Where they are silent the man is drawn from
 * the gentes that held such places, and belongs to nobody the histories
 * remember. Only named people have seats: a college of nine is its named members
 * out of nine.
 */

interface Entry {
  readonly name: string;
  readonly age: number;
  readonly focus: Focus;
  readonly prestige: number;
  readonly gender?: "male" | "female";
  readonly traits?: readonly string[];
}

interface PowerRoster {
  readonly polityId: string;
  readonly cultureId: string;
  readonly faithId: string;
  readonly provinceId: string;
  /** Office id -> who holds it. A string is somebody already in the world, given one more seat. */
  readonly posts: Readonly<Record<string, readonly (Entry | string)[]>>;
}

const ROME: PowerRoster = {
  polityId: "rome", cultureId: "roman", faithId: "faith-roman", provinceId: PUNIC_IDS.rome,
  posts: {
    // The urban praetor: consul of 269 after the year's jurisdiction.
    "roman-praetor": [{ name: "Gaius Fabius Pictor", age: 41, focus: "learning", prestige: 7_400, traits: ["methodical"] }],
    // The curule pair -- a patrician and a plebeian -- and the plebs' own two.
    "roman-aedile": [
      { name: "Publius Sempronius Sophus", age: 41, focus: "stewardship", prestige: 6_200, traits: ["dutiful"] },
      { name: "Appius Claudius Russus", age: 39, focus: "diplomacy", prestige: 6_300, traits: ["ambitious"] },
    ],
    "roman-plebeian-aedile": [
      { name: "Manius Otacilius Crassus", age: 38, focus: "stewardship", prestige: 5_600 },
      { name: "Marcus Fulvius Flaccus", age: 37, focus: "intrigue", prestige: 5_500, traits: ["ambitious"] },
    ],
    "roman-quaestor": [
      { name: "Marcus Atilius Regulus", age: 32, focus: "martial", prestige: 5_000, traits: ["dutiful"] },
      { name: "Lucius Julius Libo", age: 31, focus: "stewardship", prestige: 4_800 },
      { name: "Decimus Junius Pera", age: 31, focus: "stewardship", prestige: 4_700 },
      { name: "Numerius Fabius Pictor", age: 30, focus: "learning", prestige: 4_900 },
    ],
    "roman-tribune": [
      { name: "Gaius Duilius", age: 35, focus: "martial", prestige: 4_900, traits: ["bold"] },
      { name: "Lucius Mamilius Vitulus", age: 33, focus: "diplomacy", prestige: 4_400 },
      { name: "Gaius Lutatius Catulus", age: 34, focus: "diplomacy", prestige: 4_500 },
      { name: "Aulus Atilius Caiatinus", age: 33, focus: "martial", prestige: 4_400 },
      { name: "Gaius Sempronius Blaesus", age: 32, focus: "intrigue", prestige: 4_200, traits: ["ambitious"] },
      { name: "Gaius Aurelius Cotta", age: 31, focus: "diplomacy", prestige: 4_200 },
      { name: "Quintus Caedicius", age: 30, focus: "intrigue", prestige: 4_100 },
      { name: "Titus Otacilius Crassus", age: 29, focus: "diplomacy", prestige: 3_900 },
      { name: "Gaius Fundanius Fundulus", age: 28, focus: "intrigue", prestige: 3_800, traits: ["bold"] },
      { name: "Marcus Livius Denter", age: 27, focus: "stewardship", prestige: 3_700 },
    ],
    // Censors for the lustrum: the old consular who held the office in 275, and Curius, who held it in 272.
    "roman-censor": [{ name: "Quintus Aemilius Papus", age: 62, focus: "learning", prestige: 8_600, traits: ["dutiful"] }, "manius-curius"],
    "roman-pontifex-maximus": ["tiberius-coruncanius"],
    "roman-pontiff": [
      { name: "Publius Cornelius Arvina", age: 58, focus: "piety", prestige: 7_000 },
      { name: "Gaius Marcius Rutilus", age: 50, focus: "piety", prestige: 6_800 },
      { name: "Lucius Aemilius Barbula", age: 53, focus: "learning", prestige: 6_700 },
      { name: "Quintus Marcius Philippus", age: 50, focus: "piety", prestige: 6_600 },
    ],
    "roman-augur": [
      "quintus-ogulnius",
      { name: "Lucius Genucius Clepsina", age: 50, focus: "piety", prestige: 6_900 },
      { name: "Publius Decius Mus", age: 48, focus: "piety", prestige: 6_600, traits: ["dutiful"] },
      { name: "Marcus Valerius Maximus Messalla", age: 44, focus: "diplomacy", prestige: 6_400 },
    ],
    "roman-vestal": [
      { name: "Aemilia the Vestal", age: 37, focus: "piety", prestige: 6_400, gender: "female" },
      { name: "Licinia the Vestal", age: 33, focus: "piety", prestige: 6_000, gender: "female" },
      { name: "Cornelia the Vestal", age: 29, focus: "piety", prestige: 6_000, gender: "female" },
      { name: "Fabia the Vestal", age: 24, focus: "piety", prestige: 5_800, gender: "female" },
      { name: "Postumia the Vestal", age: 18, focus: "piety", prestige: 5_600, gender: "female" },
      { name: "Caecilia the Vestal", age: 13, focus: "piety", prestige: 5_400, gender: "female" },
    ],
  },
};

const CARTHAGE: PowerRoster = {
  polityId: "carthage", cultureId: "carthaginian", faithId: "faith-punic", provinceId: PUNIC_IDS.carthage,
  posts: {
    "carthaginian-suffete": [
      { name: "Himilco son of Gisgo", age: 52, focus: "diplomacy", prestige: 7_000, traits: ["cautious"] },
      { name: "Bostar son of Hanno", age: 49, focus: "martial", prestige: 6_800, traits: ["dutiful"] },
    ],
    "carthaginian-accountant": [
      { name: "Abdmelqart", age: 55, focus: "stewardship", prestige: 5_600, traits: ["methodical"] },
      { name: "Azrubaal", age: 50, focus: "stewardship", prestige: 5_300 },
      { name: "Barmelqart", age: 46, focus: "stewardship", prestige: 5_100 },
    ],
    "carthaginian-elder": [
      { name: "Hamilcar son of Bomilcar", age: 58, focus: "diplomacy", prestige: 6_600 },
      { name: "Adherbal son of Hanno", age: 54, focus: "diplomacy", prestige: 6_200 },
      { name: "Yatonmilk", age: 60, focus: "learning", prestige: 6_400 },
      { name: "Mago the Elder", age: 57, focus: "stewardship", prestige: 6_500, traits: ["ambitious"] },
    ],
    "carthaginian-judge": [
      { name: "Hasdrubal the Elder", age: 59, focus: "learning", prestige: 6_000, traits: ["disciplined"] },
      { name: "Gisco son of Hanno", age: 56, focus: "diplomacy", prestige: 5_800 },
      { name: "Bomilcar son of Gisco", age: 53, focus: "intrigue", prestige: 5_600 },
      { name: "Mattan", age: 51, focus: "learning", prestige: 5_400 },
      { name: "Shafat", age: 49, focus: "diplomacy", prestige: 5_300 },
    ],
    "carthaginian-priest": [
      { name: "Abdashtart", age: 62, focus: "piety", prestige: 6_000 },
      { name: "Baalhanno", age: 57, focus: "piety", prestige: 5_600 },
      { name: "Yehawwelbaal", age: 52, focus: "piety", prestige: 5_400 },
    ],
  },
};

const SYRACUSE: PowerRoster = {
  polityId: "syracuse", cultureId: "greek", faithId: "faith-greek", provinceId: PUNIC_IDS.syracuse,
  posts: {
    "syracusan-strategos": [
      { name: "Aristomachus of Syracuse", age: 46, focus: "martial", prestige: 6_000, traits: ["disciplined"] },
      { name: "Nicostratus of Syracuse", age: 41, focus: "martial", prestige: 5_600, traits: ["bold"] },
      { name: "Polyarchus son of Dion", age: 38, focus: "martial", prestige: 5_400 },
    ],
    "syracusan-amphipolos": [{ name: "Hegesias son of Theron", age: 54, focus: "piety", prestige: 5_600 }],
    "syracusan-friend": [
      { name: "Sosistratus of Syracuse", age: 50, focus: "diplomacy", prestige: 6_000, traits: ["cautious"] },
      { name: "Archias son of Phintias", age: 45, focus: "stewardship", prestige: 5_600 },
      { name: "Damarchus", age: 52, focus: "intrigue", prestige: 5_500 },
      { name: "Diocles of Syracuse", age: 47, focus: "learning", prestige: 5_400 },
    ],
  },
};

const MAMERTINES: PowerRoster = {
  polityId: "mamertines", cultureId: "italic", faithId: "faith-italic", provinceId: PUNIC_IDS.messana,
  posts: {
    "mamertine-councillor": [
      { name: "Numerius Staius", age: 44, focus: "martial", prestige: 4_800, traits: ["bold"] },
      { name: "Ovius Pacius", age: 40, focus: "martial", prestige: 4_500 },
      { name: "Vibius Calavius", age: 47, focus: "intrigue", prestige: 4_600 },
      { name: "Herius Minius", age: 38, focus: "diplomacy", prestige: 4_400 },
    ],
  },
};

const CAMPANIANS: PowerRoster = {
  polityId: "rhegium-campanians", cultureId: "italic", faithId: "faith-italic", provinceId: PUNIC_IDS.rhegium,
  posts: {
    "campanian-councillor": [
      { name: "Marcus Magius", age: 43, focus: "martial", prestige: 3_800, traits: ["vengeful"] },
      { name: "Gaius Jubellius", age: 45, focus: "intrigue", prestige: 3_700 },
      { name: "Statius Trebius", age: 39, focus: "martial", prestige: 3_500, traits: ["bold"] },
      { name: "Numerius Paquius", age: 41, focus: "diplomacy", prestige: 3_400 },
    ],
  },
};

const ROSTERS: readonly PowerRoster[] = [ROME, CARTHAGE, SYRACUSE, MAMERTINES, CAMPANIANS];

export interface RosterPeople {
  readonly characters: readonly Record<string, unknown>[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly officeSeats: readonly SeatDraft[];
}

/**
 * The seats and the people for every post above. `offices` are the scenario's
 * own (for terms and eligibility); `takenSeats` are the seats already written,
 * so a new seat takes the next index rather than a held one's.
 */
export function rosterPeople(offices: readonly Office[], takenSeats: readonly { officeId: string; seatIndex: number }[]): RosterPeople {
  const officeById = new Map(offices.map((office) => [office.id, office]));
  const next = new Map<string, number>();
  for (const seat of takenSeats) next.set(seat.officeId, Math.max(next.get(seat.officeId) ?? 0, seat.seatIndex + 1));
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  const officeSeats: SeatDraft[] = [];

  for (const roster of ROSTERS) {
    for (const [officeId, holders] of Object.entries(roster.posts)) {
      const office = officeById.get(officeId);
      if (office === undefined) throw new Error(`The roster names an office the scenario does not have: ${officeId}`);
      const magistracy = (office.kind ?? "magistracy") === "magistracy";
      for (const holder of holders) {
        const seatIndex = next.get(officeId) ?? 0;
        next.set(officeId, seatIndex + 1);
        if (typeof holder === "string") {
          officeSeats.push(seatFor(office, seatIndex, holder, 0));
          continue;
        }
        const id = `${roster.polityId}-${officeId.replace(/^(roman|carthaginian|syracusan|mamertine|campanian)-/, "")}-${stableHash([roster.polityId, holder.name]).toString(36).slice(0, 6)}`;
        const { character, account } = personFor({
          id, name: holder.name, polityId: roster.polityId, cultureId: roster.cultureId, faithId: roster.faithId, provinceId: roster.provinceId,
          age: holder.age, prestigeBps: holder.prestige, focus: holder.focus, traits: holder.traits ?? [],
          ...(holder.gender === undefined ? {} : { gender: holder.gender }),
          officeId: magistracy ? officeId : null,
        }, 0);
        characters.push(character);
        accounts.push(account);
        officeSeats.push(seatFor(office, seatIndex, id, 0));
      }
    }
  }
  return { characters, accounts, officeSeats };
}

// ── The great houses' families (play-test L10) ──────────────────────────────
//
// The scenario had no family at all: no wife, no daughter, no son, and its
// only women were the six Vestals -- so a man could not marry into the
// nobility, nobody had an heir to be born, and a house was one man. These are
// the households of the principal men, by name where the sources name them and
// invented where they do not, each marked in its `creationReason` as one or the
// other. Ages are as of 270.

interface Kin {
  readonly name: string;
  readonly age: number;
  readonly gender: "male" | "female";
  /** What the kinsman is to the head of the house. */
  readonly is: "wife" | "son" | "daughter" | "sister" | "brother";
  /** Where the sources name this person, and where; absent, the person is invented. */
  readonly historical?: string;
  /** Somebody already in the world, given the tie and no new person. */
  readonly existing?: boolean;
  /** For a wife: her own father, already in the world. */
  readonly fatherName?: string;
}

interface House {
  /** The head's name, as he stands in the world. */
  readonly head: string;
  readonly kin: readonly Kin[];
}

const HOUSES: readonly House[] = [
  // The Cornelii: Blasio, consul this year.
  { head: "Gnaeus Cornelius Blasio", kin: [
    { name: "Sulpicia", age: 34, gender: "female", is: "wife" },
    { name: "Cornelia Blasionis", age: 16, gender: "female", is: "daughter" },
    { name: "Gnaeus Cornelius Blasio the Younger", age: 12, gender: "male", is: "son" },
  ] },
  // The Fabii: the praetor, his brother Numerius, and the son who wrote Rome's first history in Greek.
  { head: "Gaius Fabius Pictor", kin: [
    { name: "Fulvia", age: 30, gender: "female", is: "wife" },
    { name: "Quintus Fabius Pictor", age: 1, gender: "male", is: "son", historical: "the historian, son of Gaius Fabius Pictor, born about 270" },
    { name: "Fabia Pictoris", age: 14, gender: "female", is: "daughter" },
    { name: "Numerius Fabius Pictor", age: 30, gender: "male", is: "brother", existing: true, historical: "consul in 266, brother of Gaius" },
  ] },
  // The Claudii: the sons of Appius Claudius Caecus, and their sister Claudia, whose arrogance in 246 cost her a fine.
  { head: "Appius Claudius Russus", kin: [
    { name: "Valeria", age: 30, gender: "female", is: "wife" },
    { name: "Claudia", age: 15, gender: "female", is: "sister", historical: "daughter of Appius Claudius Caecus, fined in 246 (Livy, Periochae 19)" },
    { name: "Claudia Russi", age: 13, gender: "female", is: "daughter" },
  ] },
  // The Aemilii: the old censor.
  { head: "Quintus Aemilius Papus", kin: [
    { name: "Aemilia Papia", age: 17, gender: "female", is: "daughter" },
    { name: "Lucius Aemilius Papus", age: 24, gender: "male", is: "son" },
  ] },
  // The Sempronii: Sophus, consul in 268.
  { head: "Publius Sempronius Sophus", kin: [
    { name: "Postumia", age: 35, gender: "female", is: "wife" },
    { name: "Sempronia", age: 16, gender: "female", is: "daughter" },
    { name: "Publius Sempronius Sophus the Younger", age: 10, gender: "male", is: "son" },
  ] },
  // The Atilii: Regulus and Marcia, whose sons were consuls in the 220s.
  { head: "Marcus Atilius Regulus", kin: [
    { name: "Marcia", age: 22, gender: "female", is: "wife", historical: "wife of Marcus Atilius Regulus (Silius Italicus, Punica 6)" },
  ] },
  // The Otacilii.
  { head: "Manius Otacilius Crassus", kin: [
    { name: "Mamilia", age: 30, gender: "female", is: "wife" },
    { name: "Otacilia", age: 14, gender: "female", is: "daughter" },
    { name: "Titus Otacilius Crassus", age: 29, gender: "male", is: "brother", existing: true, historical: "consul in 261, of the same house" },
  ] },
  // The Genucii: the consul.
  { head: "Gaius Genucius Clepsina", kin: [
    { name: "Aurelia", age: 38, gender: "female", is: "wife" },
    { name: "Genucia", age: 17, gender: "female", is: "daughter" },
    { name: "Lucius Genucius the Younger", age: 15, gender: "male", is: "son" },
  ] },
  // Hieron married Philistis, Leptines' daughter, to bind the best house of Syracuse to him (Polybius 1.9).
  { head: "Hieron II", kin: [
    { name: "Philistis", age: 24, gender: "female", is: "wife", historical: "queen of Syracuse, daughter of Leptines (Polybius 1.9)", fatherName: "Leptines of Syracuse" },
  ] },
  // Carthage: Hanno's house, and Gisco's.
  { head: "Hanno of Carthage", kin: [
    { name: "Arishat", age: 40, gender: "female", is: "wife" },
    { name: "Batbaal", age: 16, gender: "female", is: "daughter" },
    { name: "Bomilcar son of Hanno", age: 20, gender: "male", is: "son" },
  ] },
  { head: "Hannibal Gisco", kin: [
    { name: "Elishat", age: 30, gender: "female", is: "wife" },
    { name: "Sophonba", age: 12, gender: "female", is: "daughter" },
  ] },
];

/** The Barcids, whose head the sources do not name: only that Hamilcar, born about 275, was of the house. */
const BARCID_HEAD = { name: "Hannibal the Barcid", age: 46, prestige: 5_200 };
const BARCID_KIN: readonly Kin[] = [
  { name: "Imilce", age: 34, gender: "female", is: "wife" },
  { name: "Hamilcar Barca", age: 5, gender: "male", is: "son", historical: "Hamilcar Barca, born about 275, father of Hannibal" },
  { name: "Arisha Barcid", age: 15, gender: "female", is: "daughter" },
];

export interface HouseFamilies {
  readonly characters: readonly Record<string, unknown>[];
  readonly accounts: readonly Record<string, unknown>[];
  readonly familyLinks: readonly Record<string, unknown>[];
}

/**
 * The great houses' wives, daughters, sons, brothers and sisters, as people
 * and as family ties, for the characters already written. Throws on a head the
 * world does not have: a house written for nobody is a mistake in this file.
 */
export function houseFamilies(people: readonly Record<string, unknown>[]): HouseFamilies {
  type Person = { id: string; name: string; polityId: string; cultureId: string; faithId: string; locationProvinceId: string; prestigeBps: number };
  const all = people as unknown as readonly Person[];
  const named = (name: string): Person => {
    const found = all.find((person) => person.name === name);
    if (found === undefined) throw new Error(`A house is written for somebody the world does not have: ${name}`);
    return found;
  };
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  const familyLinks: Record<string, unknown>[] = [];
  const link = (characterId: string, relatedCharacterId: string, kind: string): void => {
    familyLinks.push({ id: `family-${stableHash([characterId, relatedCharacterId, kind]).toString(36)}`, characterId, relatedCharacterId, kind, startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null });
  };
  const person = (head: Person, id: string, name: string, age: number, prestigeBps: number, gender: "male" | "female", why: string, traits: readonly string[] = []): Person => {
    const made = personFor({
      id, name, polityId: head.polityId, cultureId: head.cultureId, faithId: head.faithId, provinceId: head.locationProvinceId,
      age, prestigeBps, focus: gender === "female" ? "diplomacy" : "learning", traits, gender, officeId: null, balance: age < 14 ? 0 : 100,
    }, 0);
    characters.push({ ...made.character, creationReason: why });
    accounts.push(made.account);
    return { ...head, id, name, prestigeBps };
  };
  const seat = (head: Person, kin: readonly Kin[]): void => {
    const made = kin.map((member) => ({
      member,
      person: member.existing === true
        ? named(member.name)
        : person(head, `${head.polityId}-kin-${stableHash([head.name, member.name]).toString(36).slice(0, 6)}`, member.name, member.age,
          Math.round(head.prestigeBps * (member.is === "wife" ? 0.4 : 0.3)), member.gender,
          member.historical === undefined ? `Invented: the sources do not name this ${member.is} of ${head.name}.` : `Historical: ${member.historical}.`),
    }));
    const wife = made.find((entry) => entry.member.is === "wife");
    for (const { member, person: kinsman } of made) {
      if (member.is === "wife") {
        link(head.id, kinsman.id, "spouse_or_partner");
        if (member.fatherName !== undefined) link(named(member.fatherName).id, kinsman.id, "parent");
      } else if (member.is === "son" || member.is === "daughter") {
        link(head.id, kinsman.id, "parent");
        // Hers too, where she was old enough to have borne the child.
        if (wife !== undefined && wife.member.age - member.age >= 15) link(wife.person.id, kinsman.id, "parent");
      } else {
        link(head.id, kinsman.id, "sibling");
      }
    }
  };
  for (const house of HOUSES) seat(named(house.head), house.kin);
  // The Barcid head is a person of his own, at Carthage.
  const carthage = named("Hanno of Carthage");
  const barcid = person(carthage, `carthage-kin-${stableHash(["Barcid", BARCID_HEAD.name]).toString(36).slice(0, 6)}`, BARCID_HEAD.name, BARCID_HEAD.age, BARCID_HEAD.prestige, "male",
    "Invented: the sources name Hamilcar Barca's house, not his father.", ["ambitious"]);
  seat(barcid, BARCID_KIN);
  return { characters, accounts, familyLinks };
}
