import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  estateTerms,
  familyLinksOf,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { holdElections } from "./elections";

/**
 * The places the engine held a person back that it had no business holding.
 *
 * Each block is one of them, and what a player can now do about it:
 *
 * - standing moved by nothing a man did, though elections are counted on it;
 * - kin written only when a person was made, so nobody could marry, divorce or
 *   adopt anybody who already existed;
 * - allegiance fixed for life;
 * - a payment refused whole for want of the last coin, and land bought only
 *   with all of its price in hand;
 * - a plan of battle carried only by the attack, so the side attacked never had
 *   one;
 * - one power's armies unable to fight each other, which made civil war the
 *   one kind of war the world could not have;
 * - anybody holding any office barred from standing for another;
 * - no death anybody could bring about but a secret one;
 * - laws that did nothing when passed, offices no law could reform, treaties
 *   whose terms were prose;
 * - skills and ambitions fixed at birth;
 * - and, the other way, a player's order moving another power's men.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = "punic-italy-latium";
const SICILY_NE = "ita-72843720b81376294924159-sicily-northeast";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (actor: string, extra: Partial<ApplyContext> = {}): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("unbound"),
  gameId: "game-unbound",
  ...extra,
});

function act(actor: string, written: readonly unknown[], state: WorldState = world(), extra: Partial<ApplyContext> = {}) {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const result = applyDeltas(state, deltas, context(actor, extra));
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
}

const person = (state: WorldState, id: string) => state.characters.find((character) => character.id === id)!;
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

describe("standing is earned", () => {
  it("rises and falls with what a man does, and never leaves its scale", () => {
    const risen = act("gaius-genucius", [{ op: "character_state_set", characterRef: "quintus-ogulnius", standingDeltaBps: 1_500, standingCause: "victory", reason: "He broke the Samnites." }]);
    expect(person(risen.world, "quintus-ogulnius").prestigeBps).toBe(8_500);

    const ruined = act("gaius-genucius", [{ op: "character_state_set", characterRef: "decius-vibellius", standingDeltaBps: -2_000, standingCause: "scandal", reason: "Disgraced." }]);
    expect(person(ruined.world, "decius-vibellius").prestigeBps).toBe(1_500);
  });

  it("moves no further than its cause can carry it", () => {
    // Games buy a city's affection, not a triumph's.
    const games = act("gaius-genucius", [{ op: "character_state_set", characterRef: "quintus-ogulnius", standingDeltaBps: 1_500, standingCause: "games", reason: "Games that bought the city." }]);
    expect(person(games.world, "quintus-ogulnius").prestigeBps).toBe(7_800);
    // A scandal cannot raise a man, and a shift with no cause is the smallest.
    const scandal = act("gaius-genucius", [{ op: "character_state_set", characterRef: "quintus-ogulnius", standingDeltaBps: 1_000, standingCause: "scandal", reason: "Talked about." }]);
    expect(person(scandal.world, "quintus-ogulnius").prestigeBps).toBe(7_000);
    const unnamed = act("gaius-genucius", [{ op: "character_state_set", characterRef: "quintus-ogulnius", standingDeltaBps: 2_000, reason: "Well thought of." }]);
    expect(person(unnamed.world, "quintus-ogulnius").prestigeBps).toBe(7_300);
  });

});

describe("kin between people who already exist", () => {
  it("marries two of them, and divorces them again", () => {
    const married = act("manius-curius", [{
      op: "family_tie_set", characterRef: "quintus-ogulnius", relatedCharacterRef: "manius-curius", relation: "spouse_or_partner", change: "form", reason: "An alliance of houses.",
    }]);
    const tie = married.world.familyLinks.find((link) => link.endedAtStep === null && link.kind === "spouse_or_partner");
    expect(tie).toBeDefined();
    // No breach: marrying is nobody's office.
    expect(married.breaches).toEqual([]);

    // Stated from the other side, it is the same tie.
    const divorced = act("manius-curius", [{
      op: "family_tie_set", characterRef: "manius-curius", relatedCharacterRef: "quintus-ogulnius", relation: "spouse_or_partner", change: "end", reason: "The alliance is over.",
    }], married.world);
    expect(divorced.world.familyLinks.filter((link) => link.endedAtStep === null && link.kind === "spouse_or_partner")).toHaveLength(0);
  });

  it("adopts a grown man as a son, whom the family graph then reads as one", () => {
    const adopted = act("manius-curius", [{
      op: "family_tie_set", characterRef: "quintus-ogulnius", relatedCharacterRef: "manius-curius", relation: "child", change: "form", reason: "Curius has no son, and wants one.",
    }]);
    // Read from Curius's side, he is the father of a son.
    const view = familyLinksOf(adopted.world, "manius-curius");
    expect(view.some((link) => link.kind === "parent" && link.counterpartCharacterId === "quintus-ogulnius")).toBe(true);
  });

  it("will not end a tie that was never made", () => {
    const result = act("manius-curius", [{
      op: "family_tie_set", characterRef: "manius-curius", relatedCharacterRef: "hanno-carthage", relation: "spouse_or_partner", change: "end", reason: "Nothing to end.",
    }]);
    expect(result.rejected[0]!.kind).toBe("world");
  });
});

describe("a man may change sides", () => {
  it("goes over to another power, laying down his office and his army in the old one", () => {
    const result = act("gaius-genucius", [{ op: "character_state_set", characterRef: "gaius-genucius", polityId: "carthage", reason: "He goes over to Carthage." }]);
    const gaius = person(result.world, "gaius-genucius");
    expect(gaius.polityId).toBe("carthage");
    expect(gaius.officeId).toBeNull();
    const army = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(army.commanderCharacterId).not.toBe("gaius-genucius");
    expect(person(result.world, army.commanderCharacterId).polityId).toBe("rome");
  });

  it("keeps an army that went over with him in the same breath", () => {
    const result = act("gaius-genucius", [
      { op: "force_modify", forceRef: "roman-field-army", polityId: "carthage", reason: "The legion goes over with its consul." },
      { op: "character_state_set", characterRef: "gaius-genucius", polityId: "carthage", reason: "He goes over to Carthage." },
    ]);
    expect(result.world.material.forces.find((force) => force.id === "roman-field-army")!.commanderCharacterId).toBe("gaius-genucius");
  });
});

describe("paying with what there is", () => {
  it("buys land on credit when a quarter of the price is in hand, pledged against the land", () => {
    const base = world();
    const price = estateTerms(base, LATIUM, "great")!.price;
    const inHand = Math.ceil(price * 0.4);
    const state: WorldState = {
      ...base,
      material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: inHand } : account)) },
    };
    const result = act("manius-curius", [{
      op: "holding_create", localId: "farm", title: "A great estate in Latium", provinceId: LATIUM,
      holderCharacterRef: "manius-curius", band: "great", priceFromAccountRef: "curius-purse", reason: "He buys land.",
    }], state);

    expect(result.rejected).toEqual([]);
    const loan = result.world.material.loans.find((candidate) => candidate.borrowerAccountId === "curius-purse")!;
    expect(loan.outstanding).toBe(price - inHand);
    expect(loan.collateralHoldingId).toBe(result.assignedIds.get("farm"));
    expect(balance(result.world, "curius-purse")).toBe(0);
    expect(result.factProposals.some((fact) => fact.kind === "bought_on_credit")).toBe(true);
  });

  it("still refuses a purchase with less than a quarter down", () => {
    const base = world();
    const price = estateTerms(base, LATIUM, "great")!.price;
    const state: WorldState = {
      ...base,
      material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: Math.floor(price * 0.1) } : account)) },
    };
    const result = act("manius-curius", [{
      op: "holding_create", localId: "farm", title: "A great estate in Latium", provinceId: LATIUM,
      holderCharacterRef: "manius-curius", band: "great", priceFromAccountRef: "curius-purse", reason: "He buys land.",
    }], state);
    expect(result.rejected[0]!.kind).toBe("world");
    expect(result.rejected[0]!.reason).toContain("down");
  });

  it("repays what the debtor has, when he has less than he offers", () => {
    const opened = act("gaius-genucius", [{
      op: "loan_open", localId: "debt", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: "gaius-purse",
      principal: 5_000, interestBps: 100, cadenceDays: 30, terms: "A banker's loan", collateralHoldingRef: null, reason: "He borrows.",
    }]);
    const spent = act("gaius-genucius", [{ op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 5_000, reason: "Spent." }], opened.world);
    const loanId = spent.world.material.loans[0]!.id;
    const repaid = act("gaius-genucius", [{ op: "loan_settle", loanRef: loanId, action: "repay", amount: 5_000, reason: "All of it." }], spent.world);
    expect(repaid.rejected).toEqual([]);
    expect(repaid.world.material.loans[0]!.outstanding).toBe(5_000 - 1_200);
    expect(balance(repaid.world, "gaius-purse")).toBe(0);
  });
});

describe("the side attacked has a plan too", () => {
  const facing = (): WorldState => {
    const state = world();
    return {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "carthaginian-garrison" ? { ...force, locationId: LATIUM } : force)),
      },
    };
  };

  it("keeps a standing plan on the army, and fights by it when attacked", () => {
    const planned = act("gaius-genucius", [{
      op: "force_modify", forceRef: "roman-field-army",
      battlePlan: { factor: "cohesion", magnitude: "meaningful", rationale: "Hold the line behind the stakes.", restsOn: ["numbers", "second_force"] },
      reason: "The consul sets the order of battle.",
    }], facing());
    expect(planned.world.material.forces.find((force) => force.id === "roman-field-army")!.battlePlan?.factor).toBe("cohesion");

    const attacked = act("hanno-carthage", [{
      op: "force_engage", forceRef: "carthaginian-garrison", targetForceRef: "roman-field-army", posture: "offer_battle", tactic: null,
      reason: "Hanno attacks.",
    }], planned.world);
    const account = attacked.battleAccounts[0]!;
    // The defender's plan was weighed: accepted, or refused on the field's
    // own evidence -- never simply absent.
    const judged = [...account.tactics, ...account.refusedTactics].join(" ");
    expect(judged).toContain("Gaius");
  });
});

describe("civil war", () => {
  it("lets two Roman armies under different men fight, and says so in public", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const split: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: [...state.material.forces, { ...structuredClone(legion), id: "curius-legion", name: "Curius's legion", commanderCharacterId: "manius-curius", controllerCharacterId: "manius-curius" }],
      },
    };
    const result = act("manius-curius", [{
      op: "force_engage", forceRef: "curius-legion", targetForceRef: "roman-field-army", posture: "offer_battle", tactic: null, reason: "Curius marches on the consul.",
    }], split);
    expect(result.rejected).toEqual([]);
    expect(result.factProposals.some((fact) => fact.kind === "civil_strife")).toBe(true);
  });
});

describe("rising while in office", () => {
  it("lets a man who holds another office stand, and he lays it down when he wins", () => {
    let state = world();
    // Quintus is made a quaestor, has made a name, and the consulship falls vacant.
    state = act("gaius-genucius", [{ op: "office_seat_set", officeId: "roman-quaestor", officeLabel: "Quaestor", holderCharacterRef: "quintus-ogulnius", reason: "Named quaestor." }], state).world;
    // His seat in the Senate is not the office he rises from.
    const quaestorship = state.material.officeSeats.find((seat) => seat.holderCharacterId === "quintus-ogulnius" && seat.officeId.includes("quaestor"))!.officeId;
    state = {
      ...state,
      characters: state.characters.map((character) => (character.id === "quintus-ogulnius" ? { ...character, prestigeBps: 9_000 } : character.id === "manius-curius" ? { ...character, prestigeBps: 6_000 } : character)),
      material: {
        ...state.material,
        officeSeats: state.material.officeSeats.map((seat) => (seat.id === "roman-consul:seat:1" ? { ...seat, vacancyCause: "term_expired" as const, termExpiresAtStep: 0 } : seat)),
      },
    };
    state = act("quintus-ogulnius", [{
      op: "political_procedure_open", localId: "stand", type: "nomination", institutionRef: null, sponsorCharacterRef: "quintus-ogulnius",
      subjectKind: "character", subjectRef: "quintus-ogulnius", label: "Quintus Ogulnius stands for Roman consul", resolutionMechanism: "sponsor_discretion",
      reason: "He stands.",
    }], state).world;
    const ids = createIdFactory("election");
    state = holdElections({ world: state, government: definition.government, toDay: 1, ids }).world;
    state = holdElections({ world: state, government: definition.government, toDay: 40, ids }).world;

    const seat = state.material.officeSeats.find((candidate) => candidate.id === "roman-consul:seat:1")!;
    expect(seat.holderCharacterId).toBe("quintus-ogulnius");
    // He holds one office, the higher, and winning is standing.
    expect(state.material.officeSeats.some((candidate) => candidate.officeId === quaestorship && candidate.holderCharacterId === "quintus-ogulnius")).toBe(false);
    expect(person(state, "quintus-ogulnius").prestigeBps).toBe(9_500);
  });
});

describe("a death somebody brings about", () => {
  it("will not execute a man who is at large", () => {
    const result = act("gaius-genucius", [{ op: "character_death", characterRef: "manius-curius", manner: "execution", byCharacterRef: "gaius-genucius", reason: "He is condemned." }]);
    expect(result.rejected[0]!.kind).toBe("world");
    expect(person(result.world, "manius-curius").alive).toBe(true);
  });

  it("executes a captive held where the man ordering it has men", () => {
    const held = act("gaius-genucius", [{ op: "character_state_set", characterRef: "manius-curius", addStatuses: ["imprisoned"], reason: "Arrested." }]);
    const result = act("gaius-genucius", [{ op: "character_death", characterRef: "manius-curius", manner: "execution", byCharacterRef: "gaius-genucius", reason: "Put to death." }], held.world);
    expect(result.rejected).toEqual([]);
    expect(person(result.world, "manius-curius").alive).toBe(false);
    expect(result.factProposals.some((fact) => fact.kind === "execution")).toBe(true);
  });

  it("decides a duel from the two men, and nobody writes the winner", () => {
    const result = act("quintus-ogulnius", [{ op: "character_death", characterRef: "quintus-ogulnius", manner: "duel", byCharacterRef: "manius-curius", reason: "A quarrel settled with swords." }]);
    expect(result.rejected).toEqual([]);
    const dead = ["quintus-ogulnius", "manius-curius"].filter((id) => !person(result.world, id).alive);
    expect(dead).toHaveLength(1);
  });

  it("will not put the player into a duel he did not choose", () => {
    const result = act("manius-curius", [{ op: "character_death", characterRef: "manius-curius", manner: "duel", byCharacterRef: "quintus-ogulnius", reason: "Curius challenges him." }],
      world(), { playerCharacterId: "quintus-ogulnius" });
    expect(result.rejected[0]!.kind).toBe("world");
  });

  it("lets a man end his own life, and nobody else end it for him", () => {
    const own = act("quintus-ogulnius", [{ op: "character_death", characterRef: "quintus-ogulnius", manner: "suicide", reason: "He will not be taken." }]);
    expect(person(own.world, "quintus-ogulnius").alive).toBe(false);
    const other = act("gaius-genucius", [{ op: "character_death", characterRef: "quintus-ogulnius", manner: "suicide", reason: "He is said to have despaired." }]);
    expect(person(other.world, "quintus-ogulnius").alive).toBe(true);
  });
});

describe("a measure that does what it says", () => {
  const open = (enacts: unknown): WorldDelta => WorldDeltaSchema.parse({
    op: "political_procedure_open", localId: "law", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
    subjectKind: "polity", subjectRef: "rome", label: "The grain law", resolutionMechanism: "vote", enacts, reason: "A law is put.",
  });

  it("does nothing until it is carried, and then stands as a law of the realm", () => {
    const opened = act("gaius-genucius", [open({ effects: [{ quantity: "food_security", band: "marked" }] })]);
    expect(opened.world.genericEntities.some((entity) => entity.kind === "law")).toBe(false);
    const procedureId = opened.world.material.politicalProcedures.find((procedure) => procedure.label === "The grain law")!.id;
    const carried = act("gaius-genucius", [{ op: "political_procedure_resolve", procedureRef: procedureId, outcome: "passed", outcomeReason: "Carried.", reason: "The vote." }], opened.world);
    const law = carried.world.genericEntities.find((entity) => entity.kind === "law")!;
    expect(law.effects?.[0]?.scope).toBe("realm");
    expect(carried.factProposals.some((fact) => fact.kind === "law_enacted")).toBe(true);
  });

  it("reforms an office's term and adds a seat to its college", () => {
    const opened = act("gaius-genucius", [open({ office: { officeId: "roman-consul", termDays: 730, seats: 3 } })]);
    const procedureId = opened.world.material.politicalProcedures.find((procedure) => procedure.label === "The grain law")!.id;
    const carried = act("gaius-genucius", [{ op: "political_procedure_resolve", procedureRef: procedureId, outcome: "passed", outcomeReason: "Carried.", reason: "The vote." }], opened.world);
    expect(carried.world.offices.find((office) => office.id === "roman-consul")?.termDays).toBe(730);
    expect(carried.world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul")).toHaveLength(3);
  });

  it("founds a council", () => {
    const opened = act("gaius-genucius", [open({ body: { name: "The Tribal Assembly" } })]);
    const procedureId = opened.world.material.politicalProcedures.find((procedure) => procedure.label === "The grain law")!.id;
    const carried = act("gaius-genucius", [{ op: "political_procedure_resolve", procedureRef: procedureId, outcome: "passed", outcomeReason: "Carried.", reason: "The vote." }], opened.world);
    expect(carried.world.material.institutions.some((institution) => institution.name === "The Tribal Assembly" && institution.polityId === "rome")).toBe(true);
  });
});

describe("a treaty that makes things happen", () => {
  it("owes an indemnity for its periods, cedes a province, and sends a hostage", () => {
    const result = act("gaius-genucius", [{
      op: "agreement_open", localId: "peace", kind: "peace", polityId: "rome", otherPolityId: "mamertines", terms: "Peace, on terms.",
      clauses: [
        { kind: "indemnity", payerPolityId: "mamertines", amount: 100, cadenceDays: 30, periods: 5 },
        { kind: "cession", provinceId: SICILY_NE, toPolityId: "rome" },
        { kind: "hostage", characterRef: "mamertine-spokesman", heldByPolityId: "rome" },
      ],
      reason: "The Mamertines submit.",
    }]);
    expect(result.rejected).toEqual([]);
    const indemnity = result.world.material.obligations.find((obligation) => obligation.kind === "tribute" && obligation.remainingPeriods === 5)!;
    expect(indemnity.payerAccountId).toBe("mamertine-treasury");
    expect(indemnity.recipientAccountId).toBe("rome-treasury");
    expect(result.world.map.provinces.find((province) => province.id === SICILY_NE)!.controllerPolityId).toBe("rome");
    const hostage = person(result.world, "mamertine-spokesman");
    expect(hostage.disqualifyingStatuses).toContain("hostage");
    expect(hostage.locationProvinceId).toBe(LATIUM);
  });
});

describe("a man grows", () => {
  it("gets better at what he does, a step at a time, and takes up new ambitions", () => {
    const before = person(world(), "quintus-ogulnius").skills.martial;
    const result = act("gaius-genucius", [{
      op: "character_state_set", characterRef: "quintus-ogulnius",
      skillShifts: [{ skill: "martial", direction: "better" }],
      ambitions: [{ label: "Be consul before he is forty", kind: "office" }],
      reason: "A season in the field.",
    }]);
    const quintus = person(result.world, "quintus-ogulnius");
    expect(quintus.skills.martial).toBe(Math.min(90, before + 10));
    expect(quintus.ambitions.some((ambition) => ambition.status === "active" && ambition.kind === "office")).toBe(true);
  });
});

describe("the order cannot move another power's men", () => {
  const TURN_BACK = { op: "force_modify", forceRef: "carthaginian-fleet", locationId: "tun-13205935b88806172084765", reason: "The Carthaginians turn back." };

  it("is not obeyed when it is the ruler's order", () => {
    const delta = WorldDeltaSchema.parse(TURN_BACK);
    const result = applyDeltas(world(), [delta], context("gaius-genucius", { actsForTheWorld: true, orderDeltas: new Set([delta]) }));
    expect(result.rejected[0]?.kind).toBe("ignored");
  });

  it("will not let the ruler's order bind another government", () => {
    const delta = WorldDeltaSchema.parse({
      op: "agreement_open", localId: "their_pact", kind: "alliance", polityId: "carthage", otherPolityId: "syracuse", terms: "Against Rome.", reason: "Rome decides it.",
    });
    const result = applyDeltas(world(), [delta], context("gaius-genucius", { actsForTheWorld: true, orderDeltas: new Set([delta]) }));
    expect(result.rejected[0]?.kind).toBe("ignored");
  });

  it("is carried out when it is the world moving on its own", () => {
    const delta = WorldDeltaSchema.parse({ ...TURN_BACK, locationId: undefined, name: "The Punic fleet" });
    const result = applyDeltas(world(), [delta], context("gaius-genucius", { actsForTheWorld: true, orderDeltas: new Set() }));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
  });
});
