import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { createGameMasterSession, type FactualEvent, type GameMasterTurnReport, type WorldState } from "@chronica/shared";
import {
  NARRATOR_EXEMPT_SCOPES,
  NARRATOR_OUTCOME_LOCKED_SCOPES,
  buildChronicleFromFacts,
  rewriteClaimsUnsupportedWar,
} from "./chronicle-from-facts";

// The Chronicle is downstream. These tests pin the one property that matters:
// what a reader is told happened is what the engine actually did.

const PLAYER = "marcus-atilius";
const LATIUM = "ita-local-23120603B86473916475875";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const levyEvent: FactualEvent = {
  id: "fact-1-1",
  atStep: 1,
  kind: "action",
  actionId: "create_force",
  actorId: PLAYER,
  parameters: { polityId: "rome", locationProvinceId: LATIUM, name: "Legio II", size: 4_000, kind: "infantry" },
  summary: "Legio II (4000 infantry) raised in Latium for Roman Republic.",
  materialConsequence: true,
};

function report(overrides: Partial<GameMasterTurnReport> = {}): GameMasterTurnReport {
  return {
    directiveOutcomes: [],
    events: [],
    openThreads: [],
    turnSummary: "A turn happened.",
    ...overrides,
  };
}

describe("a completed levy", () => {
  const entries = buildChronicleFromFacts({
    world: world(),
    atStep: 1,
    actorCharacterId: PLAYER,
    events: [levyEvent],
    report: report({
      directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Raised.", factRefs: ["fact-1-1"] }],
    }),
    directiveIds: ["directive-0"],
  });
  const entry = entries.find((candidate) => candidate.scopeRef === "directive-0");

  it("is narrated as a force that exists, named and located", () => {
    expect(entry).toBeDefined();
    expect(entry?.body).toBe(levyEvent.summary);
    expect(entry?.title).toBe("The Raising of Legio II");
    expect(entry?.materialConsequence).toBe(true);
  });

  it("is never narrated as unnamed, uncommanded, provisional, or unable to receive orders", () => {
    // The regression this guards: an executed create_force being recast as an
    // in-progress muster, an anonymous body of men, or a force awaiting a
    // commander it already has.
    const forbidden = [
      /\bunnamed\b/i,
      /\bawait(s|ing)?\b/i,
      /\bprovisional\b/i,
      /\bpending\b/i,
      /\bnot yet\b/i,
      /\bhas no commander\b/i,
      /\bwithout a commander\b/i,
      /\bcannot (yet )?(receive|be given) orders\b/i,
      /\bstill (being )?(raised|mustered|assembled|forming)\b/i,
      /\byet to be (named|raised|mustered)\b/i,
    ];
    for (const pattern of forbidden) {
      expect(entry?.body ?? "").not.toMatch(pattern);
      expect(entry?.title ?? "").not.toMatch(pattern);
    }
    // The narrator does write this entry -- a chronicle that leaves the
    // player's own carried-out orders as raw executor sentences is a receipt,
    // not a record -- but only under an outcome lock, so no rewrite can turn
    // a completed levy back into a pending one.
    expect(NARRATOR_OUTCOME_LOCKED_SCOPES.has(entry!.scope)).toBe(true);
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(false);
  });
});

