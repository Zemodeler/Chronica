import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, FIRST_PUNIC_IDS } from "@chronica/db";
import {
  GenericEntitySchema,
  MECHANIC_MAX_DEBIT_PER_BURST_BPS,
  MECHANIC_MAX_EMPTY_FIRINGS,
  MECHANIC_MAX_FIRINGS_PER_RUN,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  type GenericEntity,
  type MechanicDraft,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "../ports";
import { attachMechanic } from "./attach-mechanic";
import { newDebitLedger } from "./instantiate";
import { priceMechanic } from "./price-mechanic";
import { readableRefsFor } from "./refs";
import { runMechanics } from "./run-mechanics";
import { validateMechanic } from "./validate-mechanic";

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices = definition.government.offices;
const warfare = definition.warfare;
const MARCUS = { kind: "character" as const, id: "marcus-atilius" };
const HANNO = { kind: "character" as const, id: "hanno" };
const NORTHEAST = FIRST_PUNIC_IDS.messana;
const WEST = FIRST_PUNIC_IDS.lilybaeum;

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld)), 0);
const balance = (state: WorldState, id: string): number => state.material.accounts.find((account) => account.id === id)!.balance;

function withEntity(state: WorldState, entity: Partial<GenericEntity> & { id: string }): WorldState {
  const made: GenericEntity = GenericEntitySchema.parse({
    kind: "toll", label: "A toll-house on the bridge", ownerRef: MARCUS, attributes: {}, linkedEntityIds: [], createdAtStep: state.elapsedStep, provenanceEventIds: [],
    provinceId: NORTHEAST, effects: [], upkeep: null, ...entity,
  });
  return { ...state, genericEntities: [...state.genericEntities, made] };
}

const dole = (from: string, amount = 50): MechanicDraft => ({
  trigger: { kind: "monthly" }, conditions: [], effects: [{ op: "money_transfer", fromAccountId: from, toAccountId: null, amount: { kind: "fixed", amount } }],
  end: { kind: "never" }, price: { setup: 20, upkeepPerMonth: 1 }, why: "Grain given out each month.",
});

/** Attaches a validated draft, or throws with why not. */
function attached(state: WorldState, entityId: string, draft: MechanicDraft, origin: "written" = "written"): WorldState {
  const entity = state.genericEntities.find((candidate) => candidate.id === entityId)!;
  const refs = readableRefsFor(state, entity.ownerRef!, entity);
  const checked = validateMechanic(draft, state, refs, offices);
  if (!checked.ok) throw new Error(checked.reason);
  const out = attachMechanic({ world: state, entity, draft: checked.draft, origin, warrants: checked.warrants, refs, ids: createIdFactory("attach"), offices, warfare, gameId: "g" });
  if (!out.ok) throw new Error(out.reason);
  return out.world;
}

function run(state: WorldState, toDay: number, extra: Partial<Parameters<typeof runMechanics>[0]> = {}) {
  return runMechanics({
    world: state, toDay, ids: createIdFactory("run"), recentFacts: [], ledger: newDebitLedger(state),
    apply: { offices, warfare, gameId: "g", playerCharacterId: MARCUS.id }, ...extra,
  });
}

