import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { CharacterKnowledgebaseSchema, type CharacterKnowledgebase } from "./knowledgebase";
import { deriveAuthoritySummary } from "./authority-projection";
import { findCommandForRole, findOfficeSeatForRole, findPolityForRole, materializePlayerCharacter } from "./player-materialization";

// A declared player who researched their way into a consulship must actually
// hold it. These tests use the real Punic Wars scenario and the shape of role
// text the character-declaration model actually produces.

const PLAYER = "declared-4cee71cf";
const LATIUM = "punic-italy-latium";
const government = punicWarsScenario.definition.government;

const world = (): WorldState => structuredClone(punicWarsScenario.initialWorld);

/** Verbatim from a real declared character: a role is a sentence, not a title. */
const CONSUL_ROLE = "Consul of the Roman Republic, directing senatorial policy and preparing Roman military operations";

/** Parsed rather than cast, so a field the projection starts reading cannot be quietly absent. */
function knowledgebase(overrides: Partial<CharacterKnowledgebase> = {}): CharacterKnowledgebase {
  return CharacterKnowledgebaseSchema.parse({
    version: 1,
    characterId: PLAYER,
    gameId: "game-under-test",
    canonicalName: "Lucius Papirius Carbo",
    nickname: null,
    birthYearApprox: -305,
    deathYearApprox: null,
    origin: "invented",
    period: "270 BCE",
    locationProvinceId: LATIUM,
    culture: "Roman",
    faith: null,
    biography: "A senator of the Papirii, elected consul for the year and charged with Rome's answer to the Mamertine appeal from Messana.",
    notableEvents: ["Elected consul."],
    role: CONSUL_ROLE,
    authority: [],
    socioEconomicClass: "Patrician",
    startingMoney: 900,
    skills: { martial: 55, intrigue: 45, learning: 50, piety: 45, stewardship: 55, diplomacy: 60, body: 50, subSkills: {} },
    skillRationale: { martial: "Served with the legions." },
    relations: [
      { name: "Papiria", relationship: "wife", historical: false, notes: "Manages the household.", kind: "person", category: "family", familyRole: "partner" },
      { name: "Lucius Papirius the Younger", relationship: "son", historical: false, notes: "Of military age.", kind: "person", category: "family", familyRole: "child" },
      { name: "Quintus Fabius", relationship: "rival senator", historical: false, notes: "Opposes intervention in Sicily.", kind: "person", category: "other", familyRole: null },
      { name: "Appius Claudius", relationship: "political ally", historical: false, notes: "Argues for crossing to Messana.", kind: "person", category: "other", familyRole: null },
    ],
    confirmedByPlayer: true,
    confirmationDraft: null,
    ...overrides,
  });
}

describe("findOfficeSeatForRole", () => {
  it("matches an office named inside a descriptive role sentence", () => {
    // The old substring test asked whether "roman consul" appeared inside the
    // role text. It does not, in any role a model actually writes.
    const matched = findOfficeSeatForRole(world(), government, "rome", CONSUL_ROLE);
    expect(matched?.office.id).toBe("roman-consul");
  });

  it("finds the free seat when a colleague already holds the other", () => {
    const matched = findOfficeSeatForRole(world(), government, "rome", CONSUL_ROLE);
    expect(matched?.vacantSeatId).toBe("roman-consul:seat:1");
  });

  it("does not hand a consulship to a senator who never claimed one", () => {
    // A senator is seated in the Senate, which is an office of its own now -- never the consulship.
    expect(findOfficeSeatForRole(world(), government, "rome", "Roman senator without current military command")?.office.id).toBe("roman-senator");
    expect(findOfficeSeatForRole(world(), government, "rome", "Military tribune serving with the Roman field army")).toBeUndefined();
  });

  it("does not seat a foreigner in another polity's office", () => {
    expect(findOfficeSeatForRole(world(), government, "carthage", CONSUL_ROLE)).toBeUndefined();
  });

  it("refuses when every seat of the office is held", () => {
    const base = world();
    const full = WorldStateSchema.parse({
      ...base,
      material: {
        ...base.material,
        officeSeats: base.material.officeSeats.map((seat) => seat.id === "roman-consul:seat:1"
          ? { ...seat, holderCharacterId: "hieron-ii", status: "held", vacancyCause: "none", termStartedAtStep: 0 }
          : seat),
      },
    });
    expect(findOfficeSeatForRole(full, government, "rome", CONSUL_ROLE)).toBeUndefined();
  });
});

describe("a declared consul at game start", () => {
  it("holds the consulship, and Authority says so", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase(), government);

    const character = projected.characters.find((candidate) => candidate.id === PLAYER);
    expect(character?.officeId).toBe("roman-consul");
    const seat = projected.material.officeSeats.find((candidate) => candidate.holderCharacterId === PLAYER);
    expect(seat?.id).toBe("roman-consul:seat:1");
    expect(seat?.status).toBe("held");

    // The reported bug, end to end.
    const authority = deriveAuthoritySummary(projected, PLAYER, government);
    expect(authority).toContain("Roman consul of Roman Republic");
    expect(authority).not.toEqual(["No current public office"]);
  });

  it("does not displace the sitting consul", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase(), government);
    const colleague = projected.material.officeSeats.find((seat) => seat.id === "roman-consul:seat:0");
    expect(colleague?.holderCharacterId).toBe("gaius-genucius");
    expect(deriveAuthoritySummary(projected, "gaius-genucius", government)).toContain("Roman consul of Roman Republic");
  });

  it("still produces a valid world, purse and all", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase(), government);
    expect(WorldStateSchema.safeParse(projected).success).toBe(true);
    const character = projected.characters.find((candidate) => candidate.id === PLAYER);
    const account = projected.material.accounts.find((candidate) => candidate.id === character?.personalAccountId);
    expect(account?.balance).toBe(900);
  });

  it("holds no office when the declared role claims none", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase({ role: "Roman landowner without any public charge" }), government);
    expect(projected.characters.find((candidate) => candidate.id === PLAYER)?.officeId).toBeNull();
    expect(deriveAuthoritySummary(projected, PLAYER, government)).toEqual(["No current public office"]);
  });

  it("is a no-op once the character is really in the snapshot", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase(), government);
    expect(materializePlayerCharacter(projected, PLAYER, knowledgebase(), government)).toBe(projected);
  });
});

