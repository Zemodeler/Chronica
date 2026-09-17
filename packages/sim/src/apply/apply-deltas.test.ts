import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, localRef, type Office, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "../ports";
import { applyDeltas } from "./apply-deltas";
import type { ApplyContext } from "./context";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const warfare = definition.warfare;

/** Marcus holds the Roman command seat, so he is the authorized actor in these fixtures. */
function context(overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    now: { day: 0, minute: 540 },
    actorRef: { kind: "character", id: "marcus-atilius" },
    offices,
    warfare,
    ids: createIdFactory("test"),
    gameId: "game-1",
    ...overrides,
  };
}

const totalMoney = (state: WorldState): number => state.material.accounts.reduce((sum, account) => sum + account.balance, 0);

describe("money", () => {
  it("moves exactly the stated amount between accounts and conserves the rest", () => {
    const before = world();
    const opening = totalMoney(before);
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 200, reason: "A private settlement." }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    expect(totalMoney(result.world)).toBe(opening);
    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(1_000);
    expect(result.world.material.accounts.find((a) => a.id === "hanno-purse")!.balance).toBe(1_100);
  });

  it("lets money leave the modelled world when it is paid to no account", () => {
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 200, reason: "Paid to foreign shipwrights." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    expect(totalMoney(result.world)).toBe(totalMoney(before) - 200);
  });

  it("refuses a payment larger than the balance as friction, leaving every balance untouched", () => {
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 99_999, reason: "An impossible levy." }],
      context(),
    );

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("cannot cover");
    expect(result.world.material.accounts).toEqual(before.material.accounts);
  });

  it("keeps applying the rest of a batch after one delta is refused", () => {
    const result = applyDeltas(
      world(),
      [
        { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 99_999, reason: "An impossible levy." },
        { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 100, reason: "What could actually be raised." },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(1_100);
  });
});

describe("engine-assigned ids", () => {
  it("mints ids for created entities and resolves later references to them", () => {
    const create: WorldDelta = {
      op: "project_create",
      localId: "recruitment",
      kind: "recruitment",
      label: "Two new legions",
      sponsorRef: { kind: "polity", id: "rome" },
      fundingAccountRef: "marcus-purse",
      completionOutcome: null,
      milestones: [{ label: "Financing committed", dueInDays: 9, costAmount: 0 }, { label: "Recruits assemble", dueInDays: 120, costAmount: 0 }],
      reason: "Recruitment takes months.",
    };
    const first = applyDeltas(world(), [create], context());
    const project = first.world.projects[0]!;
    expect(project.id).toBe("project-test-1");
    expect(first.assignedIds.get("recruitment")).toBe("project-test-1");

    const second = applyDeltas(
      first.world,
      [{ op: "project_milestone_update", projectRef: project.id, milestoneId: project.milestones[0]!.id, status: "completed", reason: "Financing arranged." }],
      context(),
    );
    expect(second.rejected).toHaveLength(0);
    expect(second.world.projects[0]!.milestones[0]!.status).toBe("completed");
    expect(second.world.projects[0]!.status).toBe("in_progress");
  });

  it("refuses a reference to a handle nothing in the batch created", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: localRef("phantom_legion"), moraleBpsDelta: 500, reason: "Encouraging a force that does not exist." }],
      context(),
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("which nothing in this batch created");
  });

  it("refuses a delta naming an entity that does not exist", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: "force-that-never-was", moraleBpsDelta: 500, reason: "Encouraging nobody." }],
      context(),
    );
    expect(result.rejected[0]?.reason).toContain("No force");
  });
});