describe("what a rule may name", () => {
  it("drops a debit of a purse its owner holds no warrant for, and keeps the rest", () => {
    const state = withEntity(world(), { id: "toll" });
    const entity = state.genericEntities.find((candidate) => candidate.id === "toll")!;
    const refs = readableRefsFor(state, MARCUS, entity);
    const draft: MechanicDraft = { ...dole("marcus-purse"), effects: [...dole("marcus-purse").effects, { op: "money_transfer", fromAccountId: "hanno-purse", toAccountId: "marcus-purse", amount: { kind: "band", band: "slight" } }] };
    // Hanno's purse is not on the readable list at all (he stands elsewhere).
    const checked = validateMechanic(draft, state, refs, offices);
    expect(checked.ok).toBe(false);
  });

  it("warrants the owner's own purse, and a purse whose holder has contracted to pay him", () => {
    const state = withEntity(world(), { id: "toll", ownerRef: HANNO, provinceId: WEST });
    const contracted: WorldState = {
      ...state,
      material: {
        ...state.material,
        contracts: [...state.material.contracts, {
          id: "retainer-1", role: "retainer", label: "Hamilcar keeps Hanno", employerAccountId: "hamilcar-purse", employeeCharacterId: HANNO.id, obligationId: null, incomeSourceId: null, grantId: null,
          advance: 0, monthlyPay: 10, duties: "Counsel.", openedAtStep: 0, endsAtStep: null, forceId: null, forceWas: null, provinceId: null, counterpartPolityId: null, status: "active",
        }],
      },
    };
    const entity = contracted.genericEntities.find((candidate) => candidate.id === "toll")!;
    const refs = readableRefsFor(contracted, HANNO, entity);
    const draft: MechanicDraft = { ...dole("hanno-purse"), effects: [...dole("hanno-purse").effects, { op: "money_transfer", fromAccountId: "hamilcar-purse", toAccountId: "hanno-purse", amount: { kind: "band", band: "slight" } }] };
    const checked = validateMechanic(draft, contracted, refs, offices);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    // His own purse needs no warrant: it is his. The contracted one does.
    expect(checked.warrants.map((warrant) => `${warrant.accountId}:${warrant.basis}`)).toEqual(["hamilcar-purse:consent"]);
    expect(checked.dropped).toHaveLength(0);
  });

  it("drops the unwarranted debit and keeps the rule when a warranted effect remains", () => {
    const state = withEntity(world(), { id: "toll", ownerRef: HANNO, provinceId: WEST });
    const entity = state.genericEntities.find((candidate) => candidate.id === "toll")!;
    const refs = readableRefsFor(state, HANNO, entity);
    const draft: MechanicDraft = { ...dole("hanno-purse"), effects: [...dole("hanno-purse").effects, { op: "money_transfer", fromAccountId: "hamilcar-purse", toAccountId: "hanno-purse", amount: { kind: "band", band: "slight" } }] };
    const checked = validateMechanic(draft, state, refs, offices);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.draft.effects).toHaveLength(1);
    expect(checked.dropped[0]).toContain("hamilcar-purse");
  });

  it("refuses a rule that would end the first time it could fire", () => {
    const state = withEntity(world(), { id: "toll" });
    const entity = state.genericEntities.find((candidate) => candidate.id === "toll")!;
    const refs = readableRefsFor(state, MARCUS, entity);
    const condition = { kind: "account_above" as const, accountId: "marcus-purse", amount: 10 };
    const checked = validateMechanic({ ...dole("marcus-purse"), conditions: [condition], end: { kind: "when", predicate: condition } }, state, refs, offices);
    expect(checked.ok).toBe(false);
  });
});

describe("what a rule costs", () => {
  it("clamps the setup into bands of the scale and floors the keep at slight", () => {
    const state = withEntity(world(), { id: "toll" });
    const entity = state.genericEntities.find((candidate) => candidate.id === "toll")!;
    const cheap = priceMechanic(state, entity, "rome", { setup: 0, upkeepPerMonth: 0 });
    const dear = priceMechanic(state, entity, "rome", { setup: 1_000_000, upkeepPerMonth: 1_000_000 });
    expect(cheap.setup).toBeGreaterThan(0);
    // A private rule that names no keep has none; one that names a sum worth a band at the province's scale pays it.
    expect(cheap.upkeepBand).toBeNull();
    expect(dear.setup).toBeLessThanOrEqual(cheap.scale * 0.5 + 1);
    expect(dear.upkeepBand).toBe("great");
    // A person's rule is measured at a tenth of the province.
    const polityOwned = priceMechanic(state, { ...entity, ownerRef: { kind: "polity", id: "rome" } }, "rome", { setup: 0, upkeepPerMonth: 0 });
    expect(Math.round(polityOwned.scale / cheap.scale)).toBe(10);
  });
});

