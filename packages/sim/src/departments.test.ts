import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DepartmentSchema, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { keepDepartments, resolveAudits } from "./departments";
import { ensureConstitutions } from "./constitutions";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const board = (id: string, levers: string[], officeIds: string[], formsAtStep: number) => DepartmentSchema.parse({
  id, scope: { kind: "polity", id: "syracuse" }, name: id, levers, officeIds, foundedAtStep: 0, formsAtStep, origin: "order",
  // Formed and counted already, where it formed at the opening.
  countedAtStep: formsAtStep === 0 ? 0 : null,
});

describe("a department, as time passes", () => {
  it("takes its levers from the older board when it has formed, and says so", () => {
    const heldOffice = base().material.officeSeats.find((seat) => seat.status === "held")!.officeId;
    const world: WorldState = { ...base(), departments: [board("old", ["tax_roll", "audit"], [heldOffice], 0), board("new", ["tax_roll"], [heldOffice], 30)] };

    const before = keepDepartments(world, 20);
    expect(before.facts).toEqual([]);
    expect(before.world.departments.find((department) => department.id === "old")?.levers).toEqual(["tax_roll", "audit"]);

    const after = keepDepartments(before.world, 30);
    expect(after.facts.map((fact) => fact.localId)).toEqual(["department_formed_new"]);
    expect(after.world.departments.find((department) => department.id === "old")?.levers).toEqual(["audit"]);
    // Said once, not every day after.
    expect(keepDepartments(after.world, 31).facts).toEqual([]);
  });

  it("learns only while somebody is in it", () => {
    const seated = base().material.officeSeats.find((seat) => seat.status === "held")!.officeId;
    const world: WorldState = { ...base(), departments: [board("staffed", ["watch"], [seated], 0), board("empty", ["grain"], ["nobody-holds-this"], 0)] };
    const later = keepDepartments(keepDepartments(world, 100).world, 460).world;
    expect(later.departments.find((department) => department.id === "staffed")?.experienceDays).toBe(460);
    expect(later.departments.find((department) => department.id === "empty")?.experienceDays).toBe(0);
  });

  it("leaves a power with no departments its ruler holding everything", () => {
    const { offices, successionRules } = punicWarsScenario.definition.government;
    const world = ensureConstitutions({ world: base(), government: { offices, successionRules }, toDay: 0 });
    const reader = readDepartments(world);
    const syracuse = reader.holding({ kind: "polity", id: "syracuse" }, "tax_roll");
    expect(syracuse.department).toBeNull();
    expect(syracuse.people.map((person) => person.id)).toEqual(["hieron-ii"]);
    // Both consuls, not the first of them.
    expect(reader.holding({ kind: "polity", id: "rome" }, "supply").people.length).toBe(2);
  });
});

