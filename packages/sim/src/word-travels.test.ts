import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterIntentSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  advanceWorldTo,
  buildStation,
  ensureProvinceMaterial,
  newsDaysBetween,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { routeAttention } from "./attention";
import { renderCharacterPortrait } from "./cognition";
import { materializeFacts } from "./facts";
import { aLetterWaitsOnItsReader, lettersOwed, markLettersPut, nextReplyDueKey } from "./letters";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { runDeterministicTick } from "./tick";

/**
 * "Write to Hieron: will Syracuse stand with Rome?"
 *
 * The consul wrote from Latium on the 1st and Hieron had the letter on the
 * 1st, read it, and answered it the same hour, from Syracuse. A letter was
 * delivered the moment it was written, whoever and wherever its reader was.
 * Now it travels the road the news travels, and the answer it asks for is
 * owed from the day it arrives.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const CONSUL = "gaius-genucius";
const HIERON = "hieron-ii";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function written(state: WorldState) {
  return applyDeltas(state, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "to_hieron", kind: "alliance_offer", fromPolityId: "rome", fromCharacterRef: CONSUL,
    toPolityId: "syracuse", toCharacterRef: HIERON, subject: "Will Syracuse stand with Rome?", terms: "Rome offers Syracuse an alliance.",
    replyWithinDays: 10, inReplyToRef: null, visibility: "polity", reason: "The consul writes.",
  })], {
    now: state.instant, actorRef: { kind: "character", id: CONSUL }, offices, warfare: definition.warfare, terrains: definition.map.terrains,
    ids: createIdFactory("road"), gameId: "game-road",
  });
}

describe("a letter on the road", () => {
  it("takes the days the road takes, and asks its answer from the day it arrives", () => {
    const state = opening();
    const sent = written(state);
    expect(sent.rejected).toEqual([]);
    const letter = sent.world.diplomacy.at(-1)!;
    const from = state.characters.find((character) => character.id === CONSUL)!.locationProvinceId;
    const to = state.characters.find((character) => character.id === HIERON)!.locationProvinceId;
    expect(letter.deliveredOnDay).toBe(state.elapsedStep + newsDaysBetween(state, from, to));
    expect(letter.deliveredOnDay).toBeGreaterThan(state.elapsedStep);
    expect(letter.replyDueByStep).toBe(letter.deliveredOnDay! + 10);
    // What it says is not known in Syracuse until it gets there either.
    const told = sent.factProposals.find((fact) => fact.kind === "letter_sent")!;
    expect(told.discoveryState).toBe("delayed");
    expect(told.knowableInDays).toBe(letter.deliveredOnDay! - state.elapsedStep);
  });

  it("is in front of nobody until it comes, and is then", () => {
    const sent = written(opening()).world;
    const letter = sent.diplomacy.at(-1)!;
    expect(lettersOwed(sent, definition.clock).has(HIERON)).toBe(false);
    expect(aLetterWaitsOnItsReader(sent)).toBe(false);
    expect(markLettersPut(sent, new Set([HIERON])).diplomacy.at(-1)!.putToRecipientOnDay).toBeUndefined();
    expect(renderCharacterPortrait(HIERON, "Hieron II", sent, definition.clock)).not.toContain("Will Syracuse stand with Rome?");
    // Its arrival is on the calendar, so the burst stops for it.
    expect(nextReplyDueKey(sent, sent.instant.day * 1440)).toBe(letter.deliveredOnDay! * 1440);

    const arrived = advanceWorldTo(sent, { day: letter.deliveredOnDay!, minute: 0 });
    expect(lettersOwed(arrived, definition.clock).has(HIERON)).toBe(true);
    expect(aLetterWaitsOnItsReader(arrived)).toBe(true);
    expect(renderCharacterPortrait(HIERON, "Hieron II", arrived, definition.clock)).toContain("Will Syracuse stand with Rome?");
  });

  it("is not taken for silence from a reader who never had it", () => {
    const sent = written(opening()).world;
    const letter = sent.diplomacy.at(-1)!;
    // Run past its term, which runs from its arrival, nobody has read it to refuse it.
    const ticked = runDeterministicTick({ world: { ...sent, elapsedStep: letter.replyDueByStep! + 1 }, toDay: letter.replyDueByStep! + 1, ids: createIdFactory("silence"), warfare: definition.warfare });
    expect(ticked.world.diplomacy.at(-1)!.status).toBe("awaiting_reply");
  });

  it("is shown to its writer as on its way, and not yet to the government it is going to", () => {
    const sent = written(opening()).world;
    const letterId = sent.diplomacy.at(-1)!.id;
    const ours = buildWorldSlice({ world: sent, clock: definition.clock, offices, actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText: null, facts: [], dueEvents: [], pendingEvents: [] });
    expect(ours.letters.find((entry) => entry.id === letterId)?.arrivesInDays).toBeGreaterThan(0);
    expect(renderWorldSlice(ours)).toMatch(/still on the road: it reaches them in \d+ day\(s\)/);
    const theirs = buildWorldSlice({ world: sent, clock: definition.clock, offices, actorRef: { kind: "character", id: HIERON }, actorPolityId: "syracuse", orderText: null, facts: [], dueEvents: [], pendingEvents: [] });
    expect(theirs.letters.some((entry) => entry.id === letterId)).toBe(false);
  });
});

describe("the people in the room", () => {
  it("know a delayed thing when it can be known, and a report keeps the men it counted", () => {
    const state = opening();
    const legion = state.material.forces.find((force) => force.polityId === "rome")!;
    const { facts } = materializeFacts({
      proposals: [{
        localId: "held_back", kind: "dispatch", summary: "Word goes south.", affectedRefs: [{ kind: "force", id: legion.id }],
        visibility: "private", discoveryState: "delayed", knowableInDays: 4, knownToRefs: [{ kind: "character", id: HIERON }], significance: 20,
      }],
      now: state.instant, atStep: state.elapsedStep, ids: createIdFactory("room"), causalDepth: 0, assignedIds: new Map(), forces: state.material.forces,
    });
    const [fact] = facts;
    // Stamped with the instant it could be known, not the instant it was written.
    expect(fact!.discovery.discoveredBy[0]!.atInstant.day).toBe(state.instant.day + 4);
    expect(fact!.forcesAsReported).toEqual([{ forceId: legion.id, men: legion.personnel.reduce((sum, group) => sum + group.fit, 0), locationId: legion.locationId }]);
  });
});

describe("who hears a government's business", () => {
  it("is the man who governs, not every citizen of the power", () => {
    const state = opening();
    const home = state.characters.find((character) => character.id === CONSUL)!.locationProvinceId;
    // Both in the city, so the road is no part of it.
    const together = { ...state, characters: state.characters.map((character) => (character.id === "manius-curius" ? { ...character, locationProvinceId: home } : character)) };
    const [dispatch] = materializeFacts({
      proposals: [{ localId: "dispatch", kind: "senate_dispatch", summary: "The Senate sends instructions to the consul.", affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 40 }],
      now: together.instant, atStep: together.elapsedStep, ids: createIdFactory("dispatch"), causalDepth: 0, assignedIds: new Map(),
    }).facts;
    const routed = routeAttention({ world: together, facts: [dispatch!], offices, excludeCharacterIds: [], maxFocused: 60, maxCausalDepth: 3 });
    const heard = new Set([...routed.focused, ...routed.active].map((actor) => actor.characterId));
    expect(heard.has(CONSUL)).toBe(true);
    expect(heard.has("manius-curius")).toBe(false);
  });
});

describe("a man counting the enemy", () => {
  it("counts them as scouts would, never to the man", () => {
    // Decius Vibellius at Rhegium was told the consul's army to the last soldier.
    const state = opening();
    const bruttium = PUNIC_IDS.rhegium;
    const atRhegium = { ...state, material: { ...state.material, forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: bruttium } : force)) } };
    const army = atRhegium.material.forces.find((force) => force.id === "roman-field-army")!;
    const exact = army.personnel.reduce((sum, group) => sum + group.fit, 0);
    const line = renderCharacterPortrait("decius-vibellius", "Decius Vibellius", atRhegium, definition.clock).split("\n").find((row) => row.includes("[roman-field-army]"))!;
    expect(line).toMatch(/(about|between) [\d,]+ (and [\d,]+ )?men/);
    expect(line).not.toContain(`${exact} men`);
    expect(line).not.toContain(`${exact.toLocaleString("en-GB")} men`);
  });
});

describe("the world slice", () => {
  const sliceFor = (state: WorldState, characterId: string) => buildWorldSlice({
    world: state, clock: definition.clock, offices, actorRef: { kind: "character", id: characterId }, actorPolityId: "rome",
    orderText: "What news?", facts: [], dueEvents: [], pendingEvents: [],
  });

  it("puts everything the actor knows before the world's own half, and the world's own half last", () => {
    const text = renderWorldSlice(sliceFor(opening(), CONSUL));
    const header = text.indexOf("── THE WORLD ITSELF ──");
    expect(header).toBeGreaterThan(0);
    // His own people, and his own letters, used to follow a header saying he
    // had been told none of what followed.
    for (const known of ["PEOPLE", "WHAT THIS PERSON MAY DO", "OTHER POWERS"]) {
      const at = text.indexOf(`${known}`);
      if (at >= 0) expect(at).toBeLessThan(header);
    }
    for (const worldOnly of ["STANDING AIMS", "OPEN THREADS", "ACTIVE PROJECTS"]) {
      const at = text.indexOf(`\n${worldOnly}`);
      if (at >= 0) expect(at).toBeGreaterThan(header);
    }
  });

  it("briefs a consul on what his own people mean to do, not on what every foreigner does", () => {
    const state = opening();
    const station = buildStation({ world: state, characterId: CONSUL, offices });
    const consul = state.characters.find((character) => character.id === CONSUL)!;
    const stranger = state.characters.find((character) =>
      character.alive && character.polityId !== "rome" && !station.knownCharacterIds.has(character.id) && character.locationProvinceId !== consul.locationProvinceId
      && !state.diplomacy.some((message) => [message.fromCharacterId, message.toCharacterId].includes(character.id)))!;
    const roman = state.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== CONSUL)!;
    const intent = (actorCharacterId: string, rationale: string) => CharacterIntentSchema.parse({
      id: `intent-${actorCharacterId}`, actorCharacterId, actionType: "fulfill_commitment", targetIds: [], rationale, prerequisites: [], intendedWorkflowIds: [],
      priority: 50, status: "proposed", createdAtStep: 0, visibility: "private",
    });
    const withIntents = { ...state, characterIntents: [...state.characterIntents, intent(stranger.id, "A foreigner's own design."), intent(roman.id, "A Roman's own design.")] };
    const rationales = sliceFor(withIntents, CONSUL).intents.map((entry) => entry.rationale);
    expect(rationales).toContain("A Roman's own design.");
    expect(rationales).not.toContain("A foreigner's own design.");
  });
});