describe("a refused order", () => {
  it("carries the executor's own reason and nothing invented", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [],
      report: report({
        directiveOutcomes: [{
          directiveId: "directive-0",
          outcome: "refused",
          reason: 'Refused: Workflow "create_force" cannot be applied to the current world state.',
          factRefs: [],
        }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries[0];

    expect(entry?.scope).toBe("order_refusal");
    // The refusal survives exactly; the executor's wording of it does not.
    expect(entry?.body).toContain("came to nothing");
    expect(entry?.body).toContain("circumstances as they stood did not admit it");
    expect(entry?.body).not.toMatch(/workflow|world state|create_force/i);
    expect(entry?.materialConsequence).toBe(false);
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(true);
  });
});

describe("an unsupported attempt", () => {
  it("reports only the factual limitation, with no material consequence", () => {
    const gapEvent: FactualEvent = {
      id: "fact-1-1",
      atStep: 1,
      kind: "capability_gap",
      actionId: "swear_dynastic_oath",
      actorId: PLAYER,
      parameters: {},
      summary: "Marcus Atilius attempted something the simulation does not model: swear a binding dynastic oath. No world change followed; the attempt is recorded as unresolved.",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [gapEvent],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "unsupported", reason: "Not modelled.", factRefs: ["fact-1-1"] }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries[0];

    expect(entry?.scope).toBe("unsupported_action");
    expect(entry?.body).toBe(gapEvent.summary);
    expect(entry?.materialConsequence).toBe(false);
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(true);
  });
});

describe("the chronicle body", () => {
  it("stays bounded by the tool outcome even when the report claims more", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [levyEvent],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Raised.", factRefs: ["fact-1-1"] }],
        events: [{
          factRefs: ["fact-1-1"],
          summary: "Rome raises Legio II, seizes Panormus, and Hanno flees the island in disgrace.",
          participantCharacterIds: [PLAYER],
          provinceId: LATIUM,
          visibility: "public",
          salience: 9,
          directiveRef: null,
          chainPosition: "root",
        }],
      }),
      directiveIds: ["directive-0"],
    });

    // The report's embellishment cannot become a Chronicle body: the only fact
    // it cites was already consumed by the directive entry, and every body in
    // the result is an engine summary.
    const bodies = entries.map((entry) => entry.body);
    expect(bodies).toEqual([levyEvent.summary]);
    for (const body of bodies) {
      expect(body).not.toContain("seizes Panormus");
      expect(body).not.toContain("flees the island");
    }
  });

  it("records a fact the report forgot rather than losing it", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [levyEvent, { ...levyEvent, id: "fact-1-2", actionId: "move_force", summary: "Legio II moves to Western Sicily." }],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Raised.", factRefs: ["fact-1-1"] }],
      }),
      directiveIds: ["directive-0"],
    });

    expect(entries.map((entry) => entry.body)).toContain("Legio II moves to Western Sicily.");
  });

  it("carries a resolved battle's deterministic brief onto its entry", () => {
    const battleEvent: FactualEvent = {
      id: "fact-1-1",
      atStep: 1,
      kind: "action",
      actionId: "resolve_battle",
      actorId: "system",
      parameters: { battleId: "battle-1" },
      summary: "Legio I breaks the Carthaginian host and holds the field.",
      materialConsequence: true,
      battleBrief: {
        provinceName: "North-eastern Sicily",
        outcome: "attacker_victory",
        attackerName: "Legio I",
        defenderName: "Carthaginian host",
        attackerCommanderName: "Marcus Atilius",
        defenderCommanderName: "Hanno",
        attackerCasualties: 400,
        defenderCasualties: 1_100,
        retreated: ["Carthaginian host"],
      },
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [battleEvent],
      report: report(),
      directiveIds: [],
    });

    expect(entries[0]?.battleBrief?.outcome).toBe("attacker_victory");
    expect(entries[0]?.battleBrief?.defenderCasualties).toBe(1_100);
    expect(entries[0]?.body).toBe(battleEvent.summary);
  });
});

