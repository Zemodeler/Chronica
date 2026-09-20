import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, allOffices, buildAuthorityIndex, localRef, vacateOfficesOf, type Office, type WorldDelta, type WorldState } from "@chronica/shared";
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
      [{ op: "force_modify", forceRef: "legio-i", locationId: "ita-72843720b81376294924159-sicily-southeast", reason: "Marching without authority." }],
      context({ actorRef: { kind: "character", id: "hanno" } }),
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]!.reason).toContain("No active grant");
    expect(result.world.material.forces.find((f) => f.id === "legio-i")!.locationId).toBe("ita-72843720b81376294924159-sicily-southeast");
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
          officeLabel: "Military Quaestor", officeAuthorises: [],
          traits: ["methodical", "politically cautious"],
          standing: null, wealth: 250,
          generatedBecause: "Responsible for financing the current mobilization.",
        },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const created = result.world.characters.find((c) => c.name === "Marcus Fabius Varro");
    expect(created).toBeDefined();
    // Stored as the registry's own words, not as the free text the world used.
    // "methodical" and "politically cautious" were carried verbatim onto the
    // character and conferred nothing, because the dialogue guidance NPC
    // prompts read and the incompatibilities the observation rule checks both
    // live in `TRAIT_REGISTRY` and neither of those is in it.
    expect(created!.traits).toEqual(["cautious", "disciplined"]);
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
        { op: "character_create", localId: "merchant", name: "Titus Sestius", polityId: "rome", provinceId: null, age: 50, officeLabel: null, officeAuthorises: [], traits: [], standing: null, wealth: 4_000, generatedBecause: "Somebody had to be rich enough to lend." },
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
    officeLabel: null, officeAuthorises: [],
    traits: [],
    standing: null, wealth: 0,
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
      [{ op: "force_modify", forceRef: "legio-i", locationId: "ita-72843720b81376294924159-sicily-southeast", reason: "Marching a legion that is not his." }],
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

describe("threads of history", () => {
  const open: WorldDelta = {
    op: "storyline_open", localId: "plot", seedKey: "seed-1", title: "The Quaestor's Silence",
    participantRefs: ["quintus-fabius"], provinceId: null, phase: "brewing",
    stakes: "Whether the consul's rival can gather the Senate against him unnoticed.",
    nextDevelopment: "Fabius sounds out the patrician bloc.", visibility: "private", reason: "The world stirs.",
  };

  it("opens a thread with an engine id, its participants resolved, and the world as its author", () => {
    const result = applyDeltas(world(), [open], context({ actsForTheWorld: true }));
    expect(result.rejected).toHaveLength(0);
    const storyline = result.world.storylines[0]!;
    expect(storyline.id).toBe(result.assignedIds.get("plot"));
    expect(storyline.origin).toBe("world");
    expect(storyline.seedKey).toBe("seed-1");
    expect(storyline.participantIds).toEqual(["quintus-fabius"]);
  });

  it("drops a country, a force or a movement named among the participants and keeps the thread", () => {
    const result = applyDeltas(world(), [
      { op: "generic_entity_create", localId: "cult", kind: "faction", label: "The Etrurian Renewal", ownerRef: null, attributes: {}, reason: "A movement." },
      { ...open, participantRefs: ["rome", "legio-i", "local:cult", "quintus-fabius"] },
    ], context({ actsForTheWorld: true }));
    expect(result.rejected).toHaveLength(0);
    expect(result.world.storylines[0]!.participantIds).toEqual(["quintus-fabius"]);
  });

  it("opens a thread with no people in it, on a province alone", () => {
    const result = applyDeltas(world(), [{ ...open, participantRefs: [], provinceId: "ita-local-23120603B86473916475875" }], context({ actsForTheWorld: true }));
    expect(result.rejected).toHaveLength(0);
    expect(result.world.storylines[0]!.participantIds).toEqual([]);
  });

  it("refuses a thread naming a participant who does not exist", () => {
    const result = applyDeltas(world(), [{ ...open, participantRefs: ["nobody"] }], context());
    expect(result.rejected[0]!.kind).toBe("reference");
  });

  it("advances a thread and closes it, and never advances it again", () => {
    const opened = applyDeltas(world(), [open], context());
    const id = opened.assignedIds.get("plot")!;
    const advanced = applyDeltas(opened.world, [
      { op: "storyline_advance", storylineRef: id, development: "Fabius wins over two senators.", phase: "escalating", nextDevelopment: "A motion is drafted.", addParticipantRefs: [], reason: "It moves." },
      { op: "storyline_advance", storylineRef: id, development: "The plot collapses.", phase: "closed", addParticipantRefs: [], reason: "It ends." },
      { op: "storyline_advance", storylineRef: id, development: "Nothing more.", addParticipantRefs: [], reason: "Too late." },
    ], context());
    const storyline = advanced.world.storylines[0]!;
    expect(storyline.history).toEqual(["Fabius wins over two senators.", "The plot collapses."]);
    expect(storyline.phase).toBe("closed");
    expect(storyline.closedAtStep).toBe(0);
    expect(advanced.rejected).toHaveLength(1);
    expect(advanced.rejected[0]!.kind).toBe("world");
  });

  it("records no breach for the world's bookkeeping, even inside the ruler's own polity", () => {
    // A thread and a circumstance are powers no office holds. Judged against
    // the consul's office they would have been the sixth false insubordination.
    const result = applyDeltas(world(), [
      open,
      { op: "character_pressure_set", characterRef: "quintus-fabius", action: "create", kind: "political_danger", intensity: 60, label: "Afraid of being found out.", reviewInDays: 30, expiresInDays: null, visibility: "private", reason: "The plot weighs on him." },
    ], context({ actsForTheWorld: true }));
    expect(result.breaches).toHaveLength(0);
    expect(result.applied).toHaveLength(2);
  });
});

