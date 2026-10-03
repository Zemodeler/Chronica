import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  boundedId,
  mintTroopCategory,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Four orders from a live campaign in another game, and what this engine made
 * of them before this pass.
 *
 * Gaius Furius rallies the Gauls at the Rhine, buys passage through Illyria and
 * fights the Macedonian phalanx at the Aoos with a hammer and an anvil. Marcus
 * Caecilius Metellus goes to Egypt for a wife. Quintus Valerius Agrippinus
 * raids the Samnites, sends the loot home, stands for tribune and lies in wait
 * in a pass. Put through the engine, every one of them either could not be
 * said, was refused out of the player's sight, or was carried out in a way
 * that changed nothing a battle computes:
 *
 * - there was no tribune, and a seat in an office nobody had made was refused
 *   as a malformed payload the player never heard about;
 * - "military access" had no word, and borders meant nothing anyway;
 * - nothing could marry anybody or move a person anywhere;
 * - a raid could only burn a province, bank nothing, and could burn your own;
 * - every Balkan and Gallic province was flat as far as the battle resolver
 *   could tell, because the table knew `hills` and the map said `hills-uplands`;
 * - a tactic was worth whatever its author asked, so four paragraphs of
 *   maniples earned what "I attack cleverly" earned;
 * - the Gauls in the valley could only be a second battle, which the enemy
 *   then fought twice and always lost.
 *
 * Each of these is now the world answering, in the player's hearing.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

const RHINE = PUNIC_IDS.rhine;
const SAMNIUM = PUNIC_IDS.bovianum;
const LATIUM = PUNIC_IDS.rome;
const BERAT = PUNIC_IDS.berat; // hills-uplands, on the Aoos
const GJIROKASTER = PUNIC_IDS.gjirokaster; // hills-uplands, the Aoos-side ground beside Berat
const COAST = PUNIC_IDS.carthage; // coastal-plain

/** The opening world, with the three of them in it and Quintus's horse. */
/**
 * Every commander on the field willing to fight the day battle is offered. An
 * order to attack now opens an engagement that a cautious defender may meet
 * by keeping to his camp (`engagements.ts`); what is tested here is the
 * battle itself.
 */
const readyToFight = (state: WorldState): WorldState => ({
  ...state,
  characters: state.characters.map((character) => (state.material.forces.some((force) => force.commanderCharacterId === character.id)
    ? { ...character, mind: { ...character.mind, temperament: { ...character.mind.temperament, caution: 20 } } }
    : character)),
});

function world(): WorldState {
  const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const template = base.characters.find((character) => character.id === "quintus-ogulnius")!;
  const people: [string, string, string][] = [
    ["gaius-furius", "Gaius Furius", RHINE],
    ["quintus-agrippinus", "Quintus Valerius Agrippinus", SAMNIUM],
    ["marcus-metellus", "Marcus Caecilius Metellus", LATIUM],
  ];
  const legion = base.material.forces.find((force) => force.id === "roman-field-army")!;
  const aPurse = base.material.accounts.find((account) => account.owner.kind === "character")!;
  return {
    ...base,
    characters: [
      ...base.characters,
      ...people.map(([id, name, where]) => ({ ...structuredClone(template), id, name, locationProvinceId: where, officeId: null })),
    ],
    material: {
      ...base.material,
      accounts: [...base.material.accounts, { ...structuredClone(aPurse), id: "furius-purse", owner: { kind: "character", id: "gaius-furius" }, balance: 20_000 }],
      forces: [
        ...base.material.forces,
        {
          ...structuredClone(legion),
          id: "silver-shields", name: "Scuta Argentea",
          commanderCharacterId: "quintus-agrippinus", controllerCharacterId: "quintus-agrippinus",
          locationId: SAMNIUM, positionId: null, authorizedStrength: 100, payObligationId: null,
          personnel: [{ ...structuredClone(legion.personnel[0]!), categoryId: "cavalry", label: "Horse", fit: 97 }],
        },
      ],
    },
  };
}

const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("rhine"),
  gameId: "game-rhine",
});

