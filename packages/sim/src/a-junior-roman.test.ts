import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, adjacentTo, materializePlayerCharacter, resolveEligibility,
  type WorldDelta, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";

/**
 * A Roman below the consuls, and what his place lets him do.
 *
 * Played as anything but consul, the republic went wrong in ways that read as
 * one bug each: a legate on the consul's staff was made consul and put Blasio
 * out of his chair; a military tribune was handed four hundred retainers of his
 * own; a pontifex maximus came out a Greek of the Black Sea; a praetor marched
 * off the consul's army and named consuls by decree, while the censors could
 * not enrol a single senator.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "declared-junior";
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function declare(role: string, socioEconomicClass: string, ageYearsAtOpening: number, world = opening()): WorldState {
  const knowledgebase = CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-junior", canonicalName: "Aulus Probus", nickname: null, birthYearApprox: -300, deathYearApprox: null,
    origin: "invented", period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: `A Roman of the year 270 before Christ, whose station is this: ${role}.`, notableEvents: ["Came of age in the war with Pyrrhus."],
    role, authority: [], socioEconomicClass, startingMoney: 300, ageYearsAtOpening,
    skills: { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: {} },
    skillRationale: { martial: "Served." },
    relations: [
      { name: "Probia", relationship: "wife", historical: false, notes: "Keeps the house.", kind: "person", category: "family", familyRole: "partner" },
      ...[1, 2, 3].map((n) => ({ name: `Friend ${n}`, relationship: "friend", historical: false, notes: "An old friend.", kind: "person", category: "other", familyRole: null })),
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  });
  return materializePlayerCharacter(world, PLAYER, knowledgebase, definition.government);
}

const seatsOf = (world: WorldState, who: string) => world.material.officeSeats.filter((seat) => seat.holderCharacterId === who && seat.status === "held").map((seat) => seat.officeId);
const act = (world: WorldState, actor: string, raw: Record<string, unknown>) => {
  const delta: WorldDelta = WorldDeltaSchema.parse(raw);
  return applyDeltas(world, [delta], {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, successionRules: definition.government.successionRules,
    warfare: definition.warfare, ids: createIdFactory(`junior-${actor}-${raw.op as string}`), gameId: "game-junior", playerCharacterId: PLAYER, orderDeltas: new Set([delta]),
  });
};
const army = (world: WorldState) => world.material.forces.find((force) => force.id === "roman-field-army")!;
const marchOrder = (world: WorldState) => ({ op: "force_modify", forceRef: "roman-field-army", locationId: adjacentTo(world, army(world).locationId)[0]!.provinceId, reason: "March." });

describe("declaring a Roman below the consuls", () => {
  it("does not make a man consul for naming the consul he serves", () => {
    for (const role of ["Legate on the consul's staff", "Legionary in the consul's army", "Centurion under the consul Gaius Genucius"]) {
      const world = declare(role, "Plebeian", 30);
      expect(seatsOf(world, PLAYER), role).not.toContain("roman-consul");
      expect(seatsOf(world, "gnaeus-cornelius"), role).toContain("roman-consul");
      expect(world.characters.find((character) => character.id === PLAYER)!.prestigeBps, role).toBeLessThan(7_000);
    }
  });

  it("puts an officer in the legion, not at the head of a private band", () => {
    for (const role of ["Military tribune serving with the Roman field army", "Centurion of the hastati", "Prefect of the allies"]) {
      const world = declare(role, "Equestrian", 28);
      expect(world.material.forces.some((force) => force.commanderCharacterId === PLAYER), role).toBe(false);
      expect(army(world).memberCharacterIds, role).toContain(PLAYER);
    }
    // A tribune of the plebs is neither.
    const tribune = declare("Tribune of the plebs", "Plebeian", 30);
    expect(seatsOf(tribune, PLAYER)).toContain("roman-tribune");
    expect(army(tribune).memberCharacterIds).not.toContain(PLAYER);
  });

  it("reads a pontifex maximus as a Roman", () => {
    const world = declare("Pontifex maximus", "Patrician", 55);
    expect(world.characters.find((character) => character.id === PLAYER)!.polityId).toBe("rome");
    expect(seatsOf(world, PLAYER)).toContain("roman-pontifex-maximus");
  });

  it("gives a declared career the past it says it has", () => {
    const consular = declare("Roman senator and former consul", "Patrician", 50);
    expect(consular.characters.find((character) => character.id === PLAYER)!.officesHeld.map((tenure) => tenure.officeId)).toEqual(["roman-consul"]);
    expect(seatsOf(consular, PLAYER)).toEqual(["roman-senator"]);
    // The lex Genucia's ten years run from it.
    const consulship = offices.find((office) => office.id === "roman-consul")!;
    expect(resolveEligibility(consular, PLAYER, consulship.eligibilityRequirementIds, consulship.id).failedReasons.join(" ")).toMatch(/within ten years|roman-consul/);
  });

  it("makes a military tribune an officer of the legion, elected to it", () => {
    const world = declare("Military tribune", "Equestrian", 25);
    expect(seatsOf(world, PLAYER)).toEqual(["roman-military-tribune"]);
    expect(army(world).memberCharacterIds).toContain(PLAYER);
  });
});

describe("what a Roman's office reaches", () => {
  it("leaves the consul's army to the consul: not his colleague's, not the praetor's, not an officer's", () => {
    const world = opening();
    expect(act(world, "gnaeus-cornelius", marchOrder(world)).applied).toHaveLength(0);
    for (const role of ["Praetor of Rome", "Military tribune serving with the Roman field army"]) {
      const declared = declare(role, "Patrician", 36);
      const result = act(declared, PLAYER, marchOrder(declared));
      expect(result.applied, role).toHaveLength(0);
      expect(army(result.world).locationId, role).toBe(army(declared).locationId);
    }
    // His own general's word still moves it.
    expect(army(act(world, "gaius-genucius", marchOrder(world)).world).locationId).not.toBe(army(world).locationId);
  });

  it("fills a seat only the way its office is filled", () => {
    const world = opening();
    const seized = act(world, "gaius-genucius", { op: "office_seat_set", officeId: "roman-consul", holderCharacterRef: "quintus-ogulnius", reason: "Named." });
    expect(seized.applied[0]?.authority.authorized).toBe(false);
    expect(seized.breaches.length).toBeGreaterThan(0);
    // Nobody names a consul or a censor: the centuries elect them. (Blasio,
    // because Genucius has an army in Latium, and a man with soldiers in the
    // capital can seize a seat -- unlawfully, and on the record.)
    for (const officeId of ["roman-consul", "roman-censor"]) {
      const named = act(world, "gnaeus-cornelius", { op: "office_seat_set", officeId, holderCharacterRef: "quintus-ogulnius", reason: "Named." });
      expect(named.applied, officeId).toHaveLength(0);
      expect(seatsOf(named.world, "quintus-ogulnius"), officeId).not.toContain(officeId);
    }
    // The censor enrols the Senate; a quaestor does not.
    const enrol = { op: "office_seat_set", officeId: "roman-senator", holderCharacterRef: "marcus-novus", reason: "Enrolled." };
    const withNewman = (state: WorldState): WorldState => {
      const curius = state.characters.find((character) => character.id === "manius-curius")!;
      return { ...state, characters: [...state.characters, { ...curius, id: "marcus-novus", name: "Marcus Novus", officeId: null, officesHeld: [], relations: [] }] };
    };
    const censor = withNewman(declare("Roman censor", "Patrician", 50));
    expect(seatsOf(act(censor, PLAYER, enrol).world, "marcus-novus")).toContain("roman-senator");
    const quaestor = withNewman(declare("Roman quaestor", "Plebeian", 27));
    expect(seatsOf(act(quaestor, PLAYER, enrol).world, "marcus-novus")).not.toContain("roman-senator");
  });

  it("tells a tribune of the plebs that he may forbid", () => {
    const world = declare("Tribune of the plebs", "Plebeian", 30);
    const slice = renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices, actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "x", facts: [], dueEvents: [], pendingEvents: [],
    }));
    expect(slice).toContain("forbid, as Tribune of the plebs");
  });
});

describe("Rome's constitution as it stood in 270", () => {
  const consulship = offices.find((office) => office.id === "roman-consul")!;
  const office = (id: string) => offices.find((candidate) => candidate.id === id)!;
  const eligible = (world: WorldState, who: string, officeId: string) => resolveEligibility(world, who, office(officeId).eligibilityRequirementIds, officeId);
  const withRoman = (world: WorldState, id: string, name: string, ordo: "patrician" | "plebeian", extra: Partial<WorldState["characters"][number]> = {}): WorldState => {
    const curius = world.characters.find((character) => character.id === "manius-curius")!;
    return { ...world, characters: [...world.characters, { ...curius, id, name, ordo, officeId: null, officesHeld: [], relations: [], ambitions: [], ...extra }] };
  };

  it("knows every Roman's order, and seats no patrician as tribune of the plebs", () => {
    const world = opening();
    const romans = world.characters.filter((character) => character.polityId === "rome");
    expect(romans.every((character) => character.ordo !== undefined)).toBe(true);
    expect(world.characters.find((character) => character.id === "gaius-genucius")!.ordo).toBe("plebeian");
    expect(world.characters.find((character) => character.id === "gnaeus-cornelius")!.ordo).toBe("patrician");
    const tribunes = world.material.officeSeats.filter((seat) => seat.officeId === "roman-tribune" && seat.status === "held").map((seat) => seat.holderCharacterId);
    expect(tribunes.length).toBeGreaterThan(0);
    expect(tribunes.every((id) => world.characters.find((character) => character.id === id)!.ordo === "plebeian")).toBe(true);
    // A patrician cannot stand for it; nothing waives a man's birth.
    const declared = declare("A Roman noble", "Patrician", 30);
    expect(declared.characters.find((character) => character.id === PLAYER)!.ordo).toBe("patrician");
    expect(eligible(declared, PLAYER, "roman-tribune").failedReasons.join(" ")).toMatch(/plebeians/);
    expect(declare("Tribune of the plebs", "Patrician", 30).characters.find((character) => character.id === PLAYER)!.ordo).toBe("plebeian");
  });

  it("asks no rung below and no age of a candidate, as the law did not -- only the ten years", () => {
    const world = withRoman(opening(), "titus-novus", "Titus Novus", "plebeian", { ageYearsAtStart: 30, prestigeBps: 6_500 });
    expect(eligible(world, "titus-novus", "roman-praetor").eligible).toBe(true);
    expect(eligible(world, "titus-novus", "roman-consul").eligible).toBe(true);
    // A dictator is a consular, by the law that made the office.
    expect(eligible(world, "titus-novus", "roman-dictator").eligible).toBe(false);
    expect(eligible(world, "manius-curius", "roman-consul").eligible).toBe(false);
  });

  it("keeps one consulship a plebeian's", async () => {
    const { holdElections } = await import("./elections");
    // Both chairs empty, and the likeliest men are patricians.
    let world = opening();
    world = withRoman(world, "lucius-aemilius-young", "Lucius Aemilius Barbula Minor", "patrician", { prestigeBps: 9_800 });
    world = withRoman(world, "publius-valerius-young", "Publius Valerius Laevinus", "patrician", { prestigeBps: 9_700 });
    world = {
      ...world,
      material: {
        ...world.material,
        officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-consul"
          ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "never_filled" as const, termStartedAtStep: null, termExpiresAtStep: null }
          : seat)),
      },
    };
    const elected = holdElections({ world, government: definition.government, toDay: 0, ids: createIdFactory("plebeian-consul"), playerCharacterId: null }).world;
    const consuls = seatsHeldIn(elected, "roman-consul");
    expect(consuls).toHaveLength(2);
    expect(consuls.some((id) => elected.characters.find((character) => character.id === id)!.ordo === "plebeian")).toBe(true);
    expect(consuls).toContain("lucius-aemilius-young");
    expect(consulship.ordoSeats?.plebeian).toBe(1);
  });

  it("lets only a magistrate who may convene a chamber lay a question before it", () => {
    const motion = (institutionRef: string, who: string) => ({
      op: "political_procedure_open", localId: "q", type: "vote", institutionRef, sponsorCharacterRef: who, subjectKind: "polity", subjectRef: "rome",
      label: "A law on the price of grain", resolutionMechanism: "vote", deadlineInDays: 20, reason: "Bread.",
    });
    const senator = declare("Roman senator", "Patrician", 45);
    const refused = act(senator, PLAYER, motion("roman-senate", PLAYER));
    expect(refused.applied).toHaveLength(0);
    expect(refused.rejected[0]!.reason).toMatch(/Only a Roman consul.*may put a question to the Senate/);
    expect(act(opening(), "gaius-genucius", motion("roman-senate", "gaius-genucius")).applied).toHaveLength(1);
    // The plebs' council is the tribunes' to call, and nobody else's.
    const tribune = declare("Tribune of the plebs", "Plebeian", 30);
    expect(act(tribune, PLAYER, motion("roman-concilium-plebis", PLAYER)).applied).toHaveLength(1);
    expect(act(opening(), "gaius-genucius", motion("roman-concilium-plebis", "gaius-genucius")).applied).toHaveLength(0);
    // Standing for office is no motion: any man may be put forward.
    const stands = act(senator, PLAYER, { ...motion("roman-comitia-centuriata", PLAYER), type: "nomination", subjectKind: "character", subjectRef: PLAYER, label: "Aulus Probus stands for Roman praetor" });
    expect(stands.applied).toHaveLength(1);
  });

  it("lets a tribune forbid a consul's levy in the city, but not reach his army in the field", () => {
    const tribune = declare("Tribune of the plebs", "Plebeian", 30);
    const interceding = act(tribune, PLAYER, {
      op: "generic_entity_create", localId: "veto", kind: "intercession", label: "Aulus Probus forbids the consul's levy", ownerRef: { kind: "character", id: PLAYER },
      attributes: { against: "gaius-genucius", act: "levy" }, reason: "The plebs have given enough.",
    });
    expect(interceding.applied[0]?.authority.authorized).toBe(true);
    const levy = { op: "force_create", localId: "legio", name: "A third legion", polityId: "rome", commanderCharacterRef: "gaius-genucius", controllerCharacterRef: "gaius-genucius", locationId: PUNIC_IDS.rome, authorizedStrength: 4_000, reason: "War." };
    const blocked = act(interceding.world, "gaius-genucius", levy);
    expect(blocked.applied).toHaveLength(0);
    expect(blocked.rejected[0]!.reason).toMatch(/has interceded against Gaius Genucius Clepsina's levy/);
    // His army, marched out of Latium, is beyond the tribune.
    const away = adjacentTo(interceding.world, army(interceding.world).locationId)[0]!.provinceId;
    const inTheField = { ...interceding.world, material: { ...interceding.world.material, forces: interceding.world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: away } : force)) } };
    expect(act(inTheField, "gaius-genucius", { op: "force_modify", forceRef: "roman-field-army", locationId: army(interceding.world).locationId === away ? PUNIC_IDS.rome : adjacentTo(inTheField, away)[0]!.provinceId, reason: "March." }).applied).toHaveLength(1);
    // Retired, the levy goes ahead.
    const entityId = interceding.assignedIds.get("veto")!;
    const lifted = act(interceding.world, PLAYER, { op: "generic_entity_update", entityRef: entityId, retire: true, reason: "He relents." });
    expect(act(lifted.world, "gaius-genucius", levy).applied).toHaveLength(1);
  });

  it("makes a man who kills a sitting tribune accursed", () => {
    const world = opening();
    const tribuneId = seatsHeldIn(world, "roman-tribune")[0]!;
    const before = world.characters.find((character) => character.id === "gaius-genucius")!.prestigeBps;
    const killed = act(world, "gaius-genucius", { op: "character_death", characterRef: tribuneId, manner: "duel", byCharacterRef: "gaius-genucius", reason: "A quarrel in the Forum." });
    const sacrilege = killed.factProposals.find((fact) => fact.kind === "sacrilege");
    expect(sacrilege?.visibility).toBe("public");
    expect(sacrilege?.summary).toContain("sacrosanct");
    expect(killed.world.characters.find((character) => character.id === "gaius-genucius")!.prestigeBps).toBeLessThan(before);
  });

  it("takes a legion in the city to seize a seat, not a band of retainers", () => {
    // Genucius has seven thousand men in Latium; a merchant's four hundred hired swords are a riot.
    const seized = act(opening(), "gaius-genucius", { op: "office_seat_set", officeId: "roman-consul", holderCharacterRef: "quintus-ogulnius", reason: "By force." });
    expect(seized.applied).toHaveLength(1);
    const merchant = declare("Captain of a company of hired swords", "Merchant", 40);
    const band = merchant.material.forces.find((force) => force.commanderCharacterId === PLAYER);
    expect(band).toBeDefined();
    const tried = act(merchant, PLAYER, { op: "office_seat_set", officeId: "roman-consul", holderCharacterRef: PLAYER, reason: "By force." });
    expect(tried.applied).toHaveLength(0);
  });
});

function seatsHeldIn(world: WorldState, officeId: string): string[] {
  return world.material.officeSeats.filter((seat) => seat.officeId === officeId && seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!);
}