describe("pressures on a person", () => {
  const create: WorldDelta = { op: "character_pressure_set", characterRef: "quintus-fabius", action: "create", kind: "debt", intensity: 55, label: "A loan called in.", reviewInDays: 20, expiresInDays: 200, visibility: "polity", reason: "Money." };

  it("creates, refreshes and resolves a pressure of one kind", () => {
    const created = applyDeltas(world(), [create], context());
    const pressure = created.world.characterPressures.find((candidate) => candidate.characterId === "quintus-fabius" && candidate.kind === "debt")!;
    expect(pressure.intensity).toBe(55);
    expect(pressure.expiresAtStep).toBe(200);

    const refreshed = applyDeltas(created.world, [{ ...create, action: "refresh", intensity: 20 }], context());
    expect(refreshed.world.characterPressures.filter((candidate) => candidate.kind === "debt" && candidate.status === "active")).toHaveLength(1);
    expect(refreshed.world.characterPressures.find((candidate) => candidate.id === pressure.id)!.intensity).toBe(75);

    const resolved = applyDeltas(refreshed.world, [{ ...create, action: "resolve" }], context());
    expect(resolved.world.characterPressures.find((candidate) => candidate.id === pressure.id)!.status).toBe("resolved");
  });

  it("creates on refresh when there is nothing to refresh, and refuses to lift what is not there", () => {
    const refreshed = applyDeltas(world(), [{ ...create, action: "refresh" }], context());
    expect(refreshed.world.characterPressures.some((candidate) => candidate.kind === "debt")).toBe(true);
    const lifted = applyDeltas(world(), [{ ...create, action: "resolve" }], context());
    expect(lifted.rejected[0]!.kind).toBe("world");
  });
});

describe("letters between powers", () => {
  const send = (overrides: Partial<Extract<WorldDelta, { op: "diplomatic_message_send" }>> = {}): WorldDelta => ({
    op: "diplomatic_message_send",
    localId: "letter",
    kind: "alliance_offer",
    fromPolityId: "rome",
    fromCharacterRef: "marcus-atilius",
    toPolityId: "syracuse",
    toCharacterRef: null,
    subject: "An understanding over the strait",
    terms: "Rome offers Syracuse an alliance against any power that closes the strait.",
    replyWithinDays: 30,
    inReplyToRef: null,
    visibility: "polity",
    reason: "The strait cannot be held alone.",
    ...overrides,
  });

  it("puts a letter in the world that somebody has to answer", () => {
    const result = applyDeltas(world(), [send()], context());

    expect(result.rejected).toHaveLength(0);
    const letter = result.world.diplomacy[0]!;
    expect(letter.status).toBe("awaiting_reply");
    expect(letter.toPolityId).toBe("syracuse");
    // Days in, a step out: the model never states a date.
    expect(letter.replyDueByStep).toBe(result.world.elapsedStep + 30);
  });

  it("moves the sender's trust by how the answer came back", () => {
    const sent = applyDeltas(world(), [send()], context());
    const letterId = sent.world.diplomacy[0]!.id;
    const answered = applyDeltas(
      sent.world,
      [{ op: "diplomatic_message_answer", messageRef: letterId, answer: "refused", answerText: "Syracuse will not bind itself to Rome.", reason: "It would cost more than it buys." }],
      context({ actorRef: { kind: "character", id: "hieron" } }),
    );

    expect(answered.rejected).toHaveLength(0);
    expect(answered.world.diplomacy[0]!.status).toBe("answered");
    const stance = answered.world.polityStances.find((candidate) => candidate.polityId === "rome" && candidate.towardPolityId === "syracuse")!;
    expect(stance.trustScore).toBeLessThan(0);
  });

  it("refuses to answer the same letter twice", () => {
    const sent = applyDeltas(world(), [send()], context());
    const letterId = sent.world.diplomacy[0]!.id;
    const answer: WorldDelta = { op: "diplomatic_message_answer", messageRef: letterId, answer: "accepted", answerText: "Agreed.", reason: "It suits us." };
    const once = applyDeltas(sent.world, [answer], context());
    const twice = applyDeltas(once.world, [answer], context());

    expect(twice.rejected).toHaveLength(1);
    expect(twice.rejected[0]!.kind).toBe("world");
  });

  it("records a senator writing to a foreign power in Rome's name as a breach", () => {
    // Not an impossibility -- private correspondence with a foreign power is
    // exactly the kind of act VISION §12 exists to make expressible.
    const result = applyDeltas(world(), [send({ fromCharacterRef: "quintus-fabius" })], context({ actorRef: { kind: "character", id: "quintus-fabius" } }));

    expect(result.rejected).toHaveLength(0);
    expect(result.breaches.length).toBeGreaterThan(0);
    expect(result.world.diplomacy).toHaveLength(1);
  });

  it("will not carry a letter to a power that does not exist", () => {
    const result = applyDeltas(world(), [send({ toPolityId: "atlantis" })], context());
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("reference");
  });
});

