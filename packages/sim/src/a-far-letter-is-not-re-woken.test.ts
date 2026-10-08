import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, kmBetween, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { ASK_REACH_KM, playerInterests } from "./cognition-policy";
import { routeAmbientActors } from "./attention";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { answerALetterNow } from "./letter-reply";
import { lettersOwed } from "./letters";
import { createIdFactory, type SimModelPort } from "./ports";
import { opening } from "./trade-test-kit";

/**
 * A far letter is not re-woken (the user's rule, 2026-10-08).
 *
 * A letter puts its reader into the player's circle for one call, at the moment it is sent (`answerALetterNow`). If that call fails, the letter is not left to wake a man
 * who is far from the player round after round (`lettersOwed`): it is answered by the rules (`answerByRule`, the letter-craft words) once it has reached him and his day
 * comes, or by his silence. A reader who is of the cast, the nemesis, or near the player is asked as before.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "gaius-genucius";
const rules = { warfare: definition.warfare, terrains: definition.map.terrains, gameId: "far-letter" };
const context = (actor: string): ApplyContext => ({ now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, ...rules, ids: createIdFactory(`far-letter-${actor}`), playerCharacterId: PLAYER });

function farReader(world: WorldState): string {
  const here = world.characters.find((character) => character.id === PLAYER)!.locationProvinceId;
  return world.characters.find((character) => character.alive && character.polityId === "ireland-ulster-communities" && (kmBetween(world, here, character.locationProvinceId) ?? Number.POSITIVE_INFINITY) > 3 * ASK_REACH_KM)!.id;
}

function letterTo(world: WorldState, to: string): { readonly world: WorldState; readonly id: string } {
  const sent = applyDeltas(world, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "letter", kind: "letter", fromPolityId: "rome", fromCharacterRef: PLAYER,
    toPolityId: world.characters.find((character) => character.id === to)!.polityId, toCharacterRef: to, subject: "A word", terms: "Rome would have your friendship.",
    replyWithinDays: 5, inReplyToRef: null, visibility: "private", reason: "The consul writes.",
  })], context(PLAYER));
  expect(sent.rejected).toEqual([]);
  return { world: sent.world, id: sent.world.diplomacy.at(-1)!.id };
}

describe("a far letter is not re-woken", () => {
  it("is asked once, at the sending, and a failed call leaves it to the rules rather than to the model's rotation", async () => {
    const start = opening();
    const reader = farReader(start);
    const { world: sent, id } = letterTo(start, reader);
    // The send-time call is made, and fails.
    const broken: SimModelPort = { complete: () => Promise.reject(new Error("the line is down")) };
    const tried = await answerALetterNow({ world: sent, clock: definition.clock, offices, port: broken, messageId: id, rules });
    expect(tried.status).toBe("undecided");
    expect(tried.world.diplomacy.find((message) => message.id === id)?.status).toBe("awaiting_reply");

    // He is far, uncast, with no plot: not in the player's circle any more. The list of letters owed names him; the router does not take it up.
    const now = playerInterests(tried.world, PLAYER, offices);
    expect(now.detailOf(reader)).toBe("background");
    expect(lettersOwed({ ...tried.world, instant: { day: 30, minute: 0 } }, definition.clock).has(reader)).toBe(true);
    const routed = routeAmbientActors({ world: { ...tried.world, instant: { day: 30, minute: 0 } }, cognitionEligible: now.eligibleCharacterIds, facts: [], offices, excludeCharacterIds: [PLAYER], max: 30 });
    expect(routed.map((actor) => actor.characterId)).not.toContain(reader);

    // A burst through the days the letter is due: the reader is never asked, and the letter is answered or lapses by the rules.
    const asked = new Set<string>();
    const port: SimModelPort = { complete(operation, _system, user) {
      if (operation === "simulate_cognition") { for (const match of user.matchAll(/^## .+ \[([^\]]+)\]$/gm)) asked.add(match[1]!); return Promise.resolve('{"actors":[]}'); }
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["administration"] }, narrativeSummary: "Time passes.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const result = await runSimulationBurst({ world: tried.world, clock: definition.clock, offices, warfare: definition.warfare, terrains: definition.map.terrains, burstId: "far-letter", gameId: "far-letter",
      actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "Let sixty days pass.", spanDays: 60, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    expect(asked.has(reader)).toBe(false);
    expect(result.world.diplomacy.find((message) => message.id === id)?.status).not.toBe("awaiting_reply");
  }, 180_000);

  it("keeps the near and the cast as before: a letter to a seated man still wakes him", () => {
    const start = opening();
    const reader = farReader(start);
    const { world: sent } = letterTo(start, reader);
    const seated: WorldState = { ...sent, cast: { ...sent.cast, members: [{ characterId: reader, seat: "world", sinceStep: 0, salience: 30, why: "rules a power the player deals with", belowFor: 0, reviews: 0 }] } };
    expect(playerInterests(seated, PLAYER, offices).detailOf(reader)).toBe("personal");
  });
});