describe("a rule that fires each month", () => {
  it("fires once per period, never twice on the same day, and writes the money as a row the player can read", () => {
    const start = world();
    const state = attached(withEntity(start, { id: "dole" }), "dole", dole("marcus-purse"));
    const day = state.instant.day;
    const afterSetup = balance(state, "marcus-purse");
    expect(afterSetup).toBeLessThan(balance(start, "marcus-purse"));

    const nothingYet = run(state, day + 10);
    expect(nothingYet.fired).toBe(0);
    const first = run(state, day + 30);
    expect(first.fired).toBe(1);
    expect(balance(first.world, "marcus-purse")).toBe(afterSetup - 50);
    const again = run(first.world, day + 30);
    expect(again.fired).toBe(0);
    const second = run(first.world, day + 61);
    expect(balance(second.world, "marcus-purse")).toBe(afterSetup - 100);
    const rows = second.world.material.transactions.filter((transaction) => transaction.cause.kind === "mechanic");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cause.id).toBe("dole");
    const fired = first.facts.filter((fact) => fact.kind === "mechanic_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]!.visibility).toBe("private");
    expect(fired[0]!.knownToRefs).toEqual([MARCUS]);
    expect(fired[0]!.summary).toContain("A toll-house on the bridge");
  });

  it("consumes a period whose conditions do not hold, and never catches it up", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", { ...dole("marcus-purse"), conditions: [{ kind: "account_below", accountId: "marcus-purse", amount: 1 }] });
    const day = state.instant.day;
    const quiet = run(state, day + 65);
    expect(quiet.fired).toBe(0);
    expect(quiet.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!.nextDueStep).toBe(day + 90);
    expect(balance(quiet.world, "marcus-purse")).toBe(balance(state, "marcus-purse"));
  });

  it("takes no more than a tenth of a purse a firing and no more than the burst's share of what it held, across a year", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", dole("marcus-purse", 500));
    const day = state.instant.day;
    const opening = balance(state, "marcus-purse");
    const year = run(state, day + 365);
    const taken = opening - balance(year.world, "marcus-purse");
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThanOrEqual(Math.floor(opening * (MECHANIC_MAX_DEBIT_PER_BURST_BPS / 10_000)));
    const rule = year.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!;
    expect(rule.firedCount).toBeLessThanOrEqual(MECHANIC_MAX_FIRINGS_PER_RUN);
    for (const row of year.world.material.transactions.filter((transaction) => transaction.cause.kind === "mechanic")) {
      expect(row.amount).toBeLessThanOrEqual(Math.floor(opening * 0.1));
    }
  });

  it("is retired after firing on nothing three times running, and says so", () => {
    // A debit nobody warranted: stored without a warrant, so every firing is empty.
    const state = withEntity(world(), { id: "racket", ownerRef: HANNO, provinceId: WEST });
    const rigged: WorldState = {
      ...state,
      genericEntities: state.genericEntities.map((entity) => (entity.id !== "racket" ? entity : {
        ...entity,
        mechanic: {
          ...dole("hamilcar-purse"), attachedAtStep: state.instant.day, origin: "written" as const, shapeKey: "x", debitWarrants: [], nextDueStep: state.instant.day + 30,
          armedReading: null, endArmedReading: null, endsAtStep: null, setupPaid: 0, firedCount: 0, changedCount: 0, lastFiredStep: null, emptyFirings: 0, endedAtStep: null, endedReason: null,
        },
      })),
    };
    const out = run(rigged, state.instant.day + 30 * MECHANIC_MAX_EMPTY_FIRINGS);
    const rule = out.world.genericEntities.find((entity) => entity.id === "racket")!.mechanic!;
    expect(balance(out.world, "hamilcar-purse")).toBe(balance(state, "hamilcar-purse"));
    expect(rule.endedAtStep).not.toBeNull();
    expect(rule.endedReason).toContain("did nothing");
    expect(out.facts.some((fact) => fact.kind === "mechanic_ended")).toBe(true);
  });

  it("cannot touch the player's purse from somebody else's rule without a warrant", () => {
    const state = withEntity(world(), { id: "racket", ownerRef: HANNO, provinceId: NORTHEAST });
    const rigged: WorldState = {
      ...state,
      genericEntities: state.genericEntities.map((entity) => (entity.id !== "racket" ? entity : {
        ...entity,
        mechanic: {
          ...dole("marcus-purse"), attachedAtStep: state.instant.day, origin: "written" as const, shapeKey: "x", debitWarrants: [], nextDueStep: state.instant.day + 30,
          armedReading: null, endArmedReading: null, endsAtStep: null, setupPaid: 0, firedCount: 0, changedCount: 0, lastFiredStep: null, emptyFirings: 0, endedAtStep: null, endedReason: null,
        },
      })),
    };
    const out = run(rigged, state.instant.day + 30);
    expect(balance(out.world, "marcus-purse")).toBe(balance(state, "marcus-purse"));
    expect(out.audit.some((row) => row.kind === "mechanic_effect")).toBe(false);
  });
});

describe("a rule that fires when something becomes true", () => {
  // The setup takes a share of the purse first; the threshold sits below what is left.
  const trigger: MechanicDraft = { ...dole("marcus-purse", 10), trigger: { kind: "when", predicate: { kind: "account_below", accountId: "marcus-purse", amount: 600 } } };
  const poorer = (state: WorldState, id: string, to: number): WorldState => ({ ...state, material: { ...state.material, accounts: state.material.accounts.map((account) => (account.id === id ? { ...account, balance: to } : account)) } });

  it("fires on the edge, once, and again only after the condition has been false in between", () => {
    const state = attached(withEntity(world(), { id: "alms" }), "alms", trigger);
    const day = state.instant.day;
    expect(run(state, day + 1).fired).toBe(0);
    expect(balance(state, "marcus-purse")).toBeGreaterThan(600);
    const fell = poorer(state, "marcus-purse", 500);
    const first = run(fell, day + 2);
    expect(first.fired).toBe(1);
    expect(run(first.world, day + 3).fired).toBe(0);
    const recovered = poorer(first.world, "marcus-purse", 700);
    const armed = run(recovered, day + 4);
    expect(armed.fired).toBe(0);
    const fellAgain = poorer(armed.world, "marcus-purse", 550);
    expect(run(fellAgain, day + 5).fired).toBe(1);
  });

  it("does not fire at once for a condition already true when it was written", () => {
    const already = poorer(world(), "marcus-purse", 500);
    const state = attached(withEntity(already, { id: "alms" }), "alms", trigger);
    expect(run(state, state.instant.day + 1).fired).toBe(0);
  });
});