describe("what the powers have standing between them", () => {
  const declare = (kind: "war" | "peace", overrides: Partial<Extract<WorldDelta, { op: "agreement_open" }>> = {}): WorldDelta => ({
    op: "agreement_open",
    localId: `${kind}-1`,
    kind,
    polityId: "rome",
    otherPolityId: "carthage",
    terms: kind === "war" ? "Over the strait and the cities on it." : "Both withdraw behind the strait.",
    forDays: null,
    sourceMessageRef: null,
    visibility: "public",
    reason: "The Senate has resolved it.",
    ...overrides,
  });

  it("holds a war as a fact about two powers rather than a number", () => {
    const result = applyDeltas(world(), [declare("war")], context());
    expect(result.rejected).toHaveLength(0);
    expect(result.world.polityAgreements[0]!.kind).toBe("war");
  });

  it("makes peace close the war it ends, in one act", () => {
    const atWarNow = applyDeltas(world(), [declare("war")], context());
    const settled = applyDeltas(atWarNow.world, [declare("peace")], context());

    expect(settled.rejected).toHaveLength(0);
    const war = settled.world.polityAgreements.find((agreement) => agreement.kind === "war")!;
    expect(war.status).toBe("ended");
    expect(settled.world.polityAgreements.find((agreement) => agreement.kind === "peace")!.status).toBe("active");
  });

  it("will not let two powers stand in the same agreement twice", () => {
    const once = applyDeltas(world(), [declare("war")], context());
    const twice = applyDeltas(once.world, [declare("war", { localId: "war-2" })], context());
    expect(twice.rejected).toHaveLength(1);
  });

  it("refuses a battle between powers at peace until somebody breaks it", () => {
    // How most wars start, but not something the world should slide into
    // without anybody having decided it.
    const state = world();
    const roman = state.material.forces.find((force) => force.polityId === "rome")!;
    const facing: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.polityId === "carthage" ? { ...force, locationId: roman.locationId } : force)),
      },
    };
    const atPeace = applyDeltas(facing, [declare("peace")], context());
    const engage: WorldDelta = { op: "force_engage", forceRef: "legio-i", targetForceRef: "carthaginian-army", posture: "offer_battle", tactic: null, reason: "Force the issue." };
    const refused = applyDeltas(atPeace.world, [engage], context());

    expect(refused.rejected.some((rejection) => rejection.reason.includes("stand in peace"))).toBe(true);
    const war = applyDeltas(refused.world, [declare("war", { localId: "war-2" }), engage], context());
    expect(war.rejected).toHaveLength(0);
  });
});

describe("getting an army from here to there", () => {
  const march = (to: string): WorldDelta => ({ op: "force_modify", forceRef: "legio-i", locationId: to, reason: "March." });
  const terrains = definition.map.terrains;

  it("lets an army step to ground it borders", () => {
    const result = applyDeltas(world(), [march("ita-72843720b81376294924159-sicily-southeast")], context({ terrains }));
    expect(result.rejected).toHaveLength(0);
    expect(result.world.material.forces.find((force) => force.id === "legio-i")!.locationId).toBe("ita-72843720b81376294924159-sicily-southeast");
  });

  it("refuses a march across the map, and says how far it actually is", () => {
    // The map graph has been specified from the beginning and nothing read it,
    // so a legion could be in Sicily in one delta and Africa in the next.
    const result = applyDeltas(world(), [march("tun-13205935b88806172084765")], context({ terrains }));

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("world");
    // This fixture's Africa has no edges at all, so the honest answer is that
    // no road leads there -- not a distance.
    expect(result.rejected[0]!.reason).toContain("cannot reach");
    expect(result.rejected[0]!.reason).toContain("force_move");
    expect(result.world.material.forces.find((force) => force.id === "legio-i")!.locationId).toBe(world().material.forces.find((force) => force.id === "legio-i")!.locationId);
  });

  it("still refuses a province that does not exist, as a reference fault", () => {
    const result = applyDeltas(world(), [march("atlantis")], context({ terrains }));
    expect(result.rejected[0]!.kind).toBe("reference");
  });

  it("holds a force to the crossings both sides of the edge admit", () => {
    // An edge is legal only where the terrain on both ends admits its crossing.
    // Declaring the Roman province land-only closes the strait to it.
    const state = world();
    const landlocked = definition.map.terrains.map((terrain) => ({ ...terrain, allowedCrossings: ["pass" as const] }));
    const result = applyDeltas(state, [march("ita-72843720b81376294924159-sicily-southeast")], context({ terrains: landlocked }));

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("crossing");
  });
});