function order(actor: string, written: readonly unknown[], state: WorldState = world()) {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const result = applyDeltas(state, deltas, context(actor));
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
}

describe("Quintus is made a military tribune", () => {
  // Rome has military tribunes: sixteen elected in the tribes, and the rest
  // named by the consuls. The consul names him; a man who seats himself with
  // nobody behind him is not obeyed (see the next block).
  it("seats him among the tribunes, instead of refusing out of his sight", () => {
    const result = order("gaius-genucius", [{
      op: "office_seat_set", officeId: "roman-military-tribune", officeLabel: "Military Tribune",
      holderCharacterRef: "quintus-agrippinus", reason: "Named tribune for the Samnite war.",
    }]);

    expect(result.rejected).toEqual([]);
    expect(result.world.material.officeSeats.some((seat) => seat.officeId === "roman-military-tribune" && seat.holderCharacterId === "quintus-agrippinus")).toBe(true);
  });

  it("does not open a second tribunate beside the one Rome has", () => {
    const first = order("gaius-genucius", [{
      op: "office_seat_set", officeId: "tribune-a", officeLabel: "Military Tribune", holderCharacterRef: "quintus-agrippinus", reason: "One.",
    }]);
    const second = order("gaius-genucius", [{
      op: "office_seat_set", officeId: "tribune-b", officeLabel: "Military Tribune", holderCharacterRef: "marcus-metellus", reason: "Another.",
    }], first.world);

    expect(second.world.offices.filter((office) => /military tribune/i.test(office.label))).toHaveLength(0);
    const tribunes = second.world.material.officeSeats.filter((seat) => seat.officeId === "roman-military-tribune" && seat.status === "held").map((seat) => seat.holderCharacterId);
    expect(tribunes).toEqual(expect.arrayContaining(["quintus-agrippinus", "marcus-metellus"]));
  });
});

describe("a man who names himself to an office with nobody behind him", () => {
  it("is not obeyed, and it is seen", () => {
    const result = order("quintus-agrippinus", [{
      op: "office_seat_set", officeId: "roman-consul", holderCharacterRef: "quintus-agrippinus", reason: "He proclaims himself consul.",
    }]);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("ignored");
    expect(result.world.material.officeSeats.some((seat) => seat.holderCharacterId === "quintus-agrippinus")).toBe(false);
  });

  it("may leave his own seat without anybody's leave", () => {
    const seated = order("gaius-genucius", [{
      op: "office_seat_set", officeId: "tribune-a", officeLabel: "Military Tribune", holderCharacterRef: "quintus-agrippinus", reason: "Seated.",
    }]);
    const tribunate = seated.world.material.officeSeats.find((seat) => seat.holderCharacterId === "quintus-agrippinus")!;
    const left = order("quintus-agrippinus", [{
      op: "office_seat_set", officeId: tribunate.officeId, holderCharacterRef: null, cause: "resignation", reason: "He lays it down.",
    }], seated.world);

    expect(left.rejected).toEqual([]);
    expect(left.world.material.officeSeats.some((seat) => seat.holderCharacterId === "quintus-agrippinus")).toBe(false);
  });
});

