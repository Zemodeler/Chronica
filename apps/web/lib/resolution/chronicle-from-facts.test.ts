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

describe("occurredAtDay / finalizedAtDay (docs/32, Phase 11)", () => {
  it("populates identical occurredAtDay/finalizedAtDay from atStep, since every fact is still atomic", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 4,
      actorCharacterId: PLAYER,
      events: [levyEvent],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Raised.", factRefs: ["fact-1-1"] }],
      }),
      directiveIds: ["directive-0"],
      scenarioClock: { stepLabel: "season", stepLabelPlural: "seasons", stepsPerYear: 4, minSpan: 1, maxSpan: 10 },
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "directive-0");
    expect(entry?.occurredAtDay).toBe(365);
    expect(entry?.finalizedAtDay).toBe(365);
  });

  it("falls back to the engine default when no scenario clock is supplied", () => {
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
    expect(entry?.occurredAtDay).toBeDefined();
    expect(entry?.occurredAtDay).toBe(entry?.finalizedAtDay);
  });
});

describe("a generic entity-state delta", () => {
  it("gives a force-created consequence its entity name, not just a text label", () => {
    const withDelta: FactualEvent = {
      ...levyEvent,
      stateDeltas: [{ entityType: "force", entityId: "force-legio-ii", entityName: "Legio II", change: "created" }],
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [withDelta],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Raised.", factRefs: ["fact-1-1"] }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "directive-0");
    const consequence = entry?.directConsequences?.[0];
    expect(consequence?.entityId).toBe("force-legio-ii");
    expect(consequence?.entityName).toBe("Legio II");
    expect(consequence?.changeKind).toBe("created");
  });

  it("gives a province-control consequence a real before/after, not a string it has to re-derive later -- and this is generic: any workflow that changes controllerPolityId produces the same shape, not just change_province_control", () => {
    const controlChange: FactualEvent = {
      id: "fact-1-2",
      atStep: 1,
      kind: "action",
      actionId: "change_province_control",
      actorId: PLAYER,
      parameters: { provinceId: LATIUM, newControllerPolityId: "rome", firmnessBps: 5_000, reason: "Conquered." },
      summary: "Latium passes from neutral to Roman Republic. Conquered.",
      materialConsequence: true,
      stateDeltas: [
        {
          entityType: "province",
          entityId: LATIUM,
          entityName: "Latium",
          change: "updated",
          fields: [{ field: "controllerPolityId", from: "unclaimed", to: "Roman Republic" }],
        },
      ],
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [controlChange],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Conquered.", factRefs: ["fact-1-2"] }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "directive-0");
    const consequence = entry?.directConsequences?.[0];
    expect(consequence?.entityName).toBe("Latium");
    expect(consequence?.changeKind).toBe("updated");
    expect(consequence?.fields).toEqual([{ field: "controllerPolityId", from: "unclaimed", to: "Roman Republic" }]);
  });

  it("covers a battle's effect (casualties, a captured settlement) the same generic way, with no battle-specific code", () => {
    const battleResolved: FactualEvent = {
      id: "fact-1-5",
      atStep: 1,
      kind: "action",
      actionId: "resolve_battle",
      actorId: PLAYER,
      parameters: { battleId: "battle-1" },
      summary: "The battle is resolved.",
      materialConsequence: true,
      stateDeltas: [
        { entityType: "force", entityId: "force-hanno", entityName: "Hanno's Army", change: "updated", fields: [{ field: "fitStrength", from: 8_000, to: 3_000 }] },
        { entityType: "settlement", entityId: "settlement-messana", entityName: "Messana", change: "updated", fields: [{ field: "controllerPolityId", from: "carthage", to: "Roman Republic" }] },
      ],
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [battleResolved],
      report: report({
        events: [{ factRefs: ["fact-1-5"], summary: "Battle resolved.", participantCharacterIds: [], provinceId: null, visibility: "public", salience: 8, directiveRef: null, chainPosition: "root" }],
      }),
      directiveIds: [],
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "fact-1-5");
    expect(entry?.directConsequences).toHaveLength(2);
    expect(entry?.directConsequences?.map((c) => c.entityName).sort()).toEqual(["Hanno's Army", "Messana"]);
  });
});

describe("an initiated conversation", () => {
  it("attaches the character, topic, and opening line to the entry that carries the flag", () => {
    const flagEvent: FactualEvent = {
      id: "fact-1-3",
      atStep: 1,
      kind: "action",
      actionId: "flag_npc_initiated_dialogue",
      actorId: "hanno",
      parameters: { characterId: "hanno", topic: "Carthage's fleet near Messana", openingLine: "We need to speak, before this goes further." },
      summary: "Hanno wants to speak with you: Carthage's fleet near Messana",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [flagEvent],
      report: report({
        events: [{ factRefs: ["fact-1-3"], summary: flagEvent.summary, participantCharacterIds: ["hanno"], provinceId: null, visibility: "public", salience: 6, directiveRef: null, chainPosition: "root" }],
      }),
      directiveIds: [],
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "fact-1-3");
    expect(entry?.initiatedDialogue).toEqual({
      characterId: "hanno",
      characterName: "Hanno",
      topic: "Carthage's fleet near Messana",
      openingLine: "We need to speak, before this goes further.",
    });
  });

  it("never attaches a flag pointing at a dead or nonexistent character", () => {
    const flagEvent: FactualEvent = {
      id: "fact-1-4",
      atStep: 1,
      kind: "action",
      actionId: "flag_npc_initiated_dialogue",
      actorId: "nobody",
      parameters: { characterId: "nobody", topic: "A ghost speaks", openingLine: "..." },
      summary: "nobody wants to speak with you",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [flagEvent],
      report: report(),
      directiveIds: [],
    });
    for (const entry of entries) expect(entry.initiatedDialogue).toBeUndefined();
  });
});

describe("internal resolution records", () => {
  it("never promotes plans, memory, or scheduler pressures into Chronicle events", () => {
    const internalEvents: FactualEvent[] = [
      { id: "fact-1-plan", atStep: 1, kind: "action", actionId: "plan_update", actorId: PLAYER, parameters: {}, summary: "A continuing plan was prepared.", materialConsequence: false },
      { id: "fact-1-note", atStep: 1, kind: "action", actionId: "record_entity_note", actorId: PLAYER, parameters: {}, summary: "Noted of force-1: keep the supply route open.", materialConsequence: false },
      { id: "fact-1-development", atStep: 1, kind: "action", actionId: "world_development", actorId: "hanno", parameters: {}, summary: "Messana needs reconstruction; Hanno has an opportunity to organize recovery.", materialConsequence: false },
      { id: "fact-1-pressure", atStep: 1, kind: "action", actionId: "world_incursion_pressure", actorId: "hanno", parameters: {}, summary: "Hanno faces an immediate military emergency.", materialConsequence: true },
      { id: "fact-1-scrutiny", atStep: 1, kind: "action", actionId: "roman_senate_scrutiny", actorId: PLAYER, parameters: {}, summary: "The Senate calls Marcus Atilius to account.", materialConsequence: true },
    ];

    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: internalEvents,
      report: report(),
      directiveIds: [],
    });

    expect(entries).toEqual([]);
  });

  it("does not represent preparing a plan as a carried-out player order", () => {
    const planFact: FactualEvent = {
      id: "fact-1-plan",
      atStep: 1,
      kind: "action",
      actionId: "plan_update",
      actorId: PLAYER,
      parameters: {},
      summary: "A continuing plan was prepared.",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [planFact],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Plan prepared.", factRefs: [planFact.id] }],
      }),
      directiveIds: ["directive-0"],
    });

    expect(entries).toEqual([]);
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
          reason: "Refused: Hanno holds no authority over the Carthaginian treasury.",
          factRefs: [],
        }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries[0];

    expect(entry?.scope).toBe("order_refusal");
    // The refusal survives exactly; the executor's wording of it does not.
    expect(entry?.body).toContain("found no ears");
    expect(entry?.body).toContain("holds no authority over the Carthaginian treasury");
    expect(entry?.materialConsequence).toBe(false);
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(true);
  });

  // The bug: every failure read as a refusal, so an order that died on a
  // guessed id was written up as one the world heard and rejected. Nobody
  // heard it. Nobody refused it. Saying otherwise invents a decision that no
  // one in the world ever made.
  it("does not call an engine failure a refusal", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [],
      report: report({
        directiveOutcomes: [{
          directiveId: "directive-0",
          outcome: "failed",
          reason: 'Refused: Workflow "create_force" cannot be applied to the current world state.',
          factRefs: [],
        }],
      }),
      directiveIds: ["directive-0"],
    });
    const entry = entries[0];

    expect(entry?.scope).toBe("order_unresolved");
    expect(entry?.title).toBe("The Order Left Unresolved");
    expect(entry?.body).not.toContain("found no ears");
    expect(entry?.body).toContain("could not be carried out");
    expect(entry?.body).toContain("No one refused it");
    expect(entry?.body).not.toMatch(/workflow|world state|create_force/i);
    expect(entry?.materialConsequence).toBe(false);
    // Still executor-worded: the narrator may not dress an engine failure in
    // an institutional cause it never had.
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(true);
  });

  it("uses a validated named aftermath instead of bland engine prose", () => {
    const aftermath: FactualEvent = {
      id: "fact-1-2",
      atStep: 1,
      kind: "action",
      actionId: "record_refusal_aftermath",
      actorId: "quintus-fabius",
      parameters: {
        requesterCharacterId: PLAYER,
        refuserCharacterId: "quintus-fabius",
        rejectedActionId: "remove_gold",
        reason: "The Senate will not fund a commander's private quarrel.",
        quote: "ROME NON REGEM HABET.",
      },
      summary: "Quintus Fabius refused Marcus Atilius's attempt to remove gold. “ROME NON REGEM HABET.” The Senate will not fund a commander's private quarrel.",
      materialConsequence: false,
    };
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [aftermath],
      report: report({
        directiveOutcomes: [{
          directiveId: "directive-0",
          outcome: "refused",
          reason: "Actor lacks treasury access.",
          factRefs: ["fact-1-2"],
        }],
      }),
      directiveIds: ["directive-0"],
    });

    expect(entries[0]?.title).toBe("The Refusal Answered");
    expect(entries[0]?.body).toContain("ROME NON REGEM HABET");
    expect(entries[0]?.body).toContain("private quarrel");
    expect(entries[0]?.materialConsequence).toBe(false);
  });
});