describe("authority", () => {
  it("records an authorized act as authorized", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: "legio-i", moraleBpsDelta: 200, reason: "The consul inspects his legion." }],
      context(),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.authority.authorized).toBe(true);
    expect(result.breaches).toHaveLength(0);
  });

  it("lets a character spend their own purse without recording a breach", () => {
    // Found running a live model: office grants cover an office's named
    // treasury and nothing else, so spending one's own money was reported as
    // insubordination -- which made every privately funded act look like theft.
    const result = applyDeltas(
      world(),
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 100, reason: "Paying recruiters from his own purse." }],
      context(),
    );
    expect(result.breaches).toHaveLength(0);
    expect(result.applied[0]!.authority.authorized).toBe(true);
  });

  it("judges an unscoped act in the actor's own polity, not whichever polity happens to be first", () => {
    // Also found live: the fallback scope read `map.polities[0]`, so a Roman
    // consul's every unscoped act was checked against Carthage and breached.
    const result = applyDeltas(
      world(),
      [{ op: "character_intent_set", actorCharacterRef: "marcus-atilius", actionType: "prepare", targetRefs: [], rationale: "Preparing the levy.", priority: 50, visibility: "private" }],
      context(),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.authority.reason).not.toContain("carthage");
  });

  it("carries out an unauthorized act and records it as a breach rather than refusing it", () => {
    // VISION §12: a general who marches without orders has not performed an
    // invalid action. He has committed insubordination, and the world must be
    // able to see that he did.
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "force_modify", forceRef: "legio-i", locationId: "tun-13205935b88806172084765", reason: "Marching without authority." }],
      context({ actorRef: { kind: "character", id: "hanno" } }),
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]!.reason).toContain("No active grant");
    expect(result.world.material.forces.find((f) => f.id === "legio-i")!.locationId).toBe("tun-13205935b88806172084765");
  });
});