describe("a declared soldier", () => {
  const LEGATE_ROLE = "Legate of the Sicilian legions, commanding Roman troops in the field";

  it("is given men to command, because command authority comes from a force and never from a title", () => {
    // `findOfficeSeatForRole` was the only path from a declared character to
    // real power, and it only ever found an office -- so a player who declared
    // himself a legate got nothing at all, and the world was never told he was
    // a soldier.
    const after = materializePlayerCharacter(world(), PLAYER, knowledgebase({ role: LEGATE_ROLE }), government);
    const commanded = after.material.forces.filter(
      (force) => force.commanderCharacterId === PLAYER || force.controllerCharacterId === PLAYER,
    );
    expect(commanded.length).toBeGreaterThan(0);
  });

  it("leaves a man who commands nothing commanding nothing", () => {
    const after = materializePlayerCharacter(world(), PLAYER, knowledgebase({ role: "Grain merchant of Ostia, shipping to the southern ports" }), government);
    expect(after.material.forces.some((force) => force.commanderCharacterId === PLAYER)).toBe(false);
  });

  it("makes the same world every time, being a projection re-run by read paths", () => {
    const once = materializePlayerCharacter(world(), PLAYER, knowledgebase({ role: LEGATE_ROLE }), government);
    const twice = materializePlayerCharacter(once, PLAYER, knowledgebase({ role: LEGATE_ROLE }), government);
    expect(twice.material.forces.length).toBe(once.material.forces.length);
  });
});

describe("whose man the player actually is", () => {
  it("makes a declared Roman consul a Roman, wherever he is standing", () => {
    // From a live game, and it looked like five separate bugs. A player who
    // declared "a Roman consul charged with the northern frontier" was placed
    // on the Insubrian Plain -- which is where the northern frontier is -- and
    // came out an Insubrian. His retinue was Insubrian, the legion Rome raised
    // for him was Insubrian, a Roman consul refused his orders on the grounds
    // that a Roman consul takes orders from Rome, and requisitioning supplies
    // in Insubria was recorded as a breach against his own country.
    const world = { map: { polities: [{ id: "rome", name: "Roman Republic" }, { id: "insubres", name: "Insubres" }, { id: "carthage", name: "Carthage" }] } };
    expect(findPolityForRole(world, "Consul of the Roman Republic, commanding a field army", "Roman Patrician")).toBe("rome");
  });

  it("reads the culture when the role names no power", () => {
    const world = { map: { polities: [{ id: "rome", name: "Roman Republic" }, { id: "carthage", name: "Carthage" }] } };
    expect(findPolityForRole(world, "A merchant of the inland roads", "Carthaginian trader")).toBe("carthage");
  });

  it("says nothing about a description that names no power, so the ground still answers", () => {
    const world = { map: { polities: [{ id: "rome", name: "Roman Republic" }, { id: "insubres", name: "Insubres" }] } };
    expect(findPolityForRole(world, "A shepherd", "Hill people")).toBeUndefined();
  });

  it("prefers the fuller match", () => {
    const world = { map: { polities: [{ id: "rome-city", name: "Rome" }, { id: "rome", name: "Roman Republic" }] } };
    expect(findPolityForRole(world, "Consul of the Roman Republic", "Roman")).toBe("rome");
  });
});

describe("findCommandForRole and the tribunes", () => {
  it("gives a military tribune a command and a tribune of the plebs none", () => {
    expect(findCommandForRole(world(), "rome", "Military tribune of the second legion", LATIUM)).toBeDefined();
    expect(findCommandForRole(world(), "rome", "Tribune of the plebs, defender of the people", LATIUM)).toBeUndefined();
  });
});

describe("who a declared player is, as they declared it", () => {
  it("keeps their faith, their age and their sex", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase({ faith: "The Roman gods", ageYearsAtOpening: 23, gender: "female" }), government);
    const player = projected.characters.find((candidate) => candidate.id === PLAYER)!;
    expect(player.faithId).toBe("faith-roman");
    expect(player.ageYearsAtStart).toBe(23);
    expect(player.gender).toBe("female");
  });

  it("founds a faith nobody had named, rather than dropping it", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase({ faith: "The mysteries of Samothrace" }), government);
    expect(projected.faiths.some((faith) => faith.name === "The mysteries of Samothrace")).toBe(true);
  });

  it("gives a slave no office and no command, whatever his role says", () => {
    const projected = materializePlayerCharacter(world(), PLAYER, knowledgebase({ legalStatus: "enslaved" }), government);
    const player = projected.characters.find((candidate) => candidate.id === PLAYER)!;
    expect(player.legalStatus).toBe("enslaved");
    expect(player.officeId).toBeNull();
    expect(projected.material.forces.some((force) => force.commanderCharacterId === PLAYER)).toBe(false);
  });
});