describe("a department founded by decree", () => {
  const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
  let calls = 0;
  const act = (world: WorldState, actor: string, delta: Record<string, unknown>, day = 0) => applyDeltas(world, [WorldDeltaSchema.parse(delta)], {
    now: { day, minute: 540 }, actorRef: { kind: "character" as const, id: actor }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, ids: createIdFactory(`department-${(calls += 1)}`), gameId: "game-departments",
  });
  const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(base(), 0), government, toDay: 0 });
  const decree = (world: WorldState, enacts: Record<string, unknown>) => {
    const opened = act(world, "hieron-ii", {
      op: "political_procedure_open", localId: "d", type: "decree", institutionRef: null, sponsorCharacterRef: "hieron-ii",
      subjectKind: "polity", subjectRef: "syracuse", label: "A treasury for Syracuse", resolutionMechanism: "appointment_authority", deadlineInDays: null,
      enacts, reason: "The king has too much to do.",
    });
    expect(opened.rejected).toEqual([]);
    const resolved = act(opened.world, "hieron-ii", {
      op: "political_procedure_resolve", procedureRef: opened.assignedIds.get("d")!, outcome: "passed", outcomeReason: "The king decrees it.", reason: "Decreed.",
    });
    expect(resolved.rejected).toEqual([]);
    return resolved.world;
  };

  it("makes its office with an empty seat, forms in a month, and then holds its levers", () => {
    const world = decree(opening(), { department: { name: "The Royal Treasury", headOfficeId: "syracusan-treasurer" } });
    const treasury = world.departments.find((department) => department.name === "The Royal Treasury")!;
    // Named nothing: given what its name says.
    expect(treasury.levers).toEqual(["tax_roll", "public_works_cost"]);
    expect(treasury.formsAtStep).toBe(30);
    expect(world.material.officeSeats.some((seat) => seat.officeId === "syracusan-treasurer" && seat.status === "vacant")).toBe(true);
    expect(world.constitutions.find((constitution) => constitution.polityId === "syracuse")!.history.at(-1)?.summary).toContain("The Royal Treasury");

    // Still the king's while it organises; the empty seat's, badly, once it has.
    expect(readDepartments(world).holding({ kind: "polity", id: "syracuse" }, "tax_roll").people.map((person) => person.id)).toEqual(["hieron-ii"]);
    const formed = keepDepartments({ ...world, elapsedStep: 30, instant: { ...world.instant, day: 30 } }, 30);
    expect(formed.facts.map((fact) => fact.summary)).toEqual(["The Royal Treasury has been organised and takes charge of gathering the taxes, what public works cost."]);
    expect(readDepartments(formed.world).skill({ kind: "polity", id: "syracuse" }, "tax_roll")).toBe(25);
  });

  it("never founds a department with nothing behind it", () => {
    const world = decree(opening(), { department: { name: "The Keepers of the Fountain of Arethusa", officeIds: ["arethusa-keeper"] } });
    const keepers = world.departments.find((department) => department.name.startsWith("The Keepers"))!;
    expect(keepers.levers).toEqual([]);
    expect(keepers.effects).toEqual([{ quantity: "stability", direction: "raise", band: "slight", scope: "realm" }]);
    expect(world.genericEntities.find((entity) => entity.id === keepers.standingEntityId)?.kind).toBe("department");
  });

  it("abolishes one, and its work goes back to the king", () => {
    const founded = decree(opening(), { department: { name: "The Royal Treasury", levers: ["tax_roll"], headOfficeId: "syracusan-treasurer" } });
    const id = founded.departments.find((department) => department.name === "The Royal Treasury")!.id;
    const abolished = decree(founded, { department: { departmentRef: id, abolish: true } });
    expect(abolished.departments.find((department) => department.id === id)!.abolishedAtStep).toBe(0);
    expect(readDepartments({ ...abolished, elapsedStep: 60 }).holding({ kind: "polity", id: "syracuse" }, "tax_roll").department).toBeNull();
  });
});

describe("Rome and Carthage as the world opens", () => {
  const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const world = ensureConstitutions({ world: base(), government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: 0 });
  const reader = readDepartments(world);
  const ROME = { kind: "polity", id: "rome" } as const;

  it("have their treasuries worked by the quaestors and the officers of the accounts, old hands both", () => {
    expect(reader.holding(ROME, "tax_roll").department?.name).toBe("The Treasury of Saturn");
    // Four quaestors nobody named, and two hundred years of the work.
    expect(reader.skill(ROME, "tax_roll")).toBe(60);
    expect(reader.holding({ kind: "polity", id: "carthage" }, "tax_roll").department?.name).toBe("The Office of the Accounts");
  });

  it("leave the consuls the war, the watch and the letters: three families, and their own estates a fourth", () => {
    expect(reader.holding(ROME, "supply").department).toBeNull();
    for (const consul of reader.rulers("rome")) expect([...reader.families(consul.id)].sort()).toEqual(["foreign", "household", "war", "watch"]);
    for (const consul of reader.rulers("rome")) expect(reader.workload(consul.id)).toBe(-3);
  });
});

