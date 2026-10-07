import { deriveDefaultMind, ordoOfRomanName, stableHash, type HouseKind, type WorldState } from "@chronica/shared";

/**
 * The merchant houses of 270 BCE (scenario v53, docs/economy.md "Who manages the economy").
 *
 * Seventeen families, each a head with a purse, an heir who takes the house when the head dies, and a home
 * market. The aggregate trade of the world was invisible; these are the people who carry it, and the money they
 * lend a treasury in a bad year. Where the sources give no name the names are generic and honest about it: a
 * Tyrian-descended Carthaginian shipowner is a son of some Abdeshmun, a Syracusan grain-shipper a son of some
 * Herakleides. Capital is on the age's scale: a house is worth a good senator or the better part of a province's
 * revenue for a year (docs/economy.md, Calibration), and the richest of them, Carthage's maritime houses, are a
 * twentieth of its chest.
 *
 *  - **Rome**: the *publicani*, the equestrian company that farmed the state's contracts and supplied its armies,
 *    and a Greek banker of Neapolis, the allied port that was Rome's door on the sea.
 *  - **Carthage**: four houses of the Tyrian-descended families that were the republic's merchant class and its
 *    fleet's owners (Polybius 6.51; the maritime houses are a voting bloc of its own in the scenario), at Carthage,
 *    Utica, Hadrumetum and Lilybaeum.
 *  - **The Greek world**: the shipowners and grain-factors of Syracuse, Massalia, Rhodes, Athens and Ephesus,
 *    Tarentum's and Alexandria's bankers, and a merchant of Tyre under the Ptolemies; Gades's silver trade.
 *
 * Built after the opening world is made (like the regional taxes): the ids of provinces are looked up by the
 * name of the town the house sits in, so a regenerated map moves nothing here.
 */

interface HouseSpec {
  readonly slug: string;
  readonly name: string;
  readonly head: string;
  readonly heir: string;
  readonly town: string;
  readonly kind: HouseKind;
  readonly culture: "roman" | "greek" | "carthaginian" | "italic";
  readonly capital: number;
  readonly headAge: number;
}

const HOUSES: readonly HouseSpec[] = [
  { slug: "publicani-rome", name: "The publicani of the Aerarium", head: "Titus Sicinius Rufus", heir: "Gaius Sicinius Rufus", town: "Rome", kind: "publicani", culture: "roman", capital: 150_000, headAge: 52 },
  { slug: "neapolis-bankers", name: "The bankers of Neapolis", head: "Nikomachos son of Philon", heir: "Philon son of Nikomachos", town: "Naples", kind: "banking", culture: "greek", capital: 110_000, headAge: 49 },
  { slug: "bodashtart-carthage", name: "The house of Bodashtart", head: "Bodashtart son of Abdeshmun", heir: "Abdeshmun son of Bodashtart", town: "Carthage", kind: "maritime", culture: "carthaginian", capital: 380_000, headAge: 56 },
  { slug: "himilco-carthage", name: "The shipowners of Himilco", head: "Himilco son of Arish", heir: "Arish son of Himilco", town: "Carthage", kind: "maritime", culture: "carthaginian", capital: 300_000, headAge: 47 },
  { slug: "eshmunazar-utica", name: "The house of Eshmunazar of Utica", head: "Eshmunazar son of Baalyaton", heir: "Baalyaton son of Eshmunazar", town: "Utica", kind: "grain", culture: "carthaginian", capital: 160_000, headAge: 54 },
  { slug: "baalhanno-hadrumetum", name: "The oil-factors of Hadrumetum", head: "Baalhanno son of Gerashtart", heir: "Gerashtart son of Baalhanno", town: "Hadrumetum", kind: "grain", culture: "carthaginian", capital: 130_000, headAge: 45 },
  { slug: "abdmelqart-gades", name: "The silver-traders of Gades", head: "Abdmelqart son of Hanno", heir: "Hanno son of Abdmelqart", town: "Gades", kind: "silver", culture: "carthaginian", capital: 190_000, headAge: 58 },
  { slug: "adonibaal-lilybaeum", name: "The shipmen of Lilybaeum", head: "Adonibaal son of Mattan", heir: "Mattan son of Adonibaal", town: "Lilybaeum", kind: "maritime", culture: "carthaginian", capital: 95_000, headAge: 43 },
  { slug: "philistion-syracuse", name: "The house of Philistion", head: "Philistion son of Nikias", heir: "Nikias son of Philistion", town: "Syracuse", kind: "maritime", culture: "greek", capital: 260_000, headAge: 55 },
  { slug: "dion-syracuse", name: "The grain-shippers of Dion", head: "Dion son of Herakleides", heir: "Herakleides son of Dion", town: "Syracuse", kind: "grain", culture: "greek", capital: 160_000, headAge: 44 },
  { slug: "euthymenes-massalia", name: "The house of Euthymenes", head: "Euthymenes son of Aristarchos", heir: "Aristarchos son of Euthymenes", town: "Massalia", kind: "maritime", culture: "greek", capital: 210_000, headAge: 51 },
  { slug: "theodotos-rhodes", name: "The shipowners of Rhodes", head: "Theodotos son of Epicharmos", heir: "Epicharmos son of Theodotos", town: "Rhodes", kind: "maritime", culture: "greek", capital: 260_000, headAge: 53 },
  { slug: "kallias-athens", name: "The house of Kallias", head: "Kallias son of Phaidros", heir: "Phaidros son of Kallias", town: "Athens", kind: "maritime", culture: "greek", capital: 170_000, headAge: 48 },
  { slug: "apollonios-alexandria", name: "The bankers of Alexandria", head: "Apollonios son of Diotimos", heir: "Diotimos son of Apollonios", town: "Alexandria", kind: "banking", culture: "greek", capital: 320_000, headAge: 50 },
  { slug: "abdashtart-tyre", name: "The merchants of Tyre", head: "Abdashtart son of Eshmun", heir: "Eshmun son of Abdashtart", town: "Tyre", kind: "maritime", culture: "carthaginian", capital: 230_000, headAge: 57 },
  { slug: "lysis-tarentum", name: "The house of Lysis", head: "Lysis son of Archytas", heir: "Archytas son of Lysis", town: "Tarentum", kind: "maritime", culture: "greek", capital: 120_000, headAge: 46 },
  { slug: "hermias-ephesus", name: "The house of Hermias", head: "Hermias son of Menandros", heir: "Menandros son of Hermias", town: "Ephesus", kind: "maritime", culture: "greek", capital: 150_000, headAge: 52 },
];

