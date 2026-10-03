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
