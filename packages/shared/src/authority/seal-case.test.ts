import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readConstitutionHistory } from "./constitution-history";
import { readLaws } from "./laws";
import { readStandingOrders } from "./standing-orders";
import { readAdministration } from "./administration";
import { buildAgenda, canonicalKey } from "./agenda";
import { whatComesNext } from "./calendar";
import { mattersInHand } from "./matters";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

/** A Roman who holds nothing, to prove that what is public needs no office. */
const citizenOf = (state: WorldState, polityId: string) =>
  state.characters.find((character) => character.alive && character.polityId === polityId
    && !state.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === character.id));

describe("constitutional history", () => {
  it("is explicit that how an opening constitution came to be is not recorded", () => {
    const state = world();
    const reading = readConstitutionHistory({
      ...state,
      constitutions: [{ polityId: "rome", form: "oligarchic_republic", origin: "scenario", adoptedAtStep: 0, rulerOfficeId: null, sovereignInstitutionId: null, history: [] }],
    }, "gaius-genucius", offices, clock);
    expect(reading.entries).toEqual([]);
    expect(reading.beforeRecord).toMatch(/not recorded/i);
  });

  it("lists changes newest first, says who and how, and leaves an old vote unknown", () => {
    const state = world();
    const reading = readConstitutionHistory({
      ...state,
      constitutions: [{
        polityId: "rome", form: "popular_republic", origin: "reform", adoptedAtStep: 200, rulerOfficeId: null, sovereignInstitutionId: null,
        history: [
          { atStep: 100, origin: "reform", fromForm: "monarchy", toForm: "oligarchic_republic", summary: "The kingship was abolished.", byCharacterId: "gaius-genucius" },
          { atStep: 200, origin: "reform", fromForm: "oligarchic_republic", toForm: "popular_republic", summary: "The people took the vote.", byCharacterId: null, procedureId: "p1", bodyName: "Senate", vote: { yes: 60, no: 20 } },
        ],
      }],
    }, "gaius-genucius", offices, clock);
    expect(reading.entries.map((entry) => entry.atStep)).toEqual([200, 100]);
    const [newer, older] = reading.entries;
    expect(newer!.how).toMatch(/vote of the Senate/);
    expect(newer!.detail.voteLabel).toBe("For 60, against 20");
    expect(older!.by?.label).toBeTruthy();
    // Written before votes were kept: it says so rather than guessing.
    expect(older!.detail.unknown.join(" ")).toMatch(/does not say/i);
  });

  it("is open to a citizen who holds no office", () => {
    const state = world();
    const citizen = citizenOf(state, "rome");
    if (citizen === undefined) return;
    const reading = readConstitutionHistory({
      ...state,
      constitutions: [{ polityId: "rome", form: "oligarchic_republic", origin: "scenario", adoptedAtStep: 0, rulerOfficeId: null, sovereignInstitutionId: null, history: [] }],
    }, citizen.id, offices, clock);
    expect(reading.polityLabel).not.toBeNull();
  });

  it("says that the oldest changes are gone when the history is full", () => {
    const state = world();
    const history = Array.from({ length: 24 }, (_, index) => ({ atStep: index + 1, origin: "reform" as const, fromForm: "monarchy" as const, toForm: "monarchy" as const, summary: `Change ${index}.`, byCharacterId: null }));
    const reading = readConstitutionHistory({
      ...state,
      constitutions: [{ polityId: "rome", form: "monarchy", origin: "reform", adoptedAtStep: 24, rulerOfficeId: null, sovereignInstitutionId: null, history }],
    }, "gaius-genucius", offices, clock);
    expect(reading.beforeRecord).toMatch(/no longer recorded/i);
  });
});

