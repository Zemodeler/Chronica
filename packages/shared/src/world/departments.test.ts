import { describe, expect, it } from "vitest";
import type { Character } from "../characters/character";
import { DepartmentSchema, readDepartments, VACANT_SKILL, type Department, type DepartmentWorld } from "./departments";

const man = (id: string, taxation: number, extra: Partial<{ espionage: number; polityId: string | null; relations: Character["relations"] }> = {}): Character => ({
  id,
  alive: true,
  polityId: extra.polityId === undefined ? "syracuse" : extra.polityId,
  skills: { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: { taxation, espionage: extra.espionage ?? 50 } },
  relations: extra.relations ?? [],
} as unknown as Character);

const seat = (officeId: string, holderCharacterId: string | null) => ({ officeId, holderCharacterId, status: holderCharacterId === null ? "vacant" : "held" });

const department = (fields: Partial<Department> & Pick<Department, "id" | "levers" | "officeIds">): Department => DepartmentSchema.parse({
  scope: { kind: "polity", id: "syracuse" },
  name: fields.id,
  foundedAtStep: 0,
  formsAtStep: 0,
  origin: "order",
  ...fields,
});

const world = (fields: Partial<DepartmentWorld> & Pick<DepartmentWorld, "characters">): DepartmentWorld => ({
  elapsedStep: 100,
  constitutions: [{ polityId: "syracuse", rulerOfficeId: "king" }],
  departments: [],
  ...fields,
  material: { officeSeats: [seat("king", "hieron")], ...fields.material },
});

const SYRACUSE = { kind: "polity", id: "syracuse" } as const;

describe("who is in charge of the tax roll", () => {
  it("is the king himself, while nobody has been given it", () => {
    const reader = readDepartments(world({ characters: [man("hieron", 80)] }));
    // Seven families of the state's work on one man: four past the three he can carry.
    expect(reader.workload("hieron")).toBe(-12);
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(68);
  });

  it("is the treasurer once there is one, and the king drops out of it", () => {
    const reader = readDepartments(world({
      characters: [man("hieron", 80), man("treasurer", 60)],
      departments: [department({ id: "treasury", levers: ["tax_roll", "public_works_cost", "audit"], officeIds: ["treasurer"] })],
      material: { officeSeats: [seat("king", "hieron"), seat("treasurer", "treasurer")] },
    }));
    expect(reader.holding(SYRACUSE, "tax_roll").people.map((person) => person.id)).toEqual(["treasurer"]);
    // One family fewer for the king.
    expect(reader.workload("hieron")).toBe(-9);
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(60);
  });

  it("runs badly with the seat empty, and does not go back to the king", () => {
    const reader = readDepartments(world({
      characters: [man("hieron", 80)],
      departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["treasurer"] })],
      material: { officeSeats: [seat("king", "hieron"), seat("treasurer", null)] },
    }));
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(VACANT_SKILL);
  });

  it("averages two colleagues rather than taking the better", () => {
    const reader = readDepartments(world({
      characters: [man("hieron", 50), man("able", 80), man("fool", 20)],
      departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["quaestor"] })],
      material: { officeSeats: [seat("king", "hieron"), seat("quaestor", "able"), seat("quaestor", "fool")] },
    }));
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(50);
  });

  it("stays with the old holder until the new department has formed", () => {
    const forming = world({
      characters: [man("hieron", 80), man("treasurer", 30)],
      departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["treasurer"], formsAtStep: 130 })],
      material: { officeSeats: [seat("king", "hieron"), seat("treasurer", "treasurer")] },
    });
    expect(readDepartments(forming).holding(SYRACUSE, "tax_roll").department).toBeNull();
    expect(readDepartments({ ...forming, elapsedStep: 130 }).holding(SYRACUSE, "tax_roll").department?.id).toBe("treasury");
  });

  it("is better for a department that has done it for years", () => {
    const reader = readDepartments(world({
      characters: [man("hieron", 50), man("treasurer", 60)],
      departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["treasurer"], experienceDays: 360 * 25 })],
      material: { officeSeats: [seat("king", "hieron"), seat("treasurer", "treasurer")] },
    }));
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(70);
  });

  it("is worse for colleagues who cannot stand each other", () => {
    const hate = (of: string): Character["relations"] => [{ subjectCharacterId: of, causes: [{ id: `h-${of}`, label: "An old feud.", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }];
    const reader = readDepartments(world({
      characters: [man("hieron", 50), man("a", 60, { relations: hate("b") }), man("b", 60, { relations: hate("a") })],
      departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["quaestor"] })],
      material: { officeSeats: [seat("king", "hieron"), seat("quaestor", "a"), seat("quaestor", "b")] },
    }));
    expect(reader.skill(SYRACUSE, "tax_roll")).toBe(55);
  });
});

