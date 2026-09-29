import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type CharacterIntent, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { INTENT_LIFETIME_DAYS, MAX_OPEN_INTENTS, mostPressingFirst, recordActiveIntents, reviewIntents } from "./intents";
import { createIdFactory } from "./ports";

/**
 * A senator alarmed in March was still "watching events" about March's news
 * in December: nothing ever took an intent out of "proposed", and a man who
 * had one was never given a fresher one. An intent now lives a month, is
 * replaced by the newer reason, ends when the man is asked for himself, and
 * a man meaning too much lets the least of it go.
 */

const at = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });
const base = (day = 0): WorldState => at(WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld)), day);
const actor = (characterId: string, why: string, score = 40): RoutedActor => ({ characterId, why, score } as unknown as RoutedActor);
const open = (world: WorldState, characterId: string) => world.characterIntents.filter((intent) => intent.actorCharacterId === characterId && (intent.status === "proposed" || intent.status === "prepared"));

describe("what a man means to do", () => {
  it("is given the fresh reason rather than kept on the old one", () => {
    const first = recordActiveIntents(base(0), [actor("quintus-fabius", "news of Messana")], [], createIdFactory("a"));
    const later = recordActiveIntents(at(first, 10), [actor("quintus-fabius", "the fleet is lost")], [], createIdFactory("b"));
    const intents = open(later, "quintus-fabius");
    expect(intents).toHaveLength(1);
    expect(intents[0]!.rationale).toContain("the fleet is lost");
    expect(intents[0]!.expiresAtStep).toBe(10 + INTENT_LIFETIME_DAYS);
  });

  it("comes to nothing in a month", () => {
    const watching = recordActiveIntents(base(0), [actor("quintus-fabius", "news of Messana")], [], createIdFactory("a"));
    const lapsed = reviewIntents(at(watching, INTENT_LIFETIME_DAYS), INTENT_LIFETIME_DAYS);
    expect(open(lapsed, "quintus-fabius")).toEqual([]);
    expect(lapsed.characterIntents[0]!.status).toBe("abandoned");
    // And is pruned once it has been on record a while.
    expect(reviewIntents(lapsed, INTENT_LIFETIME_DAYS + 61).characterIntents).toEqual([]);
  });

  it("ends when he is asked in his own right", () => {
    const watching = recordActiveIntents(base(0), [actor("quintus-fabius", "news of Messana")], [], createIdFactory("a"));
    const asked = recordActiveIntents(at(watching, 2), [], [actor("quintus-fabius", "he owes an answer")], createIdFactory("b"));
    expect(open(asked, "quintus-fabius")).toEqual([]);
    expect(asked.characterIntents[0]!.status).toBe("executed");
  });

  it("lets the least pressing go when he means too much, and shows the most pressing first", () => {
    const world = base(0);
    const intent = (id: string, priority: number, createdAtStep: number): CharacterIntent => ({
      id, actorCharacterId: "hanno", sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null, actionType: "negotiate", targetIds: [],
      rationale: id, prerequisites: [], intendedWorkflowIds: [], priority, status: "proposed", createdAtStep, reviewedAtStep: null,
      expiresAtStep: null, visibility: "private", sourceEventIds: [], resolutionReason: null,
    });
    const crowded = reviewIntents({ ...world, characterIntents: [intent("a", 10, 0), intent("b", 90, 0), intent("c", 50, 1), intent("d", 50, 2)] }, 3);
    const kept = open(crowded, "hanno").map((entry) => entry.id);
    expect(kept).toHaveLength(MAX_OPEN_INTENTS);
    expect(kept).not.toContain("a");
    expect(mostPressingFirst(open(crowded, "hanno")).map((entry) => entry.id)).toEqual(["b", "d", "c"]);
  });
});