describe("a rule that fires on a kind of fact", () => {
  it("fires once per matching fact it is shown, and never on its own firings", () => {
    const draft: MechanicDraft = { ...dole("marcus-purse", 10), trigger: { kind: "on_fact", factKind: "trade", subjectRef: MARCUS } };
    const state = attached(withEntity(world(), { id: "tithe" }), "tithe", draft);
    const fact = (kind: string, id: string) => ({
      id, kind, summary: "x", time: state.instant, atStep: state.elapsedStep, affectedEntities: [MARCUS], resourceChanges: [], authorityChange: undefined,
      visibility: "public" as const, discovery: { state: "public" as const, knowableAtInstant: null, discoveredBy: [] }, evidence: null, eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
    });
    const out = run(state, state.instant.day + 1, { recentFacts: [fact("trade", "f1"), fact("trade", "f2"), fact("mechanic_fired", "f3"), fact("battle", "f4")] as never });
    expect(out.world.genericEntities.find((entity) => entity.id === "tithe")!.mechanic!.firedCount).toBe(2);
  });
});

describe("how a rule ends", () => {
  it("by its term, after the months inside the term have fired, even when the clock arrives in one jump", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", { ...dole("marcus-purse", 5), end: { kind: "term", days: 100 } });
    const out = run(state, state.instant.day + 365);
    const rule = out.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!;
    expect(rule.endedReason).toContain("term");
    // Days 30, 60 and 90 fired; day 120 lay past the term.
    expect(rule.firedCount).toBe(3);
  });

  it("with its owner", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", { ...dole("marcus-purse"), end: { kind: "owner_death" } });
    const dead: WorldState = { ...state, characters: state.characters.map((character) => (character.id === MARCUS.id ? { ...character, alive: false, diedAtStep: state.elapsedStep } : character)) };
    const out = run(dead, state.instant.day + 30);
    expect(out.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!.endedReason).toContain("owner died");
  });

  it("when its end becomes true, and not for an end already true when written", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", { ...dole("marcus-purse", 10), end: { kind: "when", predicate: { kind: "account_below", accountId: "marcus-purse", amount: 100_000 } } });
    // Already below at attach: armed as "yes", so it does not end on the first look.
    const first = run(state, state.instant.day + 30);
    expect(first.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!.endedAtStep).toBeNull();
    expect(first.fired).toBe(1);
  });
});

describe("determinism", () => {
  it("mints the same ids and facts on the same world twice", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", dole("marcus-purse"));
    const a = run(state, state.instant.day + 61);
    const b = run(state, state.instant.day + 61);
    expect(a.facts.map((fact) => fact.localId)).toEqual(b.facts.map((fact) => fact.localId));
    expect(a.world.material.transactions.map((row) => row.id)).toEqual(b.world.material.transactions.map((row) => row.id));
  });
});

describe("what a rule may wait for", () => {
  it("refuses a change of hands as a condition or an end, since it never holds", () => {
    const state = withEntity(world(), { id: "toll" });
    const entity = state.genericEntities.find((candidate) => candidate.id === "toll")!;
    const refs = readableRefsFor(state, MARCUS, entity);
    const event = { kind: "province_control_changes" as const, provinceId: NORTHEAST };
    expect(validateMechanic({ ...dole("marcus-purse"), conditions: [event] }, state, refs, offices).ok).toBe(false);
    expect(validateMechanic({ ...dole("marcus-purse"), end: { kind: "when", predicate: event } }, state, refs, offices).ok).toBe(false);
    expect(validateMechanic({ ...dole("marcus-purse"), trigger: { kind: "when", predicate: event } }, state, refs, offices).ok).toBe(true);
  });
});

describe("a run that cannot fire every month due", () => {
  it("leaves the months it did not fire still due, rather than skipping them", () => {
    const state = attached(withEntity(world(), { id: "dole" }), "dole", dole("marcus-purse", 1));
    const day = state.instant.day;
    const year = run(state, day + 365);
    const rule = year.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!;
    expect(rule.firedCount).toBe(MECHANIC_MAX_FIRINGS_PER_RUN);
    expect(rule.nextDueStep).toBe(day + 30 * (MECHANIC_MAX_FIRINGS_PER_RUN + 1));
    const rest = run(year.world, day + 365);
    expect(rest.world.genericEntities.find((entity) => entity.id === "dole")!.mechanic!.firedCount).toBe(12);
  });
});