describe("laws and proposals", () => {
  it("describes a carried measure from its own record, after the procedure is gone", () => {
    const state = world();
    const enacted: WorldState = WorldStateSchema.parse({
      ...state,
      enactments: [{
        procedureId: "gone", polityId: "rome", effects: [], office: { officeId: "roman-consul", officeLabel: "Consul", authorises: null, seats: 3, abolish: false },
        enactedAtStep: 50,
        record: { title: "Three consuls", bodyName: "Senate", sponsorCharacterId: "gaius-genucius", decidedAtStep: 49, vote: { yes: 70, no: 10 }, said: "the office of Consul is reformed" },
      }],
    });
    const reading = readLaws(enacted, "gaius-genucius", offices, clock);
    const row = reading.inForce.find((candidate) => candidate.key === "gone")!;
    expect(row.name).toBe("Three consuls");
    expect(row.sentence).toMatch(/reforms the office of Consul/i);
    expect(row.detail.body).toBe("Senate");
    expect(row.detail.vote).toBe("For 70, against 10");
  });

  it("says plainly what a measure without a record cannot tell", () => {
    const state = world();
    const enacted: WorldState = WorldStateSchema.parse({
      ...state,
      enactments: [{ procedureId: "old", polityId: "rome", effects: [], body: { name: "Board of Weights" }, enactedAtStep: 50 }],
    });
    const row = readLaws(enacted, "gaius-genucius", offices, clock).inForce.find((candidate) => candidate.key === "old")!;
    expect(row.name).toMatch(/not recorded/i);
    expect(row.detail.unknown.join(" ")).toMatch(/does not say/i);
  });

  it("shows no one else's laws", () => {
    const state = world();
    const enacted: WorldState = WorldStateSchema.parse({
      ...state,
      enactments: [{ procedureId: "theirs", polityId: "carthage", effects: [], body: { name: "Their Board" }, enactedAtStep: 50 }],
    });
    expect(readLaws(enacted, "gaius-genucius", offices, clock).inForce).toEqual([]);
  });

  it("lists what is before the councils with what it would change, and gates the tally", () => {
    const state = world();
    const body = state.material.institutions.find((institution) => institution.polityId === "rome")!;
    const citizen = citizenOf(state, "rome");
    const procedure = {
      id: "proposal", type: "vote" as const, institutionId: body.id, sponsorCharacterId: "gaius-genucius", subjectKind: "polity" as const, subjectId: "rome",
      label: "Found a Board of Weights", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "deliberating" as const, resolutionMechanism: "vote" as const,
      openedAtStep: 1, deadlineStep: 40, resolvedAtStep: null, visibility: "public" as const, voteRecordId: null, outcome: null, outcomeReason: null,
      sourceEventIds: [], resultingEventIds: [],
    };
    const proposed: WorldState = WorldStateSchema.parse({
      ...state,
      material: { ...state.material, politicalProcedures: [...state.material.politicalProcedures, procedure] },
      enactments: [{ procedureId: "proposal", polityId: "rome", effects: [], body: { name: "Board of Weights" } }],
    });
    const mine = readLaws(proposed, "gaius-genucius", offices, clock).before.find((row) => row.key === "proposal")!;
    expect(mine.sentence).toMatch(/If it passes, it founds Board of Weights/);
    expect(mine.detail.vote).not.toBeNull();
    if (citizen !== undefined) {
      const theirs = readLaws(proposed, citizen.id, offices, clock).before.find((row) => row.key === "proposal");
      // Public business is known; how the votes stand is for those in the body.
      if (theirs !== undefined) expect(theirs.detail.vote).toBeNull();
    }
  });
});

describe("standing orders", () => {
  const plan = {
    id: "plan-1", label: "The Burning City", ownerCharacterId: "gaius-genucius", ownerPolityId: "rome",
    trigger: { kind: "character_dies" as const, characterId: "gaius-genucius" }, effect: "stand_to" as const,
    provinceId: "latium", positionId: null, againstPolityId: null, preparationSpend: 0, ambushForceId: null,
    armedReading: "no", armedAtStep: 1, expiresAtStep: null, status: "armed" as const, sprungAtStep: null, tollBps: null,
    standingOrder: "withdraw the garrison",
  };

  it("writes a plan as the player would have said it, and shows only their own", () => {
    const state = WorldStateSchema.parse({ ...world(), contingencies: [plan, { ...plan, id: "plan-2", ownerCharacterId: "someone-else", ownerPolityId: "carthage" }] });
    const reading = readStandingOrders(state, "gaius-genucius", offices, clock);
    expect(reading.rows.map((row) => row.key)).toEqual(["contingency:plan-1"]);
    expect(reading.rows[0]!.summary).toMatch(/^If .+, withdraw the garrison\.$/);
    expect(reading.rows[0]!.status).toBe("waiting");
    expect(reading.rows[0]!.detail.changeable).toBe(true);
  });

  it("maps sprung, called-off and lapsed plans onto triggered, completed and cancelled", () => {
    const state = WorldStateSchema.parse({
      ...world(),
      contingencies: [
        { ...plan, id: "a", status: "sprung" },
        { ...plan, id: "b", status: "sprung", effect: "spring_trap" },
        { ...plan, id: "c", status: "disarmed" },
        { ...plan, id: "d", status: "lapsed" },
      ],
    });
    const byKey = Object.fromEntries(readStandingOrders(state, "gaius-genucius", offices, clock).rows.map((row) => [row.key, row]));
    expect(byKey["contingency:a"]!.status).toBe("triggered");
    expect(byKey["contingency:b"]!.status).toBe("completed");
    expect(byKey["contingency:c"]!.status).toBe("cancelled");
    expect(byKey["contingency:d"]!.status).toBe("cancelled");
    expect(byKey["contingency:c"]!.detail.changeable).toBe(false);
  });
});