describe("a turn whose Game Master session never produced an accepted report", () => {
  // Regression: `report` is null whenever the session hit a step/tool budget
  // or the model stopped without calling finish_turn (game-master.ts's
  // "step_budget" / "tool_budget" / "model_stopped" terminations). This must
  // never be worded as a refusal -- nothing in the world said no, the
  // resolution simply did not finish -- and any real, validated work the
  // session did complete before that point must still reach the Chronicle.
  it("reports the player's own directive as unresolved, not as a refusal", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [],
      report: null,
      directiveIds: ["directive-0"],
    });
    const entry = entries.find((candidate) => candidate.scopeRef === "directive-0");

    expect(entry?.scope).toBe("resolution_incomplete");
    expect(entry?.title).toBe("Resolution Incomplete");
    expect(entry?.body).not.toMatch(/found no ears/i);
    expect(entry?.materialConsequence).toBe(false);
    // Executor-derived, deterministic wording: never handed to the free-form
    // narrator, which could otherwise turn an incomplete turn into an
    // invented refusal or a fictional outcome.
    expect(NARRATOR_EXEMPT_SCOPES.has(entry!.scope)).toBe(true);
  });

  it("still records real, validated work the session completed before it stopped short", () => {
    const entries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [levyEvent],
      report: null,
      directiveIds: ["directive-0"],
    });

    const worldEntry = entries.find((candidate) => candidate.scopeRef === levyEvent.id);
    expect(worldEntry).toBeDefined();
    expect(worldEntry?.body).toBe(levyEvent.summary);
    expect(worldEntry?.materialConsequence).toBe(true);
  });
});