describe("crossing water", () => {
  // The Punic Wars scenario is the one with a strait in it.
  const punicWorld = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const punicDefinition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const punicContext = (overrides: Partial<ApplyContext> = {}): ApplyContext => ({
    now: { day: 0, minute: 540 },
    actorRef: { kind: "character", id: "gaius-genucius" },
    offices: punicDefinition.government.offices,
    warfare: punicDefinition.warfare,
    terrains: punicDefinition.map.terrains,
    ids: createIdFactory("sea"),
    gameId: "game-sea",
    ...overrides,
  });

  /** The consular army standing on the Italian shore of the strait. */
  const atTheStrait = (state: WorldState = punicWorld()): WorldState => ({
    ...state,
    material: {
      ...state.material,
      forces: state.material.forces.map((force) =>
        force.id === "roman-field-army" ? { ...force, locationId: "punic-italy-bruttian-highlands" } : force),
    },
  });

  const cross: WorldDelta = {
    op: "force_modify",
    forceRef: "roman-field-army",
    locationId: "ita-72843720b81376294924159-sicily-northeast",
    reason: "Cross to Messana.",
  };

  it("refuses to walk an army across the strait", () => {
    // Authored as a land edge because nothing could tell the difference, which
    // is how a naval war came to be fightable on foot.
    const withoutHulls: WorldState = (() => {
      const state = atTheStrait();
      return { ...state, material: { ...state.material, forces: state.material.forces.filter((force) => force.id !== "allied-greek-hulls") } };
    })();
    const result = applyDeltas(withoutHulls, [cross], punicContext());

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("without ships");
  });

  it("carries the army over when there are hulls to carry it, and the ships go too", () => {
    const state = atTheStrait();
    const carried: WorldState = {
      ...state,
      material: {
        ...state.material,
        // Enough hulls for the men aboard: 18 ships at thirty men each.
        forces: state.material.forces.map((force) =>
          force.id === "roman-field-army" ? { ...force, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 500, unavailable: [] }] } : force),
      },
    };
    const result = applyDeltas(carried, [cross], punicContext());

    expect(result.rejected).toHaveLength(0);
    const force = (id: string) => result.world.material.forces.find((candidate) => candidate.id === id)!;
    expect(force("roman-field-army").locationId).toBe("ita-72843720b81376294924159-sicily-northeast");
    // A fleet that ferries an army and stays behind has not sailed anywhere.
    expect(force("allied-greek-hulls").locationId).toBe("ita-72843720b81376294924159-sicily-northeast");
  });

  it("lets a fleet cross on its own account", () => {
    const result = applyDeltas(
      punicWorld(),
      [{ op: "force_modify", forceRef: "carthaginian-fleet", locationId: "tun-13205935b88806172084765", reason: "Home to Carthage." }],
      punicContext({ actorRef: { kind: "character", id: "hannibal-gisco" } }),
    );
    expect(result.rejected).toHaveLength(0);
  });

  it("will not have ships and an army give battle to each other", () => {
    const state = punicWorld();
    const facing: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) =>
          force.id === "carthaginian-fleet" ? { ...force, locationId: "punic-italy-latium" } : force),
      },
      polityAgreements: [{
        id: "war-1", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "Open war.",
        sinceStep: 0, untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
      }],
    };
    const result = applyDeltas(
      facing,
      [{ op: "force_engage", forceRef: "roman-field-army", targetForceRef: "carthaginian-fleet", posture: "offer_battle", tactic: null, reason: "Drive them off." }],
      punicContext(),
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("same element");
  });
});