const FAITH = { roman: "faith-roman", greek: "faith-greek", carthaginian: "faith-punic", italic: "faith-italic" } as const;

function skillsFor(id: string, age: number): Record<string, unknown> {
  const spread = (part: string, low: number, span: number): number => low + (stableHash([id, part]) % span);
  return {
    martial: spread("martial", 25, 20), intrigue: spread("intrigue", 35, 25), learning: spread("learning", 40, 25), piety: spread("piety", 35, 25),
    stewardship: spread("stewardship", 58, 24) + (age > 40 ? 3 : 0), diplomacy: spread("diplomacy", 48, 20), body: spread("body", 45, 25), subSkills: {},
  };
}

/** The opening world with its merchant houses: their heads and heirs, their purses, and the economy's list of them. */
export function withMerchantHouses(world: WorldState): WorldState {
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  const houses: Record<string, unknown>[] = [];
  const taken = new Set(world.characters.map((character) => character.id));
  for (const spec of HOUSES) {
    const home = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.name === spec.town));
    if (home === undefined || home.controllerPolityId === null) continue;
    const headId = `house-${spec.slug}-head`;
    const heirId = `house-${spec.slug}-heir`;
    if (taken.has(headId) || taken.has(heirId)) continue;
    const person = (id: string, name: string, age: number, heirId: string | null, drives: Record<string, number>): Record<string, unknown> => {
      const skills = skillsFor(id, age);
      return {
        id, name, cultureId: spec.culture, faithId: FAITH[spec.culture], dynastyId: null, locationProvinceId: home.id, polityId: home.controllerPolityId,
        ageYearsAtStart: age, officeId: null, personalAccountId: `${id}-purse`, skills, traits: [],
        mind: { ...deriveDefaultMind({ id, officeId: null, skills: skills as never, ageYears: age, cultureId: spec.culture }), ...drives },
        healthBps: 8_200, prestigeBps: 3_500, relations: [], ambitions: [], heirCharacterId: heirId, alive: true, diedAtStep: null,
        // Every man of Rome is a patrician or a plebeian by his name, as the scenario makes the rest (`ordoOfRomanName`).
        ...(home.controllerPolityId === "rome" ? { ordo: ordoOfRomanName(name) } : {}),
      };
    };
    characters.push(person(headId, spec.head, spec.headAge, heirId, {}));
    characters.push({ ...person(heirId, spec.heir, 20 + (stableHash([spec.slug, "heir-age"]) % 7), null, {}), heirCharacterId: null, prestigeBps: 2_000 });
    accounts.push({ id: `${headId}-purse`, owner: { kind: "character", id: headId }, currencyId: "drachma", balance: spec.capital, status: "active", visibility: "private" });
    accounts.push({ id: `${heirId}-purse`, owner: { kind: "character", id: heirId }, currencyId: "drachma", balance: 4_000, status: "active", visibility: "private" });
    houses.push({ id: `house-${spec.slug}`, name: spec.name, kind: spec.kind, polityId: home.controllerPolityId, homeProvinceId: home.id, headCharacterId: headId, status: "trading", foundedAtStep: 0 });
  }
  return {
    ...world,
    characters: [...world.characters, ...characters] as WorldState["characters"],
    economy: { ...world.economy!, houses: [...(world.economy!.houses ?? []), ...houses] as never },
    material: { ...world.material, accounts: [...world.material.accounts, ...accounts] as WorldState["material"]["accounts"] },
  };
}
