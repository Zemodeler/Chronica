import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { keepPatronage, loanOffersFact, loanOffersFor, monthlyIncomeOf, patronWillTake } from "./money";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * Money a private man can come by (play-test E18, L8).
 *
 * The legionary's pay left the treasury and landed nowhere; a man whose purse
 * ran dry found nobody who would lend; and a patron's client was a word on a
 * tie that paid nothing.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const balance = (world: WorldState, accountId: string): number => world.material.accounts.find((account) => account.id === accountId)!.balance;
const tick = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory(`money-${toDay}`), warfare: definition.warfare });
const byName = (world: WorldState, name: string) => world.characters.find((character) => character.name === name)!;
const purseOf = (world: WorldState, id: string): string => world.characters.find((character) => character.id === id)!.personalAccountId;

/** Ogulnius, a private man, enlisted in the consul's army: in the ranks, or as a centurion. */
function serving(rankId: string | null): WorldState {
  const world = opening();
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== "quintus-ogulnius" || rankId === null ? character : {
      ...character,
      service: { forceId: "roman-field-army", formationId: null, unitIndex: null, rankId, enlistedAtStep: 0, campaigns: 0, priorCampaigns: 0, battles: 0, wounds: 0, decorations: [], punishments: [], conduct: "steady" as const },
    })),
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, memberCharacterIds: [...force.memberCharacterIds, "quintus-ogulnius"] } : force)),
    },
  };
}

describe("a soldier's pay reaches his purse (E18)", () => {
  it("pays a named legionary seven a month out of the army's pay, and the treasury pays what it always paid", () => {
    const without = opening();
    const withHim = serving("hastatus");
    const paidWithout = tick(without, 30).world;
    const paidWith = tick(withHim, 30).world;
    // The treasury's outlay is the army's pay either way: his share comes out of it.
    expect(balance(paidWith, "rome-treasury")).toBe(balance(paidWithout, "rome-treasury"));
    // Ten drachmae a month, less a third stopped for his grain and kit.
    expect(balance(paidWith, "ogulnius-purse") - balance(paidWithout, "ogulnius-purse")).toBe(7);
    const row = paidWith.material.transactions.find((transaction) => transaction.destinationAccountId === "ogulnius-purse" && transaction.kind === "salary")!;
    expect(row.sourceAccountId).toBe("rome-treasury");
    expect(row.cause).toMatchObject({ kind: "obligation", id: "rome-legion-pay" });
  });

  it("pays a centurion twice a legionary's share, and the consul nothing from the chest", () => {
    const centurion = tick(serving("centurio-prior"), 30).world;
    const ranks = tick(serving("hastatus"), 30).world;
    expect(balance(centurion, "ogulnius-purse") - balance(ranks, "ogulnius-purse")).toBe(6);
    expect(centurion.material.transactions.some((transaction) => transaction.destinationAccountId === "gaius-purse" && transaction.kind === "salary")).toBe(false);
  });
});

describe("loans offered by rule when a purse runs low (L8)", () => {
  /** Gaius Genucius, out of money, with his estates still paying him a hundred a month. */
  const short = (): WorldState => {
    const world = opening();
    return { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "gaius-purse" ? { ...account, balance: 40 } : account)) } };
  };

  it("offers nothing to a man whose purse is full", () => {
    expect(loanOffersFor(opening(), "gaius-genucius")).toEqual([]);
  });

  it("offers up to three loans from rich men of his own power, on terms the rule sets", () => {
    const world = short();
    const offers = loanOffersFor(world, "gaius-genucius");
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(3);
    const income = monthlyIncomeOf(world, "gaius-genucius");
    for (const offer of offers) {
      const lender = world.characters.find((character) => character.id === offer.lenderId)!;
      expect(lender.polityId).toBe("rome");
      expect(lender.mind.drives.wealth).toBeGreaterThanOrEqual(60);
      expect(offer.interestBps).toBeGreaterThanOrEqual(100);
      expect(offer.interestBps).toBeLessThanOrEqual(150);
      expect(offer.periods).toBeGreaterThanOrEqual(12);
      expect(offer.periods).toBeLessThanOrEqual(24);
      expect(offer.amount).toBeLessThanOrEqual(Math.max(3 * income, offer.amount));
    }
    // Said to him once, then not again for a season.
    const fact = loanOffersFact(world, "gaius-genucius", []);
    expect(fact?.kind).toBe("loan_offered");
    expect(loanOffersFact(world, "gaius-genucius", [{ kind: "loan_offered", atStep: world.elapsedStep, affectedEntities: [{ kind: "character", id: "gaius-genucius" }] }])).toBeNull();
  });

  it("is taken by an order naming the offer: the lender's money, at the lender's terms", () => {
    const world = short();
    const offer = loanOffersFor(world, "gaius-genucius")[0]!;
    const context: ApplyContext = {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
      ids: createIdFactory("loan"), gameId: "game-1",
    };
    // The act's own figures are the model's guesses; the offer's stand.
    const taken = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "loan_open", localId: "blasio_loan", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: "gaius-purse", principal: 0, interestBps: 500, cadenceDays: 10,
      terms: "The loan he offered.", offerId: offer.id, reason: "Gaius takes the loan.",
    })], context);
    expect(taken.rejected).toEqual([]);
    expect(balance(taken.world, "gaius-purse")).toBe(40 + offer.amount);
    expect(balance(taken.world, purseOf(world, offer.lenderId))).toBe(balance(world, purseOf(world, offer.lenderId)) - offer.amount);
    const loan = taken.world.material.loans.find((candidate) => candidate.borrowerAccountId === "gaius-purse")!;
    expect(loan).toMatchObject({ lenderKind: "character", lenderId: offer.lenderId, principal: offer.amount, interestBps: offer.interestBps, cadenceSteps: 30 });
    expect(taken.world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!.remainingPeriods).toBe(offer.periods);

    // An offer that no longer stands lends nothing.
    const refused = applyDeltas(opening(), [WorldDeltaSchema.parse({
      op: "loan_open", localId: "stale", lenderKind: "character", lenderRef: offer.lenderId, borrowerAccountRef: "gaius-purse", principal: 100, interestBps: 100, cadenceDays: 30,
      terms: "An old offer.", offerId: offer.id, reason: "Gaius takes the loan.",
    })], context);
    expect(refused.rejected).toHaveLength(1);
    expect(refused.rejected[0]!.kind).not.toBe("reference");
  });
});