describe("ground changing hands", () => {
  /** A province held by someone, and one of its neighbours. */
  function frontier(state: WorldState): { held: string; next: string; holder: string } | null {
    for (const edge of state.map.edges) {
      const from = state.map.provinces.find((province) => province.id === edge.from);
      const to = state.map.provinces.find((province) => province.id === edge.to);
      if (from === undefined || to === undefined) continue;
      if (from.controllerPolityId === null || from.controllerPolityId === to.controllerPolityId) continue;
      return { held: from.id, next: to.id, holder: from.controllerPolityId };
    }
    return null;
  }

  it("lets a power take ground next to ground it already holds", () => {
    const before = world();
    const border = frontier(before);
    if (border === null) return;
    const result = applyDeltas(
      before,
      [{ op: "province_control_set", provinceId: border.next, toPolityRef: border.holder, firmnessBps: 2_000, reason: "Taken in the campaign." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    const taken = result.world.map.provinces.find((province) => province.id === border.next)!;
    expect(taken.controllerPolityId).toBe(border.holder);
    // Control taken is not control held.
    expect(taken.controlFirmnessBps).toBe(2_000);
  });

  it("refuses ground on the far side of the world as friction, not as an error", () => {
    // "A polity cannot own a region not adjacent to its own" is the blunt rule,
    // and taken literally it forbids Rome holding Sicily. The test is reach:
    // an army standing there, or ground of your own next to it.
    const before = world();
    const roman = new Set(before.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id));
    const neighbours = new Set(
      before.map.edges.flatMap((edge) => (roman.has(edge.from) ? [edge.to] : roman.has(edge.to) ? [edge.from] : [])),
    );
    const distant = before.map.provinces.find(
      (province) => !roman.has(province.id) && !neighbours.has(province.id) && !before.material.forces.some((force) => force.polityId === "rome" && force.locationId === province.id),
    );
    if (distant === undefined) return;

    const result = applyDeltas(
      before,
      [{ op: "province_control_set", provinceId: distant.id, toPolityRef: "rome", firmnessBps: 5_000, reason: "Annexed." }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("world");
    expect(result.world.map.provinces.find((province) => province.id === distant.id)!.controllerPolityId).toBe(distant.controllerPolityId);
  });

  it("lets an army standing on the ground take it, wherever the ground is", () => {
    const before = world();
    const force = before.material.forces[0]!;
    const province = before.map.provinces.find((candidate) => candidate.id === force.locationId)!;
    if (province.controllerPolityId === force.polityId) return;
    const result = applyDeltas(
      before,
      [{ op: "province_control_set", provinceId: province.id, toPolityRef: force.polityId, firmnessBps: 1_500, reason: "The army holds the ground." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.world.map.provinces.find((candidate) => candidate.id === province.id)!.controllerPolityId).toBe(force.polityId);
  });
});

describe("a new power on the map", () => {
  const romanProvinces = (state: WorldState) => state.map.provinces.filter((province) => province.controllerPolityId === "rome");

  it("gives a rising its own country, its own ground, and a war with what it left", () => {
    const before = world();
    const breaking = romanProvinces(before)[0];
    if (breaking === undefined) return;

    const result = applyDeltas(
      before,
      [{
        op: "polity_create",
        localId: "rebels",
        name: "Campanian Liberation Host",
        breaksFromPolityId: "rome",
        provinceIds: [breaking.id],
        capitalSettlementId: null,
        reason: "The Campanians rise.",
      }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const created = result.world.map.polities.find((polity) => polity.name === "Campanian Liberation Host")!;
    expect(created).toBeDefined();
    // No land is left unowned: the ground goes with them, held loosely.
    const ground = result.world.map.provinces.find((province) => province.id === breaking.id)!;
    expect(ground.controllerPolityId).toBe(created.id);
    expect(ground.controlFirmnessBps).toBeLessThan(before.map.provinces.find((province) => province.id === breaking.id)!.controlFirmnessBps + 1);
    // A secession nobody contests is an administrative reform.
    expect(result.world.polityAgreements.some(
      (agreement) => agreement.kind === "war" && agreement.status === "active"
        && ((agreement.polityId === "rome" && agreement.otherPolityId === created.id) || (agreement.polityId === created.id && agreement.otherPolityId === "rome")),
    )).toBe(true);
  });

  it("refuses ground the power it breaks from does not hold", () => {
    const before = world();
    const foreign = before.map.provinces.find((province) => province.controllerPolityId !== null && province.controllerPolityId !== "rome");
    if (foreign === undefined) return;
    const result = applyDeltas(
      before,
      [{ op: "polity_create", localId: "rebels", name: "The Free Cities", breaksFromPolityId: "rome", provinceIds: [foreign.id], capitalSettlementId: null, reason: "A rising." }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.world.map.polities.some((polity) => polity.name === "The Free Cities")).toBe(false);
  });

  it("refuses a country made of unconnected scraps", () => {
    // A rebellion is a piece of a country coming away, not a scatter of towns.
    const before = world();
    const roman = romanProvinces(before);
    if (roman.length < 2) return;
    const first = roman[0]!;
    const apart = roman.find((province) => !before.map.edges.some(
      (edge) => (edge.from === first.id && edge.to === province.id) || (edge.to === first.id && edge.from === province.id),
    ) && province.id !== first.id);
    if (apart === undefined) return;

    const result = applyDeltas(
      before,
      [{ op: "polity_create", localId: "rebels", name: "The Scattered League", breaksFromPolityId: "rome", provinceIds: [first.id, apart.id], capitalSettlementId: null, reason: "A rising." }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.world.map.polities.some((polity) => polity.name === "The Scattered League")).toBe(false);
  });

  it("does not record a country coming apart as the ruler's own insubordination", () => {
    // The seventh way this check has found to manufacture insubordination out
    // of the world simply moving.
    const before = world();
    const breaking = romanProvinces(before)[0];
    if (breaking === undefined) return;
    const result = applyDeltas(
      before,
      [{ op: "polity_create", localId: "rebels", name: "Campanian Liberation Host", breaksFromPolityId: "rome", provinceIds: [breaking.id], capitalSettlementId: null, reason: "The Campanians rise." }],
      context({ actsForTheWorld: true }),
    );
    expect(result.breaches).toHaveLength(0);
  });
});

describe("how tightly a power is held together", () => {
  it("never lets ground taken from a loose people be held firmly", () => {
    // "Tribes fiercely resist being conquered", as the number the rest of the
    // engine already reads. A conqueror who beats the Boii has beaten the Boii
    // he met; the rest of them do not know they are conquered.
    const before = world();
    const loose: WorldState = {
      ...before,
      map: {
        ...before.map,
        polities: before.map.polities.map((polity) => (polity.id === "carthage" ? { ...polity, cohesionBps: 2_500 } : polity)),
      },
    };
    const punic = loose.map.provinces.find((province) => province.controllerPolityId === "carthage");
    if (punic === undefined) return;
    const force = loose.material.forces.find((candidate) => candidate.polityId !== "carthage");
    if (force === undefined) return;
    const withArmy: WorldState = {
      ...loose,
      material: { ...loose.material, forces: loose.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, locationId: punic.id } : candidate)) },
    };

    const result = applyDeltas(
      withArmy,
      [{ op: "province_control_set", provinceId: punic.id, toPolityRef: force.polityId, firmnessBps: 9_000, reason: "Stormed." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    // Asked for 9 000 and granted the loser's own cohesion instead.
    expect(result.world.map.provinces.find((province) => province.id === punic.id)!.controlFirmnessBps).toBe(2_500);
  });

  it("gives a rising a looser grip than the power it broke from", () => {
    const before = world();
    const breaking = before.map.provinces.find((province) => province.controllerPolityId === "rome");
    if (breaking === undefined) return;
    const result = applyDeltas(
      before,
      [{ op: "polity_create", localId: "rebels", name: "The Latin Revolt", breaksFromPolityId: "rome", provinceIds: [breaking.id], capitalSettlementId: null, reason: "A rising." }],
      context(),
    );
    const created = result.world.map.polities.find((polity) => polity.name === "The Latin Revolt")!;
    const rome = before.map.polities.find((polity) => polity.id === "rome")!;
    expect(created.cohesionBps).toBeLessThan(rome.cohesionBps);
  });
});

describe("offices that actually move", () => {
  it("seats a person the world creates into the office it says it made them", () => {
    // The label was parsed and thrown on the floor, so every magistrate the
    // world invented held no office and could do nothing a magistrate does.
    const before = world();
    const office = offices.find((candidate) => candidate.polityId === "rome");
    if (office === undefined) return;
    const filled = before.material.officeSeats.filter((seat) => seat.officeId === office.id && seat.status === "held").length;

    const result = applyDeltas(
      before,
      [{
        op: "character_create", localId: "quaestor", name: "Marcus Fabius Varro", polityId: "rome", provinceId: null,
        age: 38, officeLabel: office.label, officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "Responsible for financing the mobilization.",
      }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const created = result.world.characters.find((character) => character.name === "Marcus Fabius Varro");
    expect(created).toBeDefined();
    const seats = result.world.material.officeSeats.filter((seat) => seat.officeId === office.id && seat.status === "held");
    // Either they took a vacancy or the office gained its first seat; either
    // way somebody now holds it who did not before.
    expect(seats.length).toBeGreaterThanOrEqual(filled);
    if (created!.officeId !== null) {
      expect(created!.officeId).toBe(office.id);
      expect(seats.some((seat) => seat.holderCharacterId === created!.id)).toBe(true);
    }
  });

  it("makes the office when the government names one that does not exist yet", () => {
    // A scenario's four authored offices were the only ones that could ever
    // exist, so "name a quaestor to handle the war chest" matched nothing and
    // the man was created holding nothing.
    const before = world();
    const result = applyDeltas(
      before,
      [{
        op: "character_create", localId: "quaestor", name: "Titus of Ostia", polityId: "rome", provinceId: null,
        age: 40, officeLabel: "Prefect of the Levy", officeAuthorises: ["force_create", "money_transfer"],
        traits: [], standing: null, wealth: 300, generatedBecause: "To raise the men the campaign needs.",
      }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const titus = result.world.characters.find((character) => character.name === "Titus of Ostia")!;
    expect(titus.officeId).not.toBeNull();
    const made = result.world.offices.find((office) => office.id === titus.officeId)!;
    expect(made.label).toBe("Prefect of the Levy");
    expect(made.polityId).toBe("rome");
    // And the office is real: its powers confer authority like any other's.
    expect(made.authorisedActionIds).toContain("money_transfer");
    const index = buildAuthorityIndex(result.world.material, result.world.authorityGrants, allOffices(result.world, offices), result.world.elapsedStep);
    expect(index.grants.some((grant) => grant.holder.id === titus.id && grant.source === "office")).toBe(true);
  });

  it("makes the office real even when the caller states no powers at all", () => {
    // Which is every office the world has ever made. The prompt asks for
    // "officeAuthorises" and the answer has always been an empty list, so the
    // quaestor named to handle the war chest could not touch money.
    const result = applyDeltas(
      world(),
      [{
        op: "character_create", localId: "quaestor", name: "Servius Fulvius", polityId: "rome", provinceId: null,
        age: 44, officeLabel: "Quaestor of the War Chest", officeAuthorises: [],
        traits: [], standing: null, wealth: 200, generatedBecause: "Somebody has to keep the accounts of the campaign.",
      }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const servius = result.world.characters.find((character) => character.name === "Servius Fulvius")!;
    const made = result.world.offices.find((office) => office.id === servius.officeId)!;
    expect(made.authorisedActionIds).toContain("money_transfer");
    const index = buildAuthorityIndex(result.world.material, result.world.authorityGrants, allOffices(result.world, offices), result.world.elapsedStep);
    expect(index.grants.some((grant) => grant.holder.id === servius.id && grant.source === "office")).toBe(true);
  });

  it("does not leave a handle behind when the thing it named was never made", () => {
    // From a live game. `mint` writes the local handle before the delta can be
    // rejected, and the world was rolled back on rejection while the handles
    // were not -- so a creation that failed left `local:x` pointing at an id
    // nothing had ever created, and every later delta naming it was refused
    // with "No character character-<burst>-13 exists to command this force":
    // an id the model never wrote and cannot look up, in place of the one true
    // reason, which is that the person was never made.
    const result = applyDeltas(
      world(),
      [
        // Rejected: no such province, so nobody is created.
        {
          op: "character_create", localId: "ghost", name: "Nobody At All", polityId: "rome",
          provinceId: "no-such-province-anywhere", age: 40, officeLabel: null, officeAuthorises: [],
          traits: [], standing: null, wealth: 0, generatedBecause: "To prove a point.",
        },
        // And now somebody refers to them.
        {
          op: "character_intent_set", actorCharacterRef: "local:ghost", actionType: "prepare",
          targetRefs: [], rationale: "Doing something.", priority: 50, visibility: "private",
        },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(2);
    // The second refusal says what actually went wrong, and names the handle
    // the model itself wrote rather than an id the engine minted and dropped.
    expect(result.rejected[1]!.reason).toContain("local:ghost");
    expect(result.rejected[1]!.reason).not.toMatch(/character-[0-9a-f]{8}/);
  });

  it("names the near miss when a ref has lost its prefix", () => {
    // Engine ids are long -- `character-<burst uuid>-7` -- and a model copying
    // one back sometimes drops the prefix. "No character ... exists" is true,
    // unhelpful, and gives the repair retry nothing to work with.
    const before = world();
    const someone = before.characters[0]!;
    const stripped = someone.id.replace(/^character-/, "").replace(/^declared-/, "");
    if (stripped === someone.id) return;

    const result = applyDeltas(
      before,
      [{
        op: "character_intent_set", actorCharacterRef: stripped, actionType: "prepare",
        targetRefs: [], rationale: "Doing something.", priority: 50, visibility: "private",
      }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain(someone.id);
    expect(result.rejected[0]!.reason).toContain("Did you mean");
  });

  it("says nothing about a near miss when there is none", () => {
    const result = applyDeltas(
      world(),
      [{
        op: "character_intent_set", actorCharacterRef: "nobody-resembling-anything", actionType: "prepare",
        targetRefs: [], rationale: "Doing something.", priority: 50, visibility: "private",
      }],
      context(),
    );
    expect(result.rejected[0]!.reason).not.toContain("Did you mean");
  });

  it("enlarges an office that exists rather than inventing a second one beside it", () => {
    const before = world();
    const seat = before.material.officeSeats.find((candidate) => candidate.status === "held");
    const office = seat === undefined ? undefined : offices.find((candidate) => candidate.id === seat.officeId);
    if (office === undefined) return;

    const result = applyDeltas(
      before,
      [{
        op: "character_create", localId: "colleague", name: "The Other Consul", polityId: office.polityId, provinceId: null,
        age: 45, officeLabel: office.label, officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "The colleague for the year.",
      }],
      context(),
    );

    const colleague = result.world.characters.find((character) => character.name === "The Other Consul")!;
    expect(colleague.officeId).toBe(office.id);
    // No duplicate consulship was founded beside the real one.
    expect(result.world.offices.some((candidate) => candidate.label === office.label)).toBe(false);
  });

  it("empties a dead commander's seat, and stops it conferring his authority", () => {
    // `vacateOfficeSeatsFor` has existed since the character system was written
    // and had never been called: a consul killed in the field went on holding
    // the consulship, and office grants are derived from the seat.
    const before = world();
    const seat = before.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null);
    if (seat === undefined) return;
    const holderId = seat.holderCharacterId!;

    const after = vacateOfficesOf(before, holderId, "death", 10);
    expect(after.material.officeSeats.find((candidate) => candidate.id === seat.id)!.holderCharacterId).toBeNull();
    // And the mirror on the character, which the material-only function cannot reach.
    expect(after.characters.find((character) => character.id === holderId)!.officeId).toBeNull();
    const index = buildAuthorityIndex(after.material, after.authorityGrants, offices, 10);
    expect(index.grants.some((grant) => grant.holder.id === holderId && grant.source === "office")).toBe(false);
  });
});

describe("answering an order", () => {
  /** An order already on the record, put to somebody by somebody. */
  function withOrder(state: WorldState, issuerId: string, recipientId: string, standing: "binding" | "requested" | "presumptuous" = "binding"): WorldState {
    return {
      ...state,
      orderAttempts: [{
        id: "order-1",
        actionId: "action-1",
        issuerRef: { kind: "character", id: issuerId },
        recipientRef: { kind: "character", id: recipientId },
        claimedAuthorityGrantId: null,
        authorityCheck: { authorized: standing === "binding", grant: null, standing: null, reason: "The consul, under whom you serve." },
        instruction: "Hold the strait and let nothing cross.",
        standing,
        status: "issued" as const,
        recipientDecisionReason: null,
        issuedAtStep: 0,
        decidedAtStep: null,
        consequenceFactRefs: [],
      }],
    };
  }

  const pair = (state: WorldState): [string, string] => {
    const alive = state.characters.filter((character) => character.alive);
    return [alive[0]!.id, alive[1]!.id];
  };

  it("records no breach for the act of replying", () => {
    // The eighth way this check has found to manufacture insubordination.
    // `order_attempt_decide` fell through to the decider's own polity, so
    // every refusal AND every acceptance would have been recorded as the
    // recipient exceeding their authority over their own republic. It has
    // never fired only because no order attempt has ever been decided.
    const [issuer, recipient] = pair(world());
    for (const decision of ["accept", "refuse", "ignore", "delay"] as const) {
      const result = applyDeltas(
        withOrder(world(), issuer, recipient),
        [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision, reason: "As I judged best." }],
        context({ actorRef: { kind: "character", id: recipient } }),
      );
      expect(result.rejected, decision).toHaveLength(0);
      expect(result.breaches, decision).toHaveLength(0);
    }
  });

  it("makes a refusal an event somebody can read", () => {
    const [issuer, recipient] = pair(world());
    const result = applyDeltas(
      withOrder(world(), issuer, recipient, "binding"),
      [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision: "refuse", reason: "The strait cannot be held with the ships I have." }],
      context({ actorRef: { kind: "character", id: recipient } }),
    );

    expect(result.world.orderAttempts[0]!.status).toBe("refused");
    const fact = result.factProposals.find((candidate) => candidate.kind === "order_refused")!;
    expect(fact).toBeDefined();
    expect(fact.summary).toContain("cannot be held");
    // Defying a man who could command you is a headline; it must clear the bar.
    expect(fact.significance).toBeGreaterThanOrEqual(45);
    expect(fact.affectedRefs!.map((ref) => ref.id).sort()).toEqual([issuer, recipient].sort());
  });

  it("changes what the two of them think of each other, which nothing ever did", () => {
    // Every NPC's view of the player in every save was still the single seed
    // written at creation, step zero. `applySocialEvents` could write a
    // relation cause from the day it was built and the simulation never
    // handed it one.
    const [issuer, recipient] = pair(world());
    const viewOf = (state: WorldState, subject: string, target: string): number =>
      state.characters.find((character) => character.id === subject)
        ?.relations.find((relation) => relation.subjectCharacterId === target)
        ?.causes.length ?? 0;

    const before = withOrder(world(), issuer, recipient, "binding");
    const after = applyDeltas(
      before,
      [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision: "refuse", reason: "The strait cannot be held with the ships I have." }],
      context({ actorRef: { kind: "character", id: recipient } }),
    );
    expect(after.rejected).toHaveLength(0);
    expect(viewOf(after.world, issuer, recipient)).toBeGreaterThan(viewOf(before, issuer, recipient));
  });

  it("leaves a commander's opinion untouched by a subversion he does not know about", () => {
    // Which is exactly why subversion is a separate status from refusal.
    const [issuer, recipient] = pair(world());
    const before = withOrder(world(), issuer, recipient, "binding");
    const causes = (state: WorldState, subject: string, target: string): number =>
      state.characters.find((character) => character.id === subject)
        ?.relations.find((relation) => relation.subjectCharacterId === target)
        ?.causes.length ?? 0;

    const after = applyDeltas(
      before,
      [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision: "subvert", reason: "I agreed, and did otherwise." }],
      context({ actorRef: { kind: "character", id: recipient } }),
    );
    expect(after.world.orderAttempts[0]!.status).toBe("subverted");
    expect(causes(after.world, issuer, recipient)).toBe(causes(before, issuer, recipient));
    expect(causes(after.world, recipient, issuer)).toBeGreaterThan(causes(before, recipient, issuer));
  });

  it("weighs a declined request below a defied command", () => {
    const [issuer, recipient] = pair(world());
    const refusal = (standing: "binding" | "requested") => applyDeltas(
      withOrder(world(), issuer, recipient, standing),
      [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision: "refuse", reason: "No." }],
      context({ actorRef: { kind: "character", id: recipient } }),
    ).factProposals.find((candidate) => candidate.kind === "order_refused")!;

    expect(refusal("requested").significance).toBeLessThan(refusal("binding").significance);
  });

  it("keeps quiet compliance quiet, and known only to the man who did it", () => {
    const [issuer, recipient] = pair(world());
    const result = applyDeltas(
      withOrder(world(), issuer, recipient, "presumptuous"),
      [{ op: "order_attempt_decide", orderAttemptRef: "order-1", decision: "accept", reason: "He pays better than Rome." }],
      context({ actorRef: { kind: "character", id: recipient } }),
    );
    // Obeying a man with no standing to command you is not acceptance.
    expect(result.world.orderAttempts[0]!.status).toBe("subverted");
    const fact = result.factProposals.find((candidate) => candidate.kind === "order_subverted")!;
    expect(fact.visibility).toBe("private");
    expect(fact.knownToRefs!.map((ref) => ref.id)).toEqual([recipient]);
  });
});