describe("a siege recovered from a bad settlement id (the messana/settlement-messana bug)", () => {
  // Regression: start_siege named with the display name "messana" was
  // refused because the authoritative id is "settlement-messana", and the
  // engine's own refusal text -- not a real siege -- used to be exactly what
  // reached the Chronicle. Driving the actual GameMasterSession through the
  // corrected retry proves the Chronicle body it produces describes the real
  // siege, never the lookup mistake that preceded it.
  it("describes the real siege, not the earlier engine-error refusal", () => {
    const session = createGameMasterSession({
      world: structuredClone(punicWarsScenario.initialWorld),
      atStep: 1,
      actorCharacterId: "gaius-genucius",
      directiveIds: [],
    });

    // The besieging force must actually stand at Messana first -- a siege is
    // a real army outside a real wall, not a claim.
    session.invoke({ id: "call-0", name: "move_force", arguments: { actorId: "hieron-ii", forceId: "syracusan-army", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" } });

    const refused = session.invoke({ id: "call-1", name: "start_siege", arguments: { actorId: "hieron-ii", settlementId: "messana", invadingForceIds: ["syracusan-army"] } });
    expect(refused.ok).toBe(false);

    const retried = session.invoke({
      id: "call-2",
      name: "start_siege",
      arguments: { actorId: "hieron-ii", settlementId: "settlement-messana", invadingForceIds: ["syracusan-army"], defendingForceIds: ["mamertine-garrison"] },
    });
    expect(retried.ok).toBe(true);

    const result = session.result();
    const siegeEvent = result.events.find((event) => event.actionId === "start_siege");
    expect(siegeEvent).toBeDefined();

    const entries = buildChronicleFromFacts({
      world: result.world,
      atStep: 1,
      actorCharacterId: "gaius-genucius",
      events: result.events,
      report: report({
        events: [{
          factRefs: [siegeEvent!.id],
          summary: siegeEvent!.summary,
          participantCharacterIds: ["hieron-ii"],
          provinceId: "ita-72843720b81376294924159-sicily-northeast",
          visibility: "public",
          salience: 8,
          directiveRef: null,
          chainPosition: "root",
        }],
      }),
      directiveIds: [],
    });

    // The setup move_force also produced its own (correctly reported)
    // entry -- the point under test is the siege's own entry, which must
    // describe the real siege, never the earlier lookup mistake.
    const siegeEntry = entries.find((entry) => entry.factActionIds?.includes("start_siege"));
    expect(siegeEntry).toBeDefined();
    expect(siegeEntry?.scope).toBe("world_event");
    expect(siegeEntry?.body).toBe(siegeEvent!.summary);
    expect(siegeEntry?.body).not.toMatch(/No settlement exists|refused|Refused/);
    expect(siegeEntry?.factActionIds).toEqual(["start_siege"]);
  });
});

describe("rewriteClaimsUnsupportedWar", () => {
  // Regression: a world-event entry about a polity's newly named leader --
  // created, renamed, or merely selected as the power's voice -- must never
  // be restyled by the narrator into a war declaration with nothing in the
  // factual record to back it. A start_war claim is only ever true when a
  // successful start_war fact is among the entry's own factActionIds.
  it("rejects a war-declaration rewrite when no start_war fact backs the entry", () => {
    expect(rewriteClaimsUnsupportedWar("Brennos declares war on Rome.", ["rename_character"])).toBe(true);
    expect(rewriteClaimsUnsupportedWar("The Boii leader is created to answer for her people.", undefined)).toBe(false);
  });

  it("accepts a war-declaration rewrite when a successful start_war fact backs the entry", () => {
    expect(rewriteClaimsUnsupportedWar("Brennos declares war on Rome.", ["start_war"])).toBe(false);
  });

  it("does not flag prose that never claims a war was declared", () => {
    expect(rewriteClaimsUnsupportedWar("Brennos is named to speak for the Boii.", [])).toBe(false);
  });
});

describe("a world event naming a newly seeded leader", () => {
  it("carries only that leader's own action ids as its factual basis, never start_war", () => {
    const renameEvent: FactualEvent = {
      id: "fact-2-1",
      atStep: 2,
      kind: "action",
      actionId: "rename_character",
      actorId: "system",
      parameters: { characterId: "leader-boii", name: "Brennos" },
      summary: "The Boii leader takes the name Brennos.",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 2,
      actorCharacterId: PLAYER,
      events: [renameEvent],
      report: report({
        events: [{
          factRefs: ["fact-2-1"],
          summary: "The Boii leader takes the name Brennos.",
          participantCharacterIds: ["leader-boii"],
          provinceId: null,
          visibility: "public",
          salience: 5,
          directiveRef: null,
          chainPosition: "spread",
        }],
      }),
      directiveIds: [],
    });

    const entry = entries.find((candidate) => candidate.scopeRef?.includes("fact-2-1"));
    expect(entry?.factActionIds).toEqual(["rename_character"]);
    expect(rewriteClaimsUnsupportedWar("Brennos declares war on Rome in this moment of naming.", entry?.factActionIds)).toBe(true);
  });
});