describe("a treasurer with his hand in the chest", () => {
  const setup = (mind: { honesty: number; wealth: number; duty: number }, pay: "honorary" | "salaried") => {
    const opening = base();
    const hieron = opening.characters.find((character) => character.id === "hieron-ii")!;
    const treasurer = {
      ...hieron, id: "dion-treasurer", name: "Dion", officeId: null, personalAccountId: "dion-purse", relations: [], traits: [],
      mind: { ...hieron.mind, temperament: { ...hieron.mind.temperament, honesty: mind.honesty }, drives: { ...hieron.mind.drives, wealth: mind.wealth, duty: mind.duty } },
    };
    const treasury = opening.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "syracuse")!;
    const world: WorldState = {
      ...opening,
      characters: [...opening.characters, treasurer],
      departments: [{ ...board("syr-treasury", ["tax_roll"], ["syr-treasurer"], 0), pay, countedAtStep: 0 }],
      material: {
        ...opening.material,
        accounts: [...opening.material.accounts.map((account) => (account.id === treasury.id ? { ...account, balance: 10_000 } : account)), { ...treasury, id: "dion-purse", owner: { kind: "character" as const, id: "dion-treasurer" }, balance: 0 }],
        officeSeats: [...opening.material.officeSeats, { ...opening.material.officeSeats[0]!, id: "syr-treasurer-seat", officeId: "syr-treasurer", holderCharacterId: "dion-treasurer", status: "held" as const }],
      },
    };
    const taxed: WorldState = {
      ...world,
      material: { ...world.material, transactions: [...world.material.transactions, { id: "tax-1", atStep: 30, kind: "tax" as const, amount: 3_000, destinationAccountId: treasury.id, cause: { kind: "scheduled_income" as const, id: "syracuse-tax", explanation: "Tax" }, visibility: "polity" as const }] },
    };
    return { before: world, after: keepDepartments(taxed, 30, world), treasury: treasury.id };
  };
  const purse = (world: WorldState): number => world.material.accounts.find((account) => account.id === "dion-purse")!.balance;

  it("keeps some of the tax back, where an audit can find it, and men start to talk", () => {
    const { after } = setup({ honesty: 10, wealth: 90, duty: 10 }, "honorary");
    expect(purse(after.world)).toBeGreaterThan(0);
    expect(after.world.diversions).toMatchObject([{ byCharacterId: "dion-treasurer", departmentId: "syr-treasury", amount: purse(after.world), foundAtStep: null }]);
    expect(after.world.material.transactions.some((transaction) => transaction.kind === "diversion" && transaction.visibility === "private")).toBe(true);
    expect(after.facts.some((fact) => fact.summary.startsWith("Men say less reaches"))).toBe(true);
  });

  it("is found out by a sharp enough auditor, and the finding is evidence", () => {
    const { after } = setup({ honesty: 10, wealth: 90, duty: 10 }, "honorary");
    const hieron = after.world.characters.find((character) => character.id === "hieron-ii")!;
    const censor = { ...hieron, id: "archias-auditor", name: "Archias", skills: { ...hieron.skills, subSkills: { ...hieron.skills.subSkills, taxation: 100, espionage: 100 } } };
    const dull = (world: WorldState): WorldState => ({ ...world, characters: [...world.characters.map((character) => (character.id === "dion-treasurer" ? { ...character, skills: { ...character.skills, intrigue: 10, subSkills: { ...character.skills.subSkills, manipulation: 10 } } } : character)), censor] });
    const world = dull(after.world);
    const ordered = applyDeltas(world, [WorldDeltaSchema.parse({ op: "audit_open", localId: "a", auditorCharacterRef: "archias-auditor", departmentRef: "syr-treasury", reason: "The take is short." })], {
      now: { day: 30, minute: 540 }, actorRef: { kind: "character" as const, id: "hieron-ii" }, offices: [], successionRules: [],
      warfare: ScenarioDefinitionSchema.parse(punicWarsScenario.definition).warfare, ids: createIdFactory("audit"), gameId: "game-audit",
    });
    expect(ordered.rejected).toEqual([]);
    const due = ordered.world.audits[0]!.dueAtStep;
    expect(resolveAudits(ordered.world, due - 1).facts).toEqual([]);
    const done = resolveAudits(ordered.world, due);
    expect(done.world.audits[0]!.status).toBe("found");
    expect(done.world.diversions[0]!.foundAtStep).toBe(due);
    expect(done.facts[0]).toMatchObject({ kind: "peculation_found", visibility: "private" });
    expect(done.facts[0]!.summary).toContain("Dion kept back");
  });

  it("takes less when he is paid for the work, and nothing when he is honest", () => {
    const unpaid = setup({ honesty: 10, wealth: 90, duty: 10 }, "honorary").after.world;
    const paid = setup({ honesty: 10, wealth: 90, duty: 10 }, "salaried").after.world;
    const paidTake = paid.diversions[0]?.amount ?? 0;
    expect(paidTake).toBeGreaterThan(0);
    expect(paidTake).toBeLessThan(unpaid.diversions[0]!.amount);
    // Paid his wage, besides.
    expect(paid.material.transactions.some((transaction) => transaction.kind === "salary" && transaction.destinationAccountId === "dion-purse")).toBe(true);
    expect(setup({ honesty: 90, wealth: 30, duty: 80 }, "honorary").after.world.diversions).toEqual([]);
  });
});