describe("Gaius asks the Illyrians for passage", () => {
  const into = (state: WorldState) => order("gaius-furius", [{
    op: "force_modify", forceRef: "roman-field-army", locationId: BERAT, reason: "Down through Illyria.",
  }], state);

  /** The legion standing on the Illyrian border, one step from Berat. */
  function atTheBorder(): WorldState {
    const base = world();
    const edge = base.map.edges.find((candidate) => candidate.to === BERAT || candidate.from === BERAT)!;
    const next = edge.to === BERAT ? edge.from : edge.to;
    return {
      ...base,
      map: { ...base.map, provinces: base.map.provinces.map((province) => (province.id === next ? { ...province, controllerPolityId: "rome" } : province)) },
      // His own army now -- an order to somebody else's is not obeyed at all.
      material: {
        ...base.material,
        forces: base.material.forces.map((force) => (force.id === "roman-field-army"
          ? { ...force, locationId: next, commanderCharacterId: "gaius-furius", controllerCharacterId: "gaius-furius" }
          : force)),
      },
    };
  }

  it("has a word for it now", () => {
    const result = order("gaius-furius", [{
      op: "agreement_open", localId: "passage", kind: "military_access", polityId: "rome", otherPolityId: "illyria-taulantii",
      terms: "Roman armies may cross Taulantian land; Gaius Furius pays in gold.", reason: "The Taulantii accept the gold.",
    }]);
    expect(result.rejected).toEqual([]);
    expect(result.world.polityAgreements.at(-1)!.kind).toBe("military_access");
  });

  it("tells the Illyrians when a Roman army walks in unasked", () => {
    const result = into(atTheBorder());
    expect(result.rejected).toEqual([]);
    const trespass = result.factProposals.find((fact) => fact.kind === "trespass")!;
    expect(trespass.summary).toContain("without leave");
    expect(trespass.affectedRefs).toContainEqual({ kind: "polity", id: "illyria-taulantii" });
  });

  it("is silent about it once passage was granted", () => {
    const granted = order("gaius-furius", [{
      op: "agreement_open", localId: "passage", kind: "military_access", polityId: "rome", otherPolityId: "illyria-taulantii",
      terms: "Passage for pay.", reason: "Granted.",
    }], atTheBorder());
    const result = into(granted.world);
    expect(result.factProposals.some((fact) => fact.kind === "trespass")).toBe(false);
  });
});