describe("the head of a department", () => {
  it("lifts every mission in his field by his own gift for it", () => {
    const reader = readDepartments(world({
      characters: [man("hieron", 50), man("spymaster", 50, { espionage: 100 })],
      departments: [department({ id: "watch", levers: ["watch"], officeIds: [], headOfficeId: "spymaster" })],
      material: { officeSeats: [seat("king", "hieron"), seat("spymaster", "spymaster")] },
    }));
    expect(reader.headLift(SYRACUSE, "watch")).toBeCloseTo(0.15);
  });

  it("is the ruler, for what the ruler still runs, stretched as he is", () => {
    const reader = readDepartments(world({ characters: [man("hieron", 50, { espionage: 62 })] }));
    // 62 less twelve for carrying seven families: middling, and no lift.
    expect(reader.headLift(SYRACUSE, "watch")).toBe(0);
  });
});

describe("a household", () => {
  const sources = [{ id: "farm", originKind: "holding", beneficiaryAccountId: "purse", active: true }];
  const accounts = [{ id: "purse", owner: { kind: "character", id: "owner" } }];

  it("is run by its owner until he appoints a steward", () => {
    const owner = { ...man("owner", 50, { polityId: null }), skills: { ...man("owner", 50).skills, stewardship: 70 } };
    const alone = readDepartments(world({ characters: [owner], constitutions: [], material: { officeSeats: [], incomeSources: sources, accounts } }));
    expect(alone.skill({ kind: "household", id: "owner" }, "estate:farm")).toBe(70);

    const steward = { ...man("steward", 50, { polityId: null }), skills: { ...man("steward", 50).skills, stewardship: 40 } };
    const stewarded = readDepartments(world({
      characters: [owner, steward],
      constitutions: [],
      departments: [department({ id: "stewardship", scope: { kind: "household", id: "owner" }, levers: ["estate:farm"], officeIds: ["vilicus"] })],
      material: { officeSeats: [seat("vilicus", "steward")], incomeSources: sources, accounts },
    }));
    expect(stewarded.skill({ kind: "household", id: "owner" }, "estate:farm")).toBe(40);
    expect(stewarded.families("owner").has("household")).toBe(false);
  });

  it("is run by the steward he hires, and the steward carries it as work of his own", () => {
    const owner = { ...man("owner", 50, { polityId: null }), skills: { ...man("owner", 50).skills, stewardship: 70 } };
    const bailiff = { ...man("bailiff", 50, { polityId: null }), skills: { ...man("bailiff", 50).skills, stewardship: 85 } };
    const hired = readDepartments(world({
      characters: [owner, bailiff],
      constitutions: [],
      material: { officeSeats: [], incomeSources: sources, accounts, contracts: [{ role: "steward", employerAccountId: "purse", employeeCharacterId: "bailiff", status: "active", monthlyPay: 5 }] },
    }));
    expect(hired.skill({ kind: "household", id: "owner" }, "estate:farm")).toBe(85);
    expect(hired.families("owner").has("household")).toBe(false);
    expect(hired.families("bailiff").has("household")).toBe(true);
  });
});

describe("an officer who hates the man he serves", () => {
  const hates = (duty: number): Character => ({
    ...man("archias", 70, { relations: [{ subjectCharacterId: "hieron", causes: [{ id: "c", label: "He ruined my father.", score: -60, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }),
    traits: [],
    mind: { drives: { duty } },
  } as unknown as Character);
  const treasury = (officer: Character) => readDepartments(world({
    characters: [man("hieron", 50), officer],
    departments: [department({ id: "treasury", levers: ["tax_roll"], officeIds: ["treasurer"] })],
    material: { officeSeats: [seat("king", "hieron"), seat("treasurer", officer.id)] },
  })).skill(SYRACUSE, "tax_roll");

  it("does the work slowly and badly, unless duty holds him to it", () => {
    expect(treasury(hates(20))).toBe(treasury(hates(90)) - 5);
  });
});
