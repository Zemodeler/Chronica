import { deriveDefaultMind, type WorldState } from "@chronica/shared";
import { PUNIC_IDS } from "./punic-ids";

/**
 * Carthage in western Sicily in 270 BCE (playtest fix batch 2, docs/plans/scenario-notes-batch2.md).
 *
 * The opening kept all of Carthage's land force at Carthage itself: a "field force" of three thousand in Africa for three years, and only a fleet
 * at Lilybaeum, so that no Roman army ever met a Carthaginian one in Sicily and the war with Carthage could not be fought. Carthage's holding of the
 * west is the best-attested thing about the island before 264: Lilybaeum (founded 397 BCE by the people of Motya, held against Pyrrhus in 277:
 * Plutarch, Pyrrhus 22-23; Diodorus 22.10; Justin 23.3), Panormus and the rest of the epikrateia (Polybius 1.10, 1.17, 1.38). Carthage kept hired men
 * in its Sicilian towns and a strategos over them (Polybius 1.17 names the garrison of Agrigentum in 262 and its leader, Hannibal son of Gisco).
 *
 * What is invented: the numbers (the sources give none for 270; those of 262 are inflated and for a war army), and the names of the three officers
 * below, whom the sources do not name before 264 (confidence low: the garrison towns are certain, the strengths are a plausible peace-time guess:
 * a strategos's army of a few thousand, and a thousand men each in the two greater towns). Agrigentum is Carthage's in the map already; the sources
 * have it independent under its tyrant until 262, which this does not change (open decision in the notes).
 */

const OFFICERS = [
  { id: "hasdrubal-son-of-hanno", name: "Hasdrubal son of Hanno", age: 34, martial: 62, strategist: 60, locationId: PUNIC_IDS.lilybaeum },
  { id: "carthalo-panormus", name: "Carthalo", age: 41, martial: 52, strategist: 48, locationId: PUNIC_IDS.panormus },
  { id: "bodmelqart-agrigentum", name: "Bodmelqart", age: 46, martial: 50, strategist: 45, locationId: PUNIC_IDS.agrigentum },
] as const;

const FORCE_COMMON = { polityId: "carthage", moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 500, provisionStatus: "provisioned", provisionedThroughStep: 365, payObligationId: "carthage-sicilian-hired-men", payArrearsPeriods: 0, history: [] } as const;

/** The opening world with Carthage's army, and its garrisons, in Sicily. */
export function withCarthageInSicily(world: WorldState): WorldState {
  const taken = new Set(world.characters.map((character) => character.id));
  const characters: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  for (const officer of OFFICERS) {
    if (taken.has(officer.id)) continue;
    const skills = { martial: officer.martial, intrigue: 35, learning: 40, piety: 45, stewardship: 50, diplomacy: 40, body: 58, subSkills: { strategist: officer.strategist, logistics: 55 } };
    characters.push({
      id: officer.id, name: officer.name, cultureId: "carthaginian", faithId: "faith-punic", dynastyId: null, locationProvinceId: officer.locationId, polityId: "carthage",
      ageYearsAtStart: officer.age, officeId: null, personalAccountId: `${officer.id}-purse`, skills, traits: ["disciplined"],
      mind: deriveDefaultMind({ id: officer.id, officeId: null, skills: skills as never, ageYears: officer.age, cultureId: "carthaginian" }),
      healthBps: 8_800, prestigeBps: 3_500, relations: [], ambitions: [], heirCharacterId: null, alive: true, diedAtStep: null,
    });
    accounts.push({ id: `${officer.id}-purse`, owner: { kind: "character", id: officer.id }, currencyId: "drachma", balance: 6_000, status: "active", visibility: "private" });
  }
  const forces = [
    {
      ...FORCE_COMMON, id: "carthaginian-sicilian-army", name: "Carthaginian army in Sicily", commanderCharacterId: "hasdrubal-son-of-hanno", controllerCharacterId: "hasdrubal-son-of-hanno",
      locationId: PUNIC_IDS.lilybaeum, authorizedStrength: 3_200,
      personnel: [
        { categoryId: "infantry", label: "Libyan foot", fit: 1_300, unavailable: [] }, { categoryId: "cavalry", label: "Numidian and Libyan horse", fit: 300, unavailable: [] },
        { categoryId: "light-infantry", label: "Balearic slingers", fit: 200, unavailable: [] }, { categoryId: "infantry", label: "Iberian mercenaries", fit: 500, unavailable: [] },
        { categoryId: "infantry", label: "Campanian and Gallic mercenaries", fit: 600, unavailable: [] },
      ],
    },
    {
      ...FORCE_COMMON, id: "carthaginian-garrison-panormus", name: "Carthaginian garrison of Panormus", commanderCharacterId: "carthalo-panormus", controllerCharacterId: "carthalo-panormus",
      locationId: PUNIC_IDS.panormus, authorizedStrength: 900,
      personnel: [{ categoryId: "infantry", label: "Libyan foot", fit: 450, unavailable: [] }, { categoryId: "infantry", label: "Hired Greeks and Iberians", fit: 450, unavailable: [] }],
    },
    {
      ...FORCE_COMMON, id: "carthaginian-garrison-agrigentum", name: "Carthaginian garrison of Agrigentum", commanderCharacterId: "bodmelqart-agrigentum", controllerCharacterId: "bodmelqart-agrigentum",
      locationId: PUNIC_IDS.agrigentum, authorizedStrength: 1_000,
      personnel: [{ categoryId: "infantry", label: "Libyan foot", fit: 500, unavailable: [] }, { categoryId: "infantry", label: "Hired Greeks and Campanians", fit: 500, unavailable: [] }],
    },
  ];
  const obligation = {
    id: "carthage-sicilian-hired-men", kind: "army_upkeep", label: "The hired men of Carthage in Sicily", payerAccountId: "carthage-treasury", amount: 52_000, cadenceSteps: 30, nextDueStep: 30,
    priority: 850, arrears: 0, missedPeriods: 0, active: true,
  };
  return {
    ...world,
    characters: [...world.characters, ...characters] as WorldState["characters"],
    material: {
      ...world.material,
      accounts: [...world.material.accounts, ...accounts] as WorldState["material"]["accounts"],
      obligations: [...world.material.obligations, obligation] as WorldState["material"]["obligations"],
      forces: [...world.material.forces, ...forces] as WorldState["material"]["forces"],
    },
  };
}