describe("an unsupported attempt", () => {
  it("stays in the internal audit and never reaches the Chronicle", () => {
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
    const playerEntries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [gapEvent],
      report: report({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "unsupported", reason: "Not modelled.", factRefs: ["fact-1-1"] }],
      }),
      directiveIds: ["directive-0"],
    });
    expect(playerEntries).toEqual([]);

    // The screenshot's failure path: an AI world event cites only a
    // capability gap. It must be hidden too, not merely player directives.
    const worldEntries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [gapEvent],
      report: report({
        events: [{
          factRefs: ["fact-1-1"],
          summary: "Hanno advances his plot.",
          visibility: "public",
          participantCharacterIds: ["hanno-carthage"],
          provinceId: null,
          directiveRef: null,
          chainPosition: "pressure",
          salience: 8,
        }],
      }),
      directiveIds: [],
    });
    expect(worldEntries).toEqual([]);

    // Nor can an unreported capability gap leak through the fallback pass.
    const fallbackEntries = buildChronicleFromFacts({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      events: [gapEvent],
      report: report(),
      directiveIds: [],
    });
    expect(fallbackEntries).toEqual([]);
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
      summary: "The existing leader of Boii is identified in the record as Brennos.",
      materialConsequence: false,
    };
    const knownBoiiLeader = {
      ...world().characters[0]!,
      id: "leader-boii",
      name: "Brennos",
      polityId: "boii",
      createdByDirector: true,
    };
    const entries = buildChronicleFromFacts({
      world: {
        ...world(),
        map: { ...world().map, polities: [...world().map.polities, { id: "boii", name: "Boii", capitalSettlementId: null }] },
        characters: [...world().characters, knownBoiiLeader],
      },
      atStep: 2,
      actorCharacterId: PLAYER,
      events: [renameEvent],
      report: report({
        events: [{
          factRefs: ["fact-2-1"],
          summary: "The existing leader of Boii is identified in the record as Brennos.",
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
    expect(entry?.title).toBe("Brennos of Boii");
    expect(entry?.body).toContain("existing leader");
    expect(rewriteClaimsUnsupportedWar("Brennos declares war on Rome in this moment of naming.", entry?.factActionIds)).toBe(true);
  });
});