describe("dynamic world generation", () => {
  it("creates a persistent character the world needed, with a purse of their own", () => {
    const result = applyDeltas(
      world(),
      [
        {
          op: "character_create",
          localId: "quaestor",
          name: "Marcus Fabius Varro",
          polityId: "rome",
          provinceId: null,
          age: 38,
          officeLabel: "Military Quaestor",
          traits: ["methodical", "politically cautious"],
          wealth: 250,
          generatedBecause: "Responsible for financing the current mobilization.",
        },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const created = result.world.characters.find((c) => c.name === "Marcus Fabius Varro");
    expect(created).toBeDefined();
    expect(created!.traits).toContain("methodical");
    expect(result.world.material.accounts.some((a) => a.id === created!.personalAccountId)).toBe(true);
  });

  it("records a novel institution as a generic entity rather than inventing a mechanic", () => {
    const result = applyDeltas(
      world(),
      [
        {
          op: "generic_entity_create",
          localId: "credit_office",
          kind: "financial_institution",
          label: "Roman Public Credit Office",
          ownerRef: { kind: "polity", id: "rome" },
          attributes: { capital: 480, stateOwnershipBps: 6_000 },
          reason: "The Senate charters a public lending office.",
        },
      ],
      context(),
    );
    expect(result.world.genericEntities[0]).toMatchObject({ kind: "financial_institution", label: "Roman Public Credit Office" });
  });
});

describe("diplomacy", () => {
  it("shifts a stance and clamps it inside the score range", () => {
    const result = applyDeltas(
      world(),
      [{ op: "polity_stance_shift", polityId: "carthage", towardPolityId: "rome", trustDelta: -120, reason: "Roman mobilization." }],
      context(),
    );
    const stance = result.world.polityStances.find((s) => s.polityId === "carthage" && s.towardPolityId === "rome");
    expect(stance!.trustScore).toBe(-100);
  });

  it("refuses a stance a polity would hold toward itself", () => {
    const result = applyDeltas(
      world(),
      [{ op: "polity_stance_shift", polityId: "rome", towardPolityId: "rome", trustDelta: 10, reason: "Nonsense." }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
  });
});

describe("what a country is trying to do", () => {
  const setOutlook = (polityId: string, objective: string, risk: number): WorldDelta => ({
    op: "polity_outlook_set",
    polityId,
    primaryObjective: objective,
    concerns: [{ label: "Roman expansion", level: "high" }],
    intentions: ["strengthen Sicily"],
    riskTolerance: risk,
    reason: "The situation has moved.",
  });

  it("records an outlook where the polity had none", () => {
    const result = applyDeltas(world(), [setOutlook("carthage", "Preserve commercial dominance.", 45)], context());
    const outlook = result.world.polityOutlooks.find((candidate) => candidate.polityId === "carthage");
    expect(outlook?.primaryObjective).toBe("Preserve commercial dominance.");
    expect(outlook?.riskTolerance).toBe(45);
    expect(outlook?.lastChangeReason).toBe("The situation has moved.");
  });

  it("replaces the old one rather than keeping both, so the world can say what it wants now", () => {
    const once = applyDeltas(world(), [setOutlook("carthage", "Preserve commercial dominance.", 45)], context());
    const twice = applyDeltas(once.world, [setOutlook("carthage", "Break Rome before it reaches Sicily.", 80)], context());

    const held = twice.world.polityOutlooks.filter((candidate) => candidate.polityId === "carthage");
    expect(held).toHaveLength(1);
    expect(held[0]!.primaryObjective).toBe("Break Rome before it reaches Sicily.");
    expect(held[0]!.riskTolerance).toBe(80);
  });

  it("refuses an outlook for a country that does not exist, and says which", () => {
    const result = applyDeltas(world(), [setOutlook("atlantis", "Rule the waves.", 50)], context());
    expect(result.world.polityOutlooks).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain('No polity "atlantis"');
    expect(result.rejected[0]!.kind).toBe("reference");
  });
});

describe("the political price of a measure", () => {
  it("moves a polity's legitimacy and records why", () => {
    const before = world();
    const opening = before.material.polityLegitimacy.find((entry) => entry.polityId === "rome")?.legitimacyBps ?? 5_000;
    const result = applyDeltas(
      before,
      [{ op: "legitimacy_shift", target: "polity", targetId: "rome", legitimacyBpsDelta: -900, institutionalConfidenceBpsDelta: -400, causeLabel: "Doubled the tax on the wealthy", reason: "The measure fell on the people who matter." }],
      context(),
    );

    const standing = result.world.material.polityLegitimacy.find((entry) => entry.polityId === "rome");
    expect(standing).toBeDefined();
    expect(standing!.causes.some((cause) => cause.label === "Doubled the tax on the wealthy")).toBe(true);
    expect(standing!.legitimacyBps).toBe(opening - 900);
  });

  it("never lets legitimacy leave the scale, however hard it is pushed", () => {
    const collapse: WorldDelta = { op: "legitimacy_shift", target: "polity", targetId: "rome", legitimacyBpsDelta: -10_000, causeLabel: "Catastrophe", reason: "Everything went wrong at once." };
    const result = applyDeltas(world(), [collapse, collapse], context());
    const standing = result.world.material.polityLegitimacy.find((entry) => entry.polityId === "rome")!;
    expect(standing.legitimacyBps).toBe(0);
  });

  it("refuses to move the standing of a polity that does not exist", () => {
    const result = applyDeltas(
      world(),
      [{ op: "legitimacy_shift", target: "polity", targetId: "atlantis", legitimacyBpsDelta: -100, causeLabel: "A scandal", reason: "Word got out." }],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain('No polity "atlantis"');
  });
});

describe("what the country is made of", () => {
  const province = (): string => world().map.provinces[0]!.id;

  it("draws men out of a province when they are levied", () => {
    const id = province();
    const before = applyDeltas(world(), [], context()).world;
    const start = before.material.provinceMaterial.find((m) => m.provinceId === id);
    const result = applyDeltas(
      before,
      [{ op: "province_material_shift", provinceId: id, availableManpowerDelta: -2_000, stabilityBpsDelta: -500, reason: "Two legions raised here." }],
      context(),
    );
    const after = result.world.material.provinceMaterial.find((m) => m.provinceId === id)!;
    if (start !== undefined) expect(after.availableManpower).toBe(Math.max(0, start.availableManpower - 2_000));
    expect(after.lastMaterialUpdateStep).toBe(before.elapsedStep);
  });

  it("derives a province's material state on first use rather than refusing", () => {
    const bare: WorldState = { ...world(), material: { ...world().material, provinceMaterial: [] } };
    const result = applyDeltas(
      bare,
      [{ op: "province_material_shift", provinceId: province(), foodSecurityBpsDelta: -3_000, reason: "The harvest failed." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.provinceMaterial.length).toBeGreaterThan(0);
  });

  it("refuses to change a place that is not on the map", () => {
    const result = applyDeltas(
      world(),
      [{ op: "province_material_shift", provinceId: "latium", foodSecurityBpsDelta: -100, reason: "A shortage." }],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain('No province "latium"');
    expect(result.rejected[0]!.kind).toBe("reference");
  });
});

describe("a question put to a body", () => {
  const sponsor = (state: WorldState): string => state.characters.find((character) => character.alive)!.id;
  const institution = (state: WorldState): string => state.material.institutions[0]!.id;

  const open = (state: WorldState): WorldDelta => ({
    op: "political_procedure_open",
    localId: "censure",
    type: "denunciation",
    institutionRef: institution(state),
    sponsorCharacterRef: sponsor(state),
    subjectKind: "character",
    subjectRef: sponsor(state),
    label: "Censure the consul for the tax.",
    resolutionMechanism: "vote",
    deadlineInDays: 30,
    visibility: "polity",
    reason: "The measure has to answer to the Senate.",
  });

  it("opens gathering support, with a deadline the engine works out from days", () => {
    const state = world();
    const result = applyDeltas(state, [open(state)], context());
    const opened = result.world.material.politicalProcedures.find((procedure) => procedure.label === "Censure the consul for the tax.");
    expect(opened).toBeDefined();
    expect(opened!.stage).toBe("gathering_support");
    expect(opened!.deadlineStep).toBe(state.elapsedStep + 30);
    expect(opened!.outcome).toBeNull();
  });

  it("keeps both sides of a senator who changes his mind, and counts only the later one", () => {
    const state = world();
    const opened = applyDeltas(state, [open(state)], context());
    const procedureId = opened.world.material.politicalProcedures.at(-1)!.id;
    const supporter = sponsor(state);

    const took = (position: "support" | "oppose"): WorldDelta => ({
      op: "political_support_set", procedureRef: procedureId, supporterKind: "character", supporterRef: supporter,
      position, influenceWeight: 40, reasonKind: "ideology", reasonLabel: "He has thought better of it.", visibility: "polity",
      reason: "His position moved.",
    });

    const first = applyDeltas(opened.world, [took("support")], context());
    const second = applyDeltas(first.world, [took("oppose")], context());

    const rows = second.world.material.supportPositions.filter((position) => position.supporterId === supporter);
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)!.position).toBe("oppose");
  });

  it("lets a voting bloc take a side, since the blocs are what decide a motion", () => {
    const state = world();
    const opened = applyDeltas(state, [open(state)], context());
    const procedureId = opened.world.material.politicalProcedures.at(-1)!.id;
    const bloc = state.material.institutions[0]!.votingBlocs[0]!;

    const result = applyDeltas(
      opened.world,
      [{
        op: "political_support_set", procedureRef: procedureId, supporterKind: "group", supporterRef: bloc.id,
        position: "oppose", influenceWeight: bloc.weight, reasonKind: "material_interest",
        reasonLabel: "The measure falls on the people they speak for.", visibility: "polity",
        reason: "The bloc declared against it.",
      }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.supportPositions.at(-1)!.supporterId).toBe(bloc.id);
  });

  it("refuses a side taken by something that cannot hold an opinion", () => {
    const state = world();
    const opened = applyDeltas(state, [open(state)], context());
    const procedureId = opened.world.material.politicalProcedures.at(-1)!.id;
    const result = applyDeltas(
      opened.world,
      [{
        op: "political_support_set", procedureRef: procedureId, supporterKind: "group", supporterRef: "the-weather",
        position: "support", influenceWeight: 10, reasonKind: "ideology", reasonLabel: "None.", visibility: "polity",
        reason: "Nonsense.",
      }],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain('No faction or voting bloc "the-weather"');
  });

  it("refuses a vote where there is no body to hold one", () => {
    const state = world();
    const result = applyDeltas(
      state,
      [{ ...open(state), institutionRef: null } as WorldDelta],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain("can only be put to a vote");
    expect(result.rejected[0]!.kind).toBe("world");
  });

  it("settles it once, and refuses to settle it twice", () => {
    const state = world();
    const opened = applyDeltas(state, [open(state)], context());
    const procedureId = opened.world.material.politicalProcedures.at(-1)!.id;
    const resolve: WorldDelta = { op: "political_procedure_resolve", procedureRef: procedureId, outcome: "failed", outcomeReason: "The chamber would not carry it.", reason: "The vote was held." };

    const once = applyDeltas(opened.world, [resolve], context());
    const settled = once.world.material.politicalProcedures.find((procedure) => procedure.id === procedureId)!;
    expect(settled.stage).toBe("resolved");
    expect(settled.outcome).toBe("failed");

    const twice = applyDeltas(once.world, [resolve], context());
    expect(twice.rejected[0]!.reason).toContain("already been settled");
  });
});

describe("an arrangement the world invented", () => {
  const found = (): WorldDelta => ({
    op: "generic_entity_create",
    localId: "lex_agraria",
    kind: "law",
    label: "Lex Agraria",
    ownerRef: { kind: "polity", id: "rome" },
    attributes: { smallholders: "increasing", eliteLoyalty: -12, recruitmentPool: "improving" },
    reason: "The land question had to be answered.",
  });

  it("changes only what the update names, and leaves the rest standing", () => {
    const created = applyDeltas(world(), [found()], context());
    const id = created.world.genericEntities.at(-1)!.id;

    const result = applyDeltas(
      created.world,
      [{ op: "generic_entity_update", entityRef: id, attributes: { eliteLoyalty: -30 }, retire: false, reason: "Opposition hardened over the winter." }],
      context(),
    );

    const law = result.world.genericEntities.find((entity) => entity.id === id)!;
    expect(law.attributes["eliteLoyalty"]).toBe(-30);
    expect(law.attributes["smallholders"]).toBe("increasing");
    expect(law.attributes["recruitmentPool"]).toBe("improving");
  });

  it("takes an attribute away when it is set to nothing", () => {
    const created = applyDeltas(world(), [found()], context());
    const id = created.world.genericEntities.at(-1)!.id;
    const result = applyDeltas(
      created.world,
      [{ op: "generic_entity_update", entityRef: id, attributes: { recruitmentPool: null }, retire: false, reason: "The effect never materialized." }],
      context(),
    );
    expect(result.world.genericEntities.find((entity) => entity.id === id)!.attributes).not.toHaveProperty("recruitmentPool");
  });

  it("keeps a repealed law on the books, marked as repealed", () => {
    const created = applyDeltas(world(), [found()], context());
    const id = created.world.genericEntities.at(-1)!.id;
    const result = applyDeltas(
      created.world,
      [{ op: "generic_entity_update", entityRef: id, attributes: {}, retire: true, reason: "Repealed under pressure from the Senate." }],
      context(),
    );
    const law = result.world.genericEntities.find((entity) => entity.id === id)!;
    expect(law.attributes).toHaveProperty("retiredAtStep");
    expect(law.label).toBe("Lex Agraria");
  });

  it("refuses to change an arrangement nobody ever founded", () => {
    const result = applyDeltas(
      world(),
      [{ op: "generic_entity_update", entityRef: "lex-nonexistent", attributes: {}, retire: false, reason: "A tidy-up." }],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain('No arrangement "lex-nonexistent"');
  });
});

describe("borrowing", () => {
  it("lends from a merchant the world invented for the purpose, if it made him rich enough", () => {
    // Found live: a merchant generated to lend the state money had an empty
    // purse, so the loan was refused by the very person invented to make it.
    const result = applyDeltas(
      world(),
      [
        { op: "character_create", localId: "merchant", name: "Titus Sestius", polityId: "rome", provinceId: null, age: 50, officeLabel: null, traits: [], wealth: 4_000, generatedBecause: "Somebody had to be rich enough to lend." },
        { op: "loan_open", localId: "merchant_credit", lenderKind: "character", lenderRef: localRef("merchant"), borrowerAccountRef: "marcus-purse", principal: 1_000, interestBps: 900, cadenceDays: 90, terms: "Merchant credit for the legions", collateralHoldingRef: null, reason: "The legions cannot wait for the levy." },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.loans).toHaveLength(1);
    expect(result.world.material.loans[0]!.outstanding).toBe(1_000);
  });

  it("names the lender when he cannot afford it, rather than printing his id at the ruler", () => {
    const result = applyDeltas(
      world(),
      [{ op: "loan_open", localId: "doomed", lenderKind: "character", lenderRef: "hamilcar", borrowerAccountRef: "marcus-purse", principal: 9_000, interestBps: 900, cadenceDays: 90, terms: "More than he has", collateralHoldingRef: null, reason: "An overreach." }],
      context(),
    );
    expect(result.rejected[0]!.reason).toContain("Hamilcar");
    expect(result.rejected[0]!.reason).not.toContain("hamilcar-purse");
  });

  const borrowFrom = (lenderId: string | null, principal: number): WorldDelta => ({
    op: "loan_open",
    localId: "merchant_loan",
    lenderKind: lenderId === null ? "foreign" : "character",
    lenderRef: lenderId,
    borrowerAccountRef: "marcus-purse",
    principal,
    interestBps: 800,
    cadenceDays: 90,
    terms: "Merchant credit against the coming harvest",
    collateralHoldingRef: null,
    reason: "The legions must be paid before the levy comes in.",
  });

  it("moves the principal out of the lender's own reserves and into the borrower's", () => {
    const before = world();
    const lenderStart = before.material.accounts.find((account) => account.id === "hanno-purse")!.balance;
    const borrowerStart = before.material.accounts.find((account) => account.id === "marcus-purse")!.balance;

    const result = applyDeltas(before, [borrowFrom("hanno", 300)], context());
    expect(result.world.material.accounts.find((a) => a.id === "hanno-purse")!.balance).toBe(lenderStart - 300);
    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(borrowerStart + 300);
  });

  it("opens the servicing obligation that makes an unpaid debt behave like unpaid wages", () => {
    const result = applyDeltas(world(), [borrowFrom("hanno", 300)], context());
    const loan = result.world.material.loans[0]!;
    const servicing = result.world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!;
    expect(servicing.kind).toBe("debt_service");
    expect(servicing.amount).toBe(24);
    // Below army pay: a state short of money starves its creditors first.
    expect(servicing.priority).toBeLessThan(500);
  });

  it("refuses a loan the lender plainly cannot make", () => {
    const result = applyDeltas(world(), [borrowFrom("hamilcar", 5_000)], context());
    expect(result.world.material.loans).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain("will not cover a loan of 5000");
    expect(result.rejected[0]!.kind).toBe("world");
  });

  it("takes foreign money without anyone in the world being out of pocket", () => {
    const before = world();
    const total = totalMoney(before);
    const result = applyDeltas(before, [borrowFrom(null, 400)], context());
    expect(totalMoney(result.world)).toBe(total + 400);
    expect(result.world.material.loans[0]!.lenderKind).toBe("foreign");
  });

  it("pays a debt down, and closes it when nothing is left", () => {
    const opened = applyDeltas(world(), [borrowFrom("hanno", 300)], context());
    const loanId = opened.world.material.loans[0]!.id;

    const part = applyDeltas(opened.world, [{ op: "loan_settle", loanRef: loanId, action: "repay", amount: 100, reason: "A first instalment." }], context());
    expect(part.world.material.loans[0]!.outstanding).toBe(200);
    expect(part.world.material.loans[0]!.status).toBe("active");

    const rest = applyDeltas(part.world, [{ op: "loan_settle", loanRef: loanId, action: "repay", amount: 200, reason: "Settled in full." }], context());
    expect(rest.world.material.loans[0]!.status).toBe("repaid");
    expect(rest.world.material.obligations.find((o) => o.kind === "debt_service")!.active).toBe(false);
  });

  it("stops servicing a debt that has been walked away from", () => {
    const opened = applyDeltas(world(), [borrowFrom("hanno", 300)], context());
    const loanId = opened.world.material.loans[0]!.id;
    const result = applyDeltas(opened.world, [{ op: "loan_settle", loanRef: loanId, action: "default", amount: 0, reason: "There is nothing to pay them with." }], context());

    expect(result.world.material.loans[0]!.status).toBe("defaulted");
    expect(result.world.material.obligations.find((o) => o.kind === "debt_service")!.active).toBe(false);
  });
});

describe("what somebody can be made to believe", () => {
  const plant = (holder: string, claim: string, kind: "fact" | "rumour" | "suspicion" | "secret", confidence: number): WorldDelta => ({
    op: "belief_set",
    holderCharacterRef: holder,
    claim,
    kind,
    confidence,
    subjectRef: null,
    sourceCharacterRef: null,
    visibility: "private",
    reason: "An agent saw to it that he heard this.",
  });

  it("puts a claim in someone's head without asking whether it is true", () => {
    const state = world();
    const target = state.characters.find((character) => character.alive)!.id;
    const result = applyDeltas(state, [plant(target, "The Carthaginian fleet has already sailed.", "rumour", 55)], context());

    const belief = result.world.characterBeliefs.find((candidate) => candidate.holderCharacterId === target);
    expect(belief?.claim).toBe("The Carthaginian fleet has already sailed.");
    expect(belief?.kind).toBe("rumour");
    expect(belief?.confidence).toBe(55);
    expect(belief?.status).toBe("active");
  });

  it("refuses to plant anything in a person who does not exist", () => {
    const result = applyDeltas(world(), [plant("a-man-who-never-was", "Anything at all.", "fact", 90)], context());
    expect(result.rejected[0]!.reason).toContain('No character "a-man-who-never-was"');
    expect(result.rejected[0]!.kind).toBe("reference");
  });
});

describe("battle", () => {
  /** Two hostile armies standing on the same ground, which is all a battle needs. */
  const facing = (state: WorldState = world()): WorldState => {
    const roman = state.material.forces.find((force) => force.polityId === "rome")!;
    const punic = state.material.forces.find((force) => force.polityId === "carthage")!;
    return {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === punic.id ? { ...force, locationId: roman.locationId } : force)),
      },
    };
  };

  const give = (attackerId: string, defenderId: string): WorldDelta => ({
    op: "force_engage",
    forceRef: attackerId,
    targetForceRef: defenderId,
    posture: "offer_battle",
    tactic: null,
    reason: "They are in front of us and we will not be given a better day.",
  });

  const sides = (state: WorldState) => ({
    roman: state.material.forces.find((force) => force.polityId === "rome")!,
    punic: state.material.forces.find((force) => force.polityId === "carthage")!,
  });

  it("costs men, and the engine decides how many", () => {
    const before = facing();
    const { roman, punic } = sides(before);
    const men = (state: WorldState, id: string) =>
      state.material.forces.find((force) => force.id === id)!.personnel.reduce((sum, category) => sum + category.fit, 0);

    const result = applyDeltas(before, [give(roman.id, punic.id)], context());
    expect(result.rejected).toHaveLength(0);
    expect(men(result.world, roman.id) + men(result.world, punic.id)).toBeLessThan(men(before, roman.id) + men(before, punic.id));
  });

  it("puts the battle in the record, publicly, as the historian's own material", () => {
    const before = facing();
    const { roman, punic } = sides(before);
    const result = applyDeltas(before, [give(roman.id, punic.id)], context());

    const battle = result.factProposals.find((fact) => fact.kind === "battle");
    expect(battle).toBeDefined();
    expect(battle!.visibility).toBe("public");
    expect(battle!.significance).toBeGreaterThanOrEqual(75);
  });

  it("fights the same battle twice from the same burst, so a replay agrees with itself", () => {
    const before = facing();
    const { roman, punic } = sides(before);
    const once = applyDeltas(before, [give(roman.id, punic.id)], context());
    const twice = applyDeltas(before, [give(roman.id, punic.id)], context());
    expect(twice.world.material.forces).toEqual(once.world.material.forces);
  });

  it("keeps the paper strength honest with the men who are left", () => {
    const before = facing();
    const { roman, punic } = sides(before);
    const result = applyDeltas(before, [give(roman.id, punic.id)], context());
    for (const force of result.world.material.forces) {
      expect(force.authorizedStrength).toBe(Math.max(1, force.personnel.reduce((sum, category) => sum + category.fit, 0)));
    }
  });

  it("never says a province passed to the people who already held it", () => {
    // Found live: a beaten defender who kept the ground produced "Boii passed
    // to Boii" in a Chronicle, which is nonsense and also untrue.
    const before = facing();
    const { roman, punic } = sides(before);
    const result = applyDeltas(before, [give(roman.id, punic.id)], context());
    for (const fact of result.factProposals) {
      expect(fact.summary).not.toMatch(/(\b\w+\b) passed to \1\./);
    }
  });

  it("refuses a battle between armies that are nowhere near each other", () => {
    const before = world();
    const { roman, punic } = sides(before);
    const result = applyDeltas(before, [give(roman.id, punic.id)], context());
    expect(result.rejected[0]!.reason).toContain("until one of them marches");
    expect(result.rejected[0]!.kind).toBe("world");
  });

  it("refuses a battle between two armies of the same power", () => {
    const before = facing();
    const { roman } = sides(before);
    const twoRoman: WorldState = {
      ...before,
      material: {
        ...before.material,
        forces: [...before.material.forces, { ...roman, id: "second-legion", name: "The second legion" }],
      },
    };
    const result = applyDeltas(twoRoman, [give(roman.id, "second-legion")], context());
    expect(result.rejected[0]!.reason).toContain("answer to the same power");
  });

  it("refuses a battle a force that no longer exists is supposed to fight", () => {
    const before = facing();
    const { roman } = sides(before);
    const result = applyDeltas(before, [give(roman.id, "an-army-of-ghosts")], context());
    expect(result.rejected[0]!.reason).toContain('No force "an-army-of-ghosts"');
    expect(result.rejected[0]!.kind).toBe("reference");
  });
});

describe("whose act it is", () => {
  const givingTheBoiiAChief: WorldDelta = {
    op: "character_create",
    localId: "boii_chief",
    name: "Ategnatos",
    polityId: "carthage",
    provinceId: null,
    age: 44,
    officeLabel: null,
    traits: [],
    wealth: 0,
    generatedBecause: "A people being invaded has someone to lead it.",
  };

  it("does not accuse the ruler of insubordination for what another power does", () => {
    // Found running a live model: one tax order produced ten breaches, most of
    // them the world filling in countries the consul had nothing to do with.
    const result = applyDeltas(world(), [givingTheBoiiAChief], context({ actsForTheWorld: true }));
    expect(result.applied).toHaveLength(1);
    expect(result.breaches).toHaveLength(0);
  });

  it("still holds the ruler to account inside their own polity", () => {
    const result = applyDeltas(
      world(),
      [{ op: "money_transfer", fromAccountRef: "quintus-purse", toAccountRef: null, amount: 100, reason: "Helping himself to a rival's money." }],
      context({ actsForTheWorld: true }),
    );
    expect(result.breaches).toHaveLength(1);
  });

  it("holds a person to account for reaching into another power, which is the whole of insubordination", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: "legio-i", locationId: "tun-13205935b88806172084765", reason: "Marching a legion that is not his." }],
      // Hanno acting through his own cognition: nobody is speaking for him.
      context({ actorRef: { kind: "character", id: "hanno" } }),
    );
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]!.reason).toContain("No active grant");
  });

  it("does not treat meaning to do something as doing it", () => {
    // Found live: an intention has no scope of its own, so it fell back to the
    // whole polity and an official who merely resolved to act was recorded as
    // having exceeded his authority over the republic.
    const result = applyDeltas(
      world(),
      [{ op: "character_intent_set", actorCharacterRef: "hanno", actionType: "prepare", targetRefs: [], rationale: "He means to see how the levy goes.", priority: 40, visibility: "private" }],
      context({ actorRef: { kind: "character", id: "hanno" } }),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.breaches).toHaveLength(0);
  });

  it("treats a country's private aims as nobody's personal act", () => {
    const result = applyDeltas(
      world(),
      [{ op: "polity_outlook_set", polityId: "carthage", primaryObjective: "Keep Sicily.", concerns: [], intentions: [], riskTolerance: 40, reason: "The situation moved." }],
      context({ actsForTheWorld: true }),
    );
    expect(result.breaches).toHaveLength(0);
  });
});