describe("administration", () => {
  it("never shows a theft nobody has found, and shows a found one", () => {
    const state = world();
    const department = {
      id: "dept-1", scope: { kind: "polity" as const, id: "rome" }, name: "The Treasury", levers: ["tax_roll" as const], officeIds: ["roman-quaestor"],
      headOfficeId: "roman-consul", deputyOfficeIds: [], pay: "honorary" as const, foundedAtStep: 0, formsAtStep: 0, origin: "scenario" as const,
    };
    const hidden = { id: "d1", byCharacterId: "gaius-genucius", scope: department.scope, departmentId: "dept-1", amount: 999, toAccountId: "acct", firstAtStep: 1, lastAtStep: 5, foundAtStep: null };
    const hiddenOnly = readAdministration(WorldStateSchema.parse({ ...state, departments: [department], diversions: [hidden] }), "gaius-genucius", offices, clock);
    const dept = hiddenOnly.departments.find((entry) => entry.key === "dept-1");
    expect(dept).toBeDefined();
    expect(JSON.stringify(dept)).not.toContain("999");
    expect(dept!.findings.filter((finding) => finding.kind === "found")).toEqual([]);

    const found = readAdministration(WorldStateSchema.parse({ ...state, departments: [department], diversions: [{ ...hidden, foundAtStep: 7 }] }), "gaius-genucius", offices, clock);
    const finding = found.departments.find((entry) => entry.key === "dept-1")!.findings.find((entry) => entry.kind === "found")!;
    expect(finding.text).toContain("999");
    expect(found.departments[0]!.issue?.marked).toBe(true);
  });

  it("tells a vacancy from a body whose holders are not named", () => {
    const state = world();
    const department = {
      id: "dept-2", scope: { kind: "polity" as const, id: "rome" }, name: "The Senate's Clerks", levers: ["courts" as const], officeIds: ["roman-senator"],
      headOfficeId: "roman-consul", deputyOfficeIds: [], pay: "honorary" as const, foundedAtStep: 0, formsAtStep: 0, origin: "scenario" as const,
    };
    const vacant = WorldStateSchema.parse({
      ...state, departments: [department],
      material: { ...state.material, officeSeats: state.material.officeSeats.map((seat) => (seat.officeId === "roman-consul" ? { ...seat, status: "vacant" as const, vacancyCause: "never_filled" as const, holderCharacterId: null } : seat)) },
    });
    const reading = readAdministration(vacant, "gaius-genucius", offices, clock).departments.find((entry) => entry.key === "dept-2")!;
    expect(reading).toBeDefined();
    // The Senate is filled, and the record does not name its three hundred.
    expect(["unnamed", "partly", "held"]).toContain(reading.posts.find((post) => post.key === "roman-senator")?.condition);
    expect(reading.posts.find((post) => post.key === "roman-consul")?.condition).toBe("vacant");
    expect(reading.head.summary).toMatch(/vacant/i);
  });
});

describe("the agenda", () => {
  it("canonicalises the keys the readings share", () => {
    expect(canonicalKey("project:p1:m3")).toBe("project:p1");
    expect(canonicalKey("carried:abc")).toBe("law:abc");
    expect(canonicalKey("letter:x")).toBe("letter:x");
  });

  it("lists a thing once even when the calendar and matters both carry it", () => {
    const state = world();
    const body = state.material.institutions.find((institution) => institution.polityId === "rome")!;
    const procedure = {
      id: "proposal", type: "vote" as const, institutionId: body.id, sponsorCharacterId: "gaius-genucius", subjectKind: "polity" as const, subjectId: "rome",
      label: "Found a Board of Weights", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "deliberating" as const, resolutionMechanism: "vote" as const,
      openedAtStep: 1, deadlineStep: state.elapsedStep + 10, resolvedAtStep: null, visibility: "public" as const, voteRecordId: null, outcome: null, outcomeReason: null,
      sourceEventIds: [], resultingEventIds: [],
    };
    const proposed: WorldState = WorldStateSchema.parse({ ...state, material: { ...state.material, politicalProcedures: [...state.material.politicalProcedures, procedure] } });
    const agenda = buildAgenda({
      calendar: whatComesNext(proposed, "gaius-genucius", offices, clock, 60),
      matters: mattersInHand(proposed, "gaius-genucius", offices, clock),
      laws: readLaws(proposed, "gaius-genucius", offices, clock),
      orders: readStandingOrders(proposed, "gaius-genucius", offices, clock),
      administration: readAdministration(proposed, "gaius-genucius", offices, clock),
    });
    const keys = agenda.groups.flatMap((group) => group.items.map((item) => item.key));
    expect(new Set(keys).size).toBe(keys.length);
    const item = agenda.groups.flatMap((group) => group.items).find((entry) => entry.key === "procedure:proposal");
    expect(item).toBeDefined();
    expect(item!.when).not.toBeNull();
    expect(item!.go?.to).toMatchObject({ surface: "standing", tab: "laws", key: "proposal" });
  });
});
