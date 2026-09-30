import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  type Commitment,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { claimPromisesKept, GRACE_DAYS, keepPromises, keptOnTheRecord } from "./promises";

/**
 * "Hieron promised the consul two hundred, and a legion's worth of grain."
 *
 * A promise made in conversation became a commitment and nothing ever came of
 * it: nothing marked it kept, nothing marked it broken, and the man who broke
 * his word was as welcome the next spring. Now it is settled on its day by
 * what the world shows was done.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const CONSUL = "gaius-genucius";
const HIERON = "hieron-ii";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const personOf = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!;
const trustOf = (world: WorldState, subject: string, target: string): number => {
  const relation = personOf(world, subject).relations.find((candidate) => candidate.subjectCharacterId === target);
  return (relation?.causes ?? []).reduce((sum, cause) => sum + (cause.dimensions?.trust ?? 0), 0);
};

function promised(world: WorldState, change: Partial<Commitment> = {}): WorldState {
  const commitment: Commitment = {
    id: "promise-hieron-grain",
    promisorCharacterId: HIERON,
    beneficiaryCharacterId: CONSUL,
    actionKind: "other",
    description: "to send grain for the legion at Rhegium",
    conditions: "",
    requiredOfficeId: null,
    requiredResource: null,
    visibility: "private",
    sourceEventId: null,
    breachPressureKind: "humiliation",
    status: "pending",
    createdAtStep: world.elapsedStep,
    reviewAtStep: world.elapsedStep + 10,
    resolvedAtStep: null,
    resolutionReason: null,
    ...change,
  };
  return { ...world, commitments: [...world.commitments, commitment] };
}

const statusOf = (world: WorldState): Commitment["status"] => world.commitments.find((commitment) => commitment.id === "promise-hieron-grain")!.status;

describe("a promise nobody keeps", () => {
  it("waits until its day, is given one grace, and is then broken and remembered", () => {
    const start = promised(opening());
    const before = trustOf(start, CONSUL, HIERON);

    const early = keepPromises({ world: start, toDay: start.elapsedStep + 5, playerCharacterId: CONSUL });
    expect(statusOf(early.world)).toBe("pending");
    expect(early.facts).toEqual([]);

    const onItsDay = keepPromises({ world: early.world, toDay: start.elapsedStep + 10, playerCharacterId: CONSUL });
    expect(statusOf(onItsDay.world)).toBe("deferred");
    expect(onItsDay.facts.map((fact) => fact.kind)).toEqual(["promise_overdue"]);

    const graceOver = keepPromises({ world: onItsDay.world, toDay: start.elapsedStep + 10 + GRACE_DAYS, playerCharacterId: CONSUL });
    expect(statusOf(graceOver.world)).toBe("broken");
    const broken = graceOver.facts.find((fact) => fact.kind === "promise_broken")!;
    expect(broken.summary).toContain("broke his promise");
    // Private between the two of them, and the consul holds it against him.
    expect(broken.visibility).toBe("private");
    expect(trustOf(graceOver.world, CONSUL, HIERON)).toBeLessThan(before);
    expect(personOf(graceOver.world, CONSUL).lessons?.some((lesson) => lesson.kind === "betrayed")).toBe(true);
    // The promisor carries the shame of it.
    expect(graceOver.world.characterPressures.some((pressure) => pressure.characterId === HIERON && pressure.kind === "humiliation")).toBe(true);

    // Settled once: another tick says nothing more of it.
    expect(keepPromises({ world: graceOver.world, toDay: start.elapsedStep + 60, playerCharacterId: CONSUL }).facts).toEqual([]);
  });

  it("dies with either of the two it was between", () => {
    const start = promised(opening());
    const dead = { ...start, characters: start.characters.map((character) => (character.id === HIERON ? { ...character, alive: false, diedAtStep: start.elapsedStep } : character)) };
    expect(statusOf(keepPromises({ world: dead, toDay: start.elapsedStep + 1, playerCharacterId: CONSUL }).world)).toBe("cancelled");
  });
});

describe("a promise kept", () => {
  it("is kept the moment the deed is on the record, and the man it was made to thinks better of him", () => {
    const start = promised(opening(), { actionKind: "information_sharing", description: "to tell the consul what Carthage does" });
    expect(keptOnTheRecord(start, start.commitments.at(-1)!)).toBeNull();
    // Hieron writes to the consul, after the promise.
    const sent = applyDeltas(start, [WorldDeltaSchema.parse({
      op: "diplomatic_message_send", localId: "news_for_rome", kind: "letter", fromPolityId: "syracuse", fromCharacterRef: HIERON,
      toPolityId: "rome", toCharacterRef: CONSUL, subject: "What Carthage does", terms: "Hanno gathers ships at Lilybaeum.",
      replyWithinDays: null, inReplyToRef: null, visibility: "private", reason: "Hieron keeps his word.",
    })], {
      now: start.instant, actorRef: { kind: "character", id: HIERON }, offices, warfare: definition.warfare, terrains: definition.map.terrains,
      ids: createIdFactory("kept"), gameId: "game-kept",
    });
    expect(sent.rejected).toEqual([]);
    expect(keptOnTheRecord(sent.world, sent.world.commitments.at(-1)!)).toContain("wrote");
    const kept = keepPromises({ world: sent.world, toDay: start.elapsedStep + 3, playerCharacterId: CONSUL });
    expect(statusOf(kept.world)).toBe("fulfilled");
    expect(kept.facts.map((fact) => fact.kind)).toEqual(["promise_kept"]);
    expect(trustOf(kept.world, CONSUL, HIERON)).toBeGreaterThan(trustOf(start, CONSUL, HIERON));
  });

  it("is kept when the man himself says so in an answer that changed the world, and not otherwise", () => {
    const start = promised(opening());
    expect(statusOf(claimPromisesKept(start, HIERON, ["promise-hieron-grain"], false))).toBe("pending");
    // Only his own promise: the consul cannot claim Hieron's for him.
    expect(statusOf(claimPromisesKept(start, CONSUL, ["promise-hieron-grain"], true))).toBe("pending");
    const claimed = claimPromisesKept(start, HIERON, ["promise-hieron-grain"], true);
    expect(statusOf(claimed)).toBe("prepared");
    expect(statusOf(keepPromises({ world: claimed, toDay: start.elapsedStep + 1, playerCharacterId: CONSUL }).world)).toBe("fulfilled");
  });

  it("pays a promised sum on its day from a purse that holds it, and never from the player's", () => {
    const base = opening();
    const hieronPurse = personOf(base, HIERON).personalAccountId;
    const consulPurse = personOf(base, CONSUL).personalAccountId;
    const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;
    const rich: WorldState = { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === hieronPurse || account.id === consulPurse ? { ...account, balance: 1_000 } : account)) } };

    const owed = promised(rich, { actionKind: "payment", description: "two hundred for the fleet", requiredResource: { accountId: hieronPurse, minAmount: 200 } });
    const paid = keepPromises({ world: owed, toDay: owed.elapsedStep + 10, playerCharacterId: CONSUL });
    expect(statusOf(paid.world)).toBe("fulfilled");
    expect(balance(paid.world, hieronPurse)).toBe(800);
    expect(balance(paid.world, consulPurse)).toBe(1_200);

    // The player's own promise to pay is his to keep by an order: the engine does not reach into his purse.
    const his = { ...promised(rich, { promisorCharacterId: CONSUL, beneficiaryCharacterId: HIERON, actionKind: "payment", description: "two hundred for the fleet", requiredResource: { accountId: consulPurse, minAmount: 200 } }) };
    const unpaid = keepPromises({ world: his, toDay: his.elapsedStep + 10, playerCharacterId: CONSUL });
    expect(statusOf(unpaid.world)).toBe("deferred");
    expect(balance(unpaid.world, consulPurse)).toBe(1_000);
  });
});

describe("a promise to hold back", () => {
  // R23: "I will not call you a traitor without proof" fell due, no letter had
  // been written, and it was marked broken -- a grievance, lost trust, a lesson
  // in betrayal -- for a man who had done exactly what he said.
  it("is kept by holding back, and breaks nothing when its day passes", () => {
    const start = promised(opening(), { description: "I will not call you a traitor without proof" });
    const due = keepPromises({ world: start, toDay: start.elapsedStep + 10, playerCharacterId: CONSUL });
    const later = keepPromises({ world: due.world, toDay: start.elapsedStep + 10 + GRACE_DAYS, playerCharacterId: CONSUL });
    expect(statusOf(later.world)).toBe("fulfilled");
    expect([...due.facts, ...later.facts].some((fact) => fact.kind === "promise_broken")).toBe(false);
    expect(trustOf(later.world, CONSUL, HIERON)).toBeGreaterThanOrEqual(0);
  });
});

describe("a promise that waits on an occasion", () => {
  // R26: support "when we put the measure before the Senate" was broken on a
  // date, with no measure ever put.
  it("lapses without blame when the occasion never comes", () => {
    const start = promised(opening(), { actionKind: "political_support", description: "to stand with you when we put the measure before the Senate" });
    const due = keepPromises({ world: start, toDay: start.elapsedStep + 10, playerCharacterId: CONSUL });
    expect(statusOf(due.world)).toBe("cancelled");
    expect(due.facts.some((fact) => fact.kind === "promise_broken")).toBe(false);
  });
});