describe("Marcus goes to Egypt for a wife", () => {
  it("travels, and the bride he finds is his wife in the record the succession reads", () => {
    const result = order("marcus-metellus", [
      { op: "character_state_set", characterRef: "marcus-metellus", moveToProvinceId: PUNIC_IDS.carthage, reason: "He sails south." },
      {
        op: "character_create", localId: "bride", name: "Berenike", polityId: "ptolemaic-cyrenaica", provinceId: null, age: 20,
        officeLabel: null, traits: [], kin: { ofCharacterRef: "marcus-metellus", relation: "spouse_or_partner" },
        generatedBecause: "Marcus sought a wife abroad.",
      },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.world.characters.find((character) => character.id === "marcus-metellus")!.locationProvinceId).toBe(PUNIC_IDS.carthage);
    const bride = result.world.characters.find((character) => character.name === "Berenike")!;
    expect(result.world.familyLinks).toContainEqual(expect.objectContaining({ characterId: bride.id, relatedCharacterId: "marcus-metellus", kind: "spouse_or_partner" }));
  });
});

describe("the world's own generals are as good as the world says", () => {
  it("makes Craterus a gifted soldier and not a man of martial 35", () => {
    // Gonatas himself has been seated in Macedon since v34; his half-brother
    // Craterus, who held Corinth for him, is the world's to make.
    const result = order("gaius-furius", [{
      op: "character_create", localId: "craterus", name: "Craterus", polityId: "macedon", provinceId: null, age: 45,
      officeLabel: null, traits: [], skills: { martial: "gifted", diplomacy: "able" },
      generatedBecause: "Macedon's general at Corinth.",
    }]);
    const gonatas = result.world.characters.find((character) => character.name === "Craterus")!;
    expect(gonatas.skills.martial).toBe(72);
    expect(gonatas.skills.diplomacy).toBe(60);
  });
});

describe("Quintus raids the Samnites", () => {
  it("refuses to burn an ally's country without a war, in words the player hears", () => {
    // The Samnites are Rome's allies by foedus at the opening.
    const result = order("quintus-agrippinus", [{ op: "force_raid", forceRef: "silver-shields", provinceId: SAMNIUM, reason: "Into the Samnite hills." }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("world");
    expect(result.rejected[0]!.reason).toContain("sworn allies");
  });

  it("refuses to burn his own country", () => {
    const home = world();
    const inRome: WorldState = {
      ...home,
      map: { ...home.map, provinces: home.map.provinces.map((province) => (province.id === SAMNIUM ? { ...province, controllerPolityId: "rome" } : province)) },
    };
    const result = order("quintus-agrippinus", [{ op: "force_raid", forceRef: "silver-shields", provinceId: SAMNIUM, reason: "Into the hills." }], inRome);
    expect(result.rejected[0]!.reason).toContain("own land");
  });

  it("strips an enemy province and sends the loot to Rome", () => {
    const hostile = world();
    const samnites: WorldState = {
      ...hostile,
      map: { ...hostile.map, provinces: hostile.map.provinces.map((province) => (province.id === SAMNIUM ? { ...province, controllerPolityId: "messapians" } : province)) },
    };
    const treasury = (state: WorldState) => state.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
    const result = order("quintus-agrippinus", [{
      op: "force_raid", forceRef: "silver-shields", provinceId: SAMNIUM, toAccountRef: "rome-treasury", reason: "Loot sent home.",
    }], samnites);

    expect(result.rejected).toEqual([]);
    expect(treasury(result.world)).toBeGreaterThan(treasury(samnites));
    expect(result.factProposals.find((fact) => fact.kind === "province_raided")!.affectedRefs).toContainEqual({ kind: "polity", id: "messapians" });
  });
});

describe("the battle at the Aoos", () => {
  /** Gaius's legion and his Gauls, and a Macedonian phalanx, all at Berat. */
  function theAoos(where: string = BERAT): WorldState {
    const base = world();
    const legion = base.material.forces.find((force) => force.id === "roman-field-army")!;
    const phalanx = mintTroopCategory("phalangites", { label: "Phalangites", weightBand: "heavy", steadinessBand: "stubborn", mobilityBand: "slow" });
    const gonatas = { ...structuredClone(base.characters.find((character) => character.id === "hanno-carthage")!), id: "gonatas", name: "Antigonus Gonatas", polityId: "macedon" };
    const army = (id: string, name: string, polityId: string, commander: string, personnel: { categoryId: string; fit: number }[]) => ({
      ...structuredClone(legion), id, name, polityId, commanderCharacterId: commander, controllerCharacterId: commander,
      locationId: where, positionId: null, payObligationId: null,
      authorizedStrength: personnel.reduce((sum, row) => sum + row.fit, 0),
      personnel: personnel.map((row) => ({ ...structuredClone(legion.personnel[0]!), label: row.categoryId, ...row })),
    });
    return {
      ...base,
      troopCategories: [phalanx],
      characters: [...base.characters, gonatas],
      polityAgreements: [...base.polityAgreements, {
        id: "war-macedon", kind: "war", polityId: "rome", otherPolityId: "macedon", terms: "Over Epirus.",
        sinceStep: 0, untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
      }],
      material: {
        ...base.material,
        forces: [
          ...base.material.forces,
          army("furius-legion", "Furius's legionaries", "rome", "gaius-furius", [{ categoryId: "infantry", fit: 3_000 }]),
          army("furius-gauls", "Furius's Gauls", "rome", "gaius-furius", [{ categoryId: "infantry", fit: 7_000 }]),
          army("macedonian-army", "Macedonian phalanx", "macedon", "gonatas", [{ categoryId: "phalangites", fit: 10_000 }, { categoryId: "cavalry", fit: 1_000 }]),
        ],
      },
    };
  }

  const engage = (state: WorldState, tactic: unknown, extra: Record<string, unknown> = {}) => order("gaius-furius", [{
    op: "force_engage", forceRef: "furius-legion", targetForceRef: "macedonian-army", posture: "offer_battle", tactic,
    reason: "Hammer and anvil at the Aoos.", ...extra,
  }], readyToFight(state));

  it("fights the Gauls in the same battle as the legion, not in a second one", () => {
    const result = engage(theAoos(), null);
    const battle = result.world.conflicts.battles.at(-1)!;
    expect(battle.attackerForceIds).toEqual(["furius-legion", "furius-gauls"]);
    expect(result.world.conflicts.battles).toHaveLength(1);
  });

  it("refuses a plan that rests on nothing, however well it is written", () => {
    const result = engage(theAoos(), {
      factor: "deployment", magnitude: "meaningful",
      rationale: "Maniples into the gaps of the phalanx, the Gauls hammering in from the hidden valleys.",
    });
    expect(result.battleAccounts[0]!.tactics).toEqual([]);
    expect(result.battleAccounts[0]!.refusedTactics[0]).toContain("nothing the field could bear out");
  });

  it("grants it at the size asked only when two things on the field bear it out", () => {
    const plan = (restsOn: string[]) => ({ factor: "deployment", magnitude: "meaningful", rationale: "Hammer and anvil.", restsOn });

    // A second army is really there; the cavalry he claims is not.
    const one = engage(theAoos(), plan(["second_force", "superior_horse"]));
    expect(one.battleAccounts[0]!.tactics[0]).toContain("(minor)");

    // Broken country that slows a phalanx more than his men, and the Gauls.
    const two = engage(theAoos(), plan(["second_force", "rough_ground"]));
    expect(two.battleAccounts[0]!.tactics[0]).toContain("(meaningful)");
  });

  it("finds rough ground in the uplands beside the Aoos, and none on a coast", () => {
    const tactic = { factor: "deployment", magnitude: "meaningful", rationale: "Onto the rough ground.", restsOn: ["rough_ground"] };
    // Gjirokaster is hills-uplands, like Berat: the ground bears the plan out, but one thing alone is not enough.
    expect(engage(theAoos(GJIROKASTER), { ...tactic, restsOn: ["second_force", "rough_ground"] }).battleAccounts[0]!.tactics[0]).toContain("(meaningful)");
    expect(engage(theAoos(COAST), tactic).battleAccounts[0]!.tactics).toEqual([]);
  });
});

describe("an id built from other ids", () => {
  it("stays inside the schema's length and stays unique", () => {
    const long = boundedId("battle-8f0c2d4e-5b6a-4c3d-9e8f-7a6b5c4d3e2f-12", "force-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-7", "numidian-light-cavalry-of-the-desert", "deserted");
    const other = boundedId("battle-8f0c2d4e-5b6a-4c3d-9e8f-7a6b5c4d3e2f-12", "force-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-7", "numidian-light-cavalry-of-the-desert", "dead");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).not.toBe(other);
    expect(boundedId("battle-1", "force-2")).toBe("battle-1:force-2");
  });
});

describe("Gaius rallies the Gauls at the Rhine", () => {
  const rally = {
    op: "force_create", localId: "gauls", name: "The Gallic host of Gaius Furius", polityId: "rome",
    commanderCharacterRef: "gaius-furius", controllerCharacterRef: "gaius-furius", locationId: RHINE, authorizedStrength: 6_000,
    reason: "Gauls rally to a promise of citizenship.",
  };
  const unifiedGallia = {
    op: "polity_create", localId: "gallia", name: "Unified Gallia", breaksFromPolityId: "gaul-sequani",
    provinceIds: [RHINE], reason: "Gaius Furius proclaims a united Gaul.",
  };

  it("raises nobody on a promise, and the whole Rhine hears about it", () => {
    const result = order("gaius-furius", [rally, unifiedGallia]);
    expect(result.rejected.map((rejection) => rejection.kind)).toEqual(["ignored", "ignored"]);
    expect(result.world.material.forces.some((force) => force.name === rally.name)).toBe(false);
    expect(result.world.map.polities.some((polity) => polity.name === "Unified Gallia")).toBe(false);
    expect(result.rejected[1]!.reason).toContain("fine one");
  });

  it("raises a band he pays for himself, and a band can make a country", () => {
    const result = order("gaius-furius", [
      {
        op: "obligation_upsert", localId: "wages", obligationRef: null, kind: "army_pay", label: "Wages of the Gallic host",
        payerAccountRef: "furius-purse", recipientAccountRef: null, amount: 300, cadenceDays: 30, reason: "Gaius pays in gold.",
      },
      { ...rally, payObligationRef: "local:wages" },
      unifiedGallia,
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.world.map.polities.some((polity) => polity.name === "Unified Gallia")).toBe(true);
  });
});

describe("a reference that is almost right", () => {
  // Every case here was a refusal in a live run of these orders.
  it("finds a province from its name where its id was meant", () => {
    // Ids are nine opaque characters now, too short to be a truncation of anything.
    const name = world().map.provinces.find((province) => province.id === BERAT)!.name;
    const result = order("quintus-agrippinus", [{
      op: "province_material_shift", provinceId: name, stabilityBpsDelta: -100, reason: "Unrest on the Aoos.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("pays from the purse of whoever was named instead of their purse", () => {
    const result = order("gaius-furius", [{
      op: "money_transfer", fromAccountRef: "gaius-furius", toAccountRef: null, amount: 100, reason: "Gold for the Illyrians.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("puts a person made 'among a people' in a province that people holds", () => {
    const result = order("gaius-furius", [{
      op: "character_create", localId: "herald", name: "Cingetorix", polityId: "gaul-belgae", provinceId: "gaul-belgae",
      age: 40, officeLabel: null, traits: [], generatedBecause: "A herald of the Belgae.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("pays an arrangement's keep from whoever owns it, when a power owns more than one account", () => {
    const founded = order("gaius-genucius", [{
      op: "generic_entity_create", localId: "shrine", kind: "shrine", label: "The shrine at the ford", ownerRef: { kind: "polity", id: "rome" }, reason: "A shrine.",
    }]);
    const shrine = founded.world.genericEntities.at(-1)!.id;
    const result = order("gaius-genucius", [{ op: "money_transfer", fromAccountRef: shrine, toAccountRef: null, amount: 10, reason: "The shrine's keep." }], founded.world);
    expect(result.rejected).toEqual([]);
  });

  it("takes a province named as somebody's allegiance to mean whoever holds it", () => {
    const result = order("gaius-furius", [{
      op: "character_create", localId: "chief", name: "Ambiorix", polityId: RHINE, provinceId: RHINE, age: 35,
      officeLabel: null, traits: [], generatedBecause: "A chief of the Rhine.",
    }]);
    expect(result.rejected).toEqual([]);
    expect(result.world.characters.find((character) => character.name === "Ambiorix")!.polityId).toBe("gaul-sequani");
  });

  it("makes the king an answer named and never made, and he commands the army he was named for", () => {
    // The world arming Carthage, as the orchestrator does -- not the consul.
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "force_create", localId: "numidians", name: "The Numidian horse", polityId: "carthage",
      commanderCharacterRef: "local:numidian-king", controllerCharacterRef: "local:numidian-king",
      locationId: PUNIC_IDS.carthage, authorizedStrength: 2_000, reason: "Numidia sends horse.",
    })], { ...context("gaius-genucius"), actsForTheWorld: true });
    expect(result.rejected).toEqual([]);
    const king = result.world.characters.find((character) => character.name === "Numidian King")!;
    expect(king.polityId).toBe("carthage");
    expect(result.world.material.forces.at(-1)!.commanderCharacterId).toBe(king.id);
  });

  it("does not make a stand-in for somebody this answer tried to make and could not", () => {
    // Spoken by the world: an act of the actor's own would give the man his
    // actor's country (see `fillGaps`), and be made.
    const deltas = [
      { op: "character_create", localId: "ghost", name: "Nobody", polityId: "no-such-power-at-all", provinceId: null, age: 40, officeLabel: null, traits: [], generatedBecause: "A test." },
      { op: "character_intent_set", actorCharacterRef: "local:ghost", actionType: "prepare", targetRefs: [], rationale: "Anything.", priority: 50, visibility: "private" },
    ].map((raw) => WorldDeltaSchema.parse(raw));
    const result = applyDeltas(world(), deltas, { ...context("gaius-genucius"), actsForTheWorld: true });
    expect(result.rejected).toHaveLength(2);
  });

  it("finds a province an invented id names in words", () => {
    const syracuse = punicWarsScenario.initialWorld.map.provinces.find((province) => province.id === PUNIC_IDS.syracuse)!;
    const result = order("gaius-genucius", [{
      op: "province_material_shift", provinceId: syracuse.name.toLowerCase().replace(/\s+/g, "-"), stabilityBpsDelta: -100, reason: "Unrest at Syracuse.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("puts a motion before the power's own council when its treasury was named instead", () => {
    const result = order("gaius-genucius", [{
      op: "political_procedure_open", localId: "motion", type: "vote", institutionRef: "rome-treasury", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "A tribune for the Samnite war", resolutionMechanism: "vote", reason: "A motion.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("lays a trap without the ambush when the ambushing force was never raised", () => {
    const result = order("quintus-agrippinus", [{
      op: "contingency_arm", localId: "pass", label: "The ambush at the pass", ownerCharacterRef: "quintus-agrippinus",
      trigger: { kind: "force_enters_province", provinceId: SAMNIUM }, effect: "stand_to", provinceId: SAMNIUM,
      ambushForceRef: "local:lucanian-scout-detachment", reason: "Wait for them.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("lets a man petition his own government by letter", () => {
    const result = order("quintus-agrippinus", [{
      op: "diplomatic_message_send", localId: "petition", kind: "letter", fromPolityId: "rome", fromCharacterRef: "quintus-agrippinus",
      toPolityId: "rome", toCharacterRef: "gaius-genucius", subject: "A tribunate for the Samnite war",
      terms: "Quintus asks the consul to put his name before the Senate as tribune.", replyWithinDays: 30, inReplyToRef: null,
      visibility: "polity", reason: "Quintus stands for tribune.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("gives an arrangement nobody owns a fund of its own when an order pays into it", () => {
    const founded = order("gaius-genucius", [{
      op: "generic_entity_create", localId: "guild", kind: "guild", label: "The Shipwrights' Guild of Ostia", ownerRef: null, reason: "A guild.",
    }]);
    const guild = founded.world.genericEntities.at(-1)!.id;
    const result = order("gaius-genucius", [{ op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: guild, amount: 50, reason: "A gift to the guild." }], founded.world);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.accounts.find((account) => account.owner.kind === "entity" && account.owner.id === guild)!.balance).toBe(50);
  });

  it("lets a faction made as an arrangement take sides, as the group it is", () => {
    const made = order("gaius-genucius", [
      { op: "generic_entity_create", localId: "equites", kind: "faction", label: "The Equites", ownerRef: { kind: "polity", id: "rome" }, reason: "The knights organise." },
      {
        op: "political_procedure_open", localId: "motion", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
        subjectKind: "polity", subjectRef: "rome", label: "A tribune for the Samnite war", resolutionMechanism: "vote", reason: "A motion.",
      },
    ]);
    const equites = made.world.genericEntities.at(-1)!.id;
    const motion = made.world.material.politicalProcedures.at(-1)!.id;
    const result = order("gaius-genucius", [{
      op: "political_support_set", procedureRef: motion, supporterKind: "group", supporterRef: equites, position: "support",
      influenceWeight: 40, reasonKind: "group_loyalty", reasonLabel: "One of their own.", reason: "The knights back him.",
    }], made.world);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.politicalGroups.some((group) => group.name === "The Equites")).toBe(true);
  });

  it("treats a cost or an income nobody recorded as a new one", () => {
    const result = order("gaius-genucius", [{
      op: "income_source_upsert", incomeSourceRef: "entity-something-that-is-not-an-income", kind: "trade", label: "Tolls on the Tiber",
      beneficiaryAccountRef: "rome-treasury", amount: 20, cadenceDays: 30, reason: "New tolls.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("sends out a detachment an answer named and never made, from the army it was named after", () => {
    const result = order("quintus-agrippinus", [{
      op: "force_modify", forceRef: "local:silver-shields-scout-detachment", positionId: "the-high-pass",
      newPosition: { label: "The high pass", type: "pass" }, reason: "Scouts up to the pass.",
    }]);
    expect(result.rejected).toEqual([]);
    const scouts = result.world.material.forces.find((force) => force.name === "Silver Shields Scout Detachment")!;
    const parent = result.world.material.forces.find((force) => force.id === "silver-shields")!;
    expect(scouts.personnel[0]!.fit).toBe(19);
    expect(parent.personnel[0]!.fit).toBe(97 - 19);
    expect(scouts.commanderCharacterId).toBe("quintus-agrippinus");
  });

  it("lets an army back a man's campaign, as the military faction it is", () => {
    const made = order("gaius-genucius", [{
      op: "political_procedure_open", localId: "motion", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "Quintus for tribune", resolutionMechanism: "vote", reason: "A motion.",
    }]);
    const motion = made.world.material.politicalProcedures.at(-1)!.id;
    const result = order("gaius-genucius", [{
      op: "political_support_set", procedureRef: motion, supporterKind: "group", supporterRef: "silver-shields", position: "support",
      influenceWeight: 30, reasonKind: "group_loyalty", reasonLabel: "Their captain.", reason: "The Silver Shields back him.",
    }], made.world);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.politicalGroups.find((group) => group.name === "Scuta Argentea")!.type).toBe("military_command");
  });

  it("opens a thread without the participant nobody made", () => {
    const result = order("gaius-genucius", [{
      op: "storyline_open", localId: "pirates", title: "Pirates off Lucania", participantRefs: ["gaius-genucius", "local:lucanian-pirate-squadron"],
      provinceId: PUNIC_IDS.grumentum, stakes: "The coast.", nextDevelopment: "They strike again.", reason: "Pirates.",
    }]);
    expect(result.rejected).toEqual([]);
  });

  it("pays an arrangement made earlier in the same answer by its handle", () => {
    const result = order("gaius-genucius", [
      { op: "generic_entity_create", localId: "academy", kind: "academy", label: "The Academy of Latium", ownerRef: null, reason: "A school." },
      { op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: "local:academy", amount: 30, reason: "An endowment." },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("leaves an arrangement out of a gathering of people, and drops a gathering left with one", () => {
    const result = order("gaius-genucius", [
      { op: "generic_entity_create", localId: "guild", kind: "guild", label: "The guild", ownerRef: null, reason: "A guild." },
      { op: "social_events", events: [
        { participantCharacterRefs: ["gaius-genucius", "quintus-ogulnius", "local:guild"], kind: "favour", visibility: "public", summary: "A dinner." },
        { participantCharacterRefs: ["gaius-genucius", "local:guild"], kind: "promise", visibility: "public", summary: "A promise to the guild." },
      ] },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("draws scouts from the one army their commander leads, when their name says only what they are", () => {
    const result = order("quintus-agrippinus", [{
      op: "force_modify", forceRef: "local:pass_scouts", positionId: "the-high-pass", newPosition: { label: "The high pass", type: "pass" }, reason: "Scouts forward.",
    }]);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.forces.find((force) => force.id === "silver-shields")!.personnel[0]!.fit).toBe(97 - 19);
  });

  it("reads an invented account id as the account of whoever it names", () => {
    const result = order("gaius-genucius", [
      { op: "character_create", localId: "kent-grain-merchant", name: "A grain merchant", polityId: "rome", provinceId: LATIUM, age: 50, officeLabel: null, traits: [], standing: "a merchant", wealth: 500, generatedBecause: "Grain." },
      { op: "money_transfer", fromAccountRef: "kent-grain-merchant-account", toAccountRef: null, amount: 10, reason: "He pays for the grain." },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("finds a project's stage by its number", () => {
    const started = order("gaius-genucius", [{
      op: "project_create", localId: "road", kind: "construction", label: "A road", sponsorRef: { kind: "polity", id: "rome" },
      fundingAccountRef: null, milestones: [{ label: "Surveyed", dueInDays: 10 }, { label: "Paved", dueInDays: 40 }], reason: "A road.",
    }]);
    const project = started.world.projects.at(-1)!;
    const result = order("gaius-genucius", [{ op: "project_milestone_update", projectRef: project.id, milestoneId: "0", status: "completed", reason: "Surveyed." }], started.world);
    expect(result.rejected).toEqual([]);
  });
});