describe("a patron keeps his client (L8)", () => {
  const procedure = (world: WorldState, sponsorId: string): PoliticalProcedure => ({
    id: "the-question", type: "council_deliberation", institutionId: world.material.institutions[0]!.id, sponsorCharacterId: sponsorId, subjectKind: "polity", subjectId: "rome",
    label: "A question of the patron's", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote",
    openedAtStep: 0, deadlineStep: 90, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: [],
  } as unknown as PoliticalProcedure);

  /** A quaestor who has made himself the consul's man. */
  const clientOf = (): { world: WorldState; client: string } => {
    const world = opening();
    const client = byName(world, "Lucius Julius Libo").id;
    return {
      client,
      world: { ...world, socialLinks: [...world.socialLinks, { id: "libo-patron", subjectCharacterId: client, targetCharacterId: "gaius-genucius", kind: "patron", sourceEventId: null, createdAtStep: 0, visibility: "public" }] },
    };
  };

  it("takes a lesser man as client by rule, and refuses one who stands as high as he does", () => {
    const { world, client } = clientOf();
    expect(patronWillTake(world, "gaius-genucius", client).willing).toBe(true);
    expect(patronWillTake(world, "gaius-genucius", "gnaeus-cornelius").willing).toBe(false);
  });

  it("pays a stipend of a fiftieth of his income each month, and stops it when the client votes against him", () => {
    const { world, client } = clientOf();
    const clientPurse = purseOf(world, client);
    const first = tick(world, 30);
    expect(first.factProposals.some((fact) => fact.kind === "clientage_begun")).toBe(true);
    const stipend = first.world.material.obligations.find((obligation) => obligation.active && obligation.payerAccountId === "gaius-purse" && obligation.recipientAccountId === clientPurse)!;
    expect(stipend.amount).toBe(Math.max(1, Math.round(monthlyIncomeOf(world, "gaius-genucius") * 0.02)));
    const second = tick(first.world, 60).world;
    expect(second.material.transactions.some((transaction) => transaction.destinationAccountId === clientPurse && transaction.cause.id === stipend.id)).toBe(true);

    const voted: WorldState = {
      ...second,
      material: {
        ...second.material,
        politicalProcedures: [...second.material.politicalProcedures, procedure(second, "gaius-genucius")],
        supportPositions: [...second.material.supportPositions, {
          id: "libo-against", procedureId: "the-question", supporterKind: "character", supporterId: client, position: "oppose", influenceWeight: 1, visibility: "public", reasons: [], provenanceEventIds: [], changedAtStep: 61,
        }],
      },
    };
    const turned = keepPatronage(voted, createIdFactory("turned"), 62);
    expect(turned.facts.some((fact) => fact.kind === "clientage_ended")).toBe(true);
    expect(turned.world.material.obligations.find((obligation) => obligation.id === stipend.id)!.active).toBe(false);
    expect(turned.world.socialLinks.some((link) => link.id === "libo-patron")).toBe(false);
  });

  it("strikes out a tie its patron will not have", () => {
    const world = opening();
    const proud: WorldState = { ...world, socialLinks: [...world.socialLinks, { id: "blasio-patron", subjectCharacterId: "gnaeus-cornelius", targetCharacterId: "gaius-genucius", kind: "patron", sourceEventId: null, createdAtStep: 0, visibility: "public" }] };
    const kept = keepPatronage(proud, createIdFactory("proud"), 1);
    expect(kept.facts.some((fact) => fact.kind === "clientage_refused")).toBe(true);
    expect(kept.world.socialLinks.some((link) => link.id === "blasio-patron")).toBe(false);
  });

  it("is asked by an order: a meeting in which a man puts himself under a patron, answered by rule at the month", () => {
    const world = opening();
    const client = byName(world, "Lucius Julius Libo").id;
    const asked = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "social_events", events: [{
        participantCharacterRefs: [client, "gaius-genucius"], kind: "conversation", visibility: "public", summary: "Libo calls on the consul and offers himself as his man.",
        relationCauses: [{ subjectCharacterRef: client, targetCharacterRef: "gaius-genucius", label: "He asked to be the consul's client.", score: 5, tie: "patron" }],
      }],
    })], {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: client }, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("ask"), gameId: "game-1",
    });
    expect(asked.rejected).toEqual([]);
    const answered = tick(asked.world, 30);
    expect(answered.factProposals.some((fact) => fact.kind === "clientage_begun")).toBe(true);
    expect(answered.world.material.obligations.some((obligation) => obligation.active && obligation.payerAccountId === "gaius-purse" && obligation.recipientAccountId === purseOf(world, client))).toBe(true);
  });
});
