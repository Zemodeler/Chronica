import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldDeltaSchema, admissionRefusal, commandBar, gensById, mayAct, priestlyBar, priestlyTaboo, readDepartments, type Office, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { adoptIntoGens } from "./adoption";
import { keepGentes } from "./gentes";
import { killCharacter } from "./mortality";
import { named, opening, withDay } from "./gentes-test-kit";

/**
 * The rites of a family stayed with it: the Fabii's on the Quirinal were carried by a Fabius, and when he died by another, never by a
 * stranger. The old priesthoods (the king of the rites, the flamines, the Salii) were the patricians', by birth, whatever the plebs
 * had won of the pontificate and the augurate in 300.
 */
describe("the sacra stay in the gens", () => {
  const start = opening();

  it("has a keeper of the gens, who is its living man", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    expect(keeper.dynastyId).toBe("gens-fabius");
    expect(keeper.alive).toBe(true);
    expect(keeper.gender).toBe("male");
  });

  it("passes to another man of the gens when the keeper dies, and never to a stranger", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const dead = killCharacter(withDay(start, 40), keeper.id, "a fever", 40).world;
    const kept = keepGentes(withDay(dead, 60), 60).world;
    const now = gensById(kept, "gens-fabius")!;
    expect(now.sacraKeeperId).not.toBeNull();
    expect(now.sacraKeeperId).not.toBe(keeper.id);
    expect(kept.characters.find((character) => character.id === now.sacraKeeperId)!.dynastyId).toBe("gens-fabius");
    expect(now.sacra).toEqual(fabii.sacra);
  });

  it("goes to the heir the keeper named, if the heir is of the gens", () => {
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const heir = named(start, "Gaius Fabius Pictor");
    const named_ = { ...start, characters: start.characters.map((character) => (character.id === keeper.id ? { ...character, heirCharacterId: heir.id } : character)) };
    const dead = killCharacter(withDay(named_, 40), keeper.id, "a fever", 40).world;
    expect(gensById(keepGentes(withDay(dead, 60), 60).world, "gens-fabius")!.sacraKeeperId).toBe(heir.id);
  });

  it("is lost to nobody but a gens with no man in it: the rites wait for one", () => {
    let world = withDay(start, 40);
    for (const man of start.characters.filter((character) => character.dynastyId === "gens-fabius" && character.alive)) world = killCharacter(world, man.id, "a plague", 40).world;
    const kept = keepGentes(withDay(world, 60), 60).world;
    const fabii = gensById(kept, "gens-fabius")!;
    expect(fabii.sacraKeeperId).toBeNull();
    expect(fabii.sacra.length).toBe(1);
  });

  it("goes with the name to an adopted son", () => {
    // An old Fabius with no son adopts a young patrician of another gens; the son bears the Fabii's name and can keep their rites.
    const fabii = gensById(start, "gens-fabius")!;
    const keeper = start.characters.find((character) => character.id === fabii.sacraKeeperId)!;
    const lone = { ...start, characters: start.characters.map((character) => (character.id === keeper.id ? { ...character, ageYearsAtStart: 60 } : character)), familyLinks: start.familyLinks.filter((link) => link.characterId !== keeper.id && link.relatedCharacterId !== keeper.id) };
    const done = adoptIntoGens(lone, keeper.id, named(lone, "Gaius Sulpicius Paterculus").id, 100);
    if ("bar" in done) throw new Error(done.bar);
    const dead = killCharacter(withDay(done.world, 200), keeper.id, "old age", 200).world;
    const kept = keepGentes(withDay(dead, 230), 230).world;
    const son = kept.characters.find((character) => character.name.endsWith("Sulpicianus"))!;
    expect(son.dynastyId).toBe("gens-fabius");
    expect(gensById(kept, "gens-fabius")!.sacraKeeperId).toBe(son.id);
  });

  const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const priestOf = (world: WorldState, officeId: string) => world.characters.find((character) => world.material.officeSeats.some((seat) => seat.officeId === officeId && seat.holderCharacterId === character.id && seat.status === "held"))!;

  it("has the king of the rites and the three great flamines, patricians by birth and for life, chosen by the pontifex maximus (v58)", () => {
    for (const id of ["roman-rex-sacrorum", "roman-flamen-dialis", "roman-flamen-martialis", "roman-flamen-quirinalis"]) {
      const office = definition.government.offices.find((candidate) => candidate.id === id)!;
      expect(office.kind).toBe("priesthood");
      expect(office.termDays ?? null).toBeNull();
      expect(office.successionRuleId).toBe("roman-vestal-choice");
      expect(admissionRefusal(start, office, office.eligibilityRequirementIds, named(start, "Manius Curius Dentatus"), 0)).toMatch(/patrician/i);
      const priest = priestOf(start, id);
      expect(priest.ordo ?? "patrician").toBe("patrician");
      expect(priest.dynastyId).not.toBeNull();
      expect(priest.creationReason).toMatch(/^Invented/);
    }
    expect(priestOf(start, "roman-pontifex-maximus").name).toBe("Tiberius Coruncanius");
  });

  it("gives them the public rites as their charge and no other act of the state", () => {
    const rites = readDepartments(start).holding({ kind: "polity", id: "rome" }, "public_rites");
    for (const id of ["roman-rex-sacrorum", "roman-flamen-dialis", "roman-flamen-martialis", "roman-flamen-quirinalis"]) {
      expect(rites.department?.officeIds).toContain(id);
      const priest = priestOf(start, id);
      for (const act of ["tax_rate", "levy", "coinage", "war", "spending"] as const) {
        const may = mayAct(start, priest.id, act, { offices: definition.government.offices });
        expect(may === null || may.grade === "forbidden" || may.grade === "by_the_body").toBe(true);
      }
    }
  });

  it("binds the flamen Dialis to no other office and no command, and the king of the rites to no magistracy", () => {
    const dialis = priestOf(start, "roman-flamen-dialis");
    const rex = priestOf(start, "roman-rex-sacrorum");
    const martialis = priestOf(start, "roman-flamen-martialis");
    const consul = definition.government.offices.find((candidate) => candidate.id === "roman-consul")!;
    const quaestor = definition.government.offices.find((candidate) => candidate.id === "roman-quaestor")!;
    const augur = definition.government.offices.find((candidate) => candidate.id === "roman-augur")!;
    expect(priestlyTaboo(start, consul, dialis)).toMatch(/flamen of Jupiter, and may hold no other office/);
    expect(priestlyTaboo(start, augur, dialis)).toMatch(/no other office/);
    expect(admissionRefusal(start, quaestor, quaestor.eligibilityRequirementIds, dialis, 0)).toMatch(/no other office/);
    expect(priestlyTaboo(start, consul, rex)).toMatch(/no magistracy/);
    expect(priestlyTaboo(start, augur, rex)).toBeNull();
    // A flamen of Mars has no such taboo: the great three are not the same.
    expect(priestlyTaboo(start, consul, martialis)).toBeNull();
    expect(commandBar(start, dialis)).toMatch(/army under arms/);
    expect(commandBar(start, rex)).toBeNull();
    // The engine will not hand the flamen Dialis an army.
    const army = start.material.forces.find((force) => force.polityId === "rome")!;
    const result = applyDeltas(start, [WorldDeltaSchema.parse({ op: "force_modify", forceRef: army.id, commanderCharacterRef: dialis.id, reason: "Give him the legion." })], {
      now: start.instant, actorRef: { kind: "character", id: army.commanderCharacterId ?? dialis.id }, offices: definition.government.offices, successionRules: definition.government.successionRules,
      warfare: definition.warfare, ids: createIdFactory("flamen"), gameId: "game-flamen", actsForTheWorld: true,
    });
    expect(result.rejected.length).toBe(1);
    expect(result.world.material.forces.find((force) => force.id === army.id)!.commanderCharacterId).toBe(army.commanderCharacterId);
  });

  it("keeps the old priesthoods for patricians by birth", () => {
    const rex = { id: "roman-rex-sacrorum", label: "The king of the rites" } as Pick<Office, "id" | "label">;
    const flamen = { id: "roman-flamen-dialis", label: "Flamen of Jupiter" } as Pick<Office, "id" | "label">;
    const pontiff = { id: "roman-pontiff", label: "Roman pontiff" } as Pick<Office, "id" | "label">;
    const patrician = named(start, "Gnaeus Cornelius Blasio");
    const plebeian = named(start, "Manius Curius Dentatus");
    expect(priestlyBar(rex, plebeian)).toMatch(/patricians by birth/);
    expect(priestlyBar(flamen, plebeian)).toMatch(/patricians by birth/);
    expect(priestlyBar(rex, patrician)).toBeNull();
    // The pontificate was opened to the plebs by the lex Ogulnia of 300.
    expect(priestlyBar(pontiff, plebeian)).toBeNull();
    // And it is the admission the electors apply, whatever else the office asks.
    const office = { id: "roman-rex-sacrorum", label: "The king of the rites", polityId: "rome", kind: "priesthood", authorisedActionIds: [], eligibilityRequirementIds: [] } as unknown as Office;
    expect(admissionRefusal(start, office, [], plebeian, 0)).toMatch(/patricians by birth/);
    expect(admissionRefusal(start, office, [], patrician, 0)).toBeNull();
  });
});
