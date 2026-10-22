import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { deadlinesFor, newDeadlines } from "./deadlines";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ultimatum = (to: string) => DiplomaticMessageSchema.parse({
  id: "message-u1", kind: "ultimatum", fromPolityId: "carthage", fromCharacterId: "hanno-carthage", toPolityId: to,
  subject: "An ultimatum", terms: "Leave the strait or there is war.", sentAtStep: 0, replyDueByStep: 30, onRefusal: "war",
});

describe("deadlines put to the player's power", () => {
  it("lists an ultimatum with its day and what follows, and only for the power it was sent to", () => {
    const before = world();
    const after: WorldState = { ...before, diplomacy: [...before.diplomacy, ultimatum("syracuse")] };
    expect(deadlinesFor(after, "syracuse")).toEqual([{ kind: "ultimatum", id: "message-u1", otherPolityId: "carthage", subject: "An ultimatum", dueStep: 30, onRefusal: "war" }]);
    expect(deadlinesFor(after, "rome")).toEqual([]);
    expect(newDeadlines(before, after, "syracuse")).toHaveLength(1);
    expect(newDeadlines(after, after, "syracuse")).toHaveLength(0);
  });

  it("is not listed once answered", () => {
    const before = world();
    const answered: WorldState = { ...before, diplomacy: [...before.diplomacy, { ...ultimatum("syracuse"), status: "answered" as const }] };
    expect(deadlinesFor(answered, "syracuse")).toEqual([]);
  });

  it("warns of a truce thirty days before it lapses, and not earlier", () => {
    const base = world();
    const truce = (untilStep: number) => ({ id: "truce-1", kind: "truce" as const, polityId: "carthage", otherPolityId: "syracuse", status: "active" as const, untilStep, terms: "A truce.", sinceStep: 0, sourceMessageId: null, reason: "x", visibility: "public" as const });
    const near: WorldState = { ...base, elapsedStep: 100, polityAgreements: [...base.polityAgreements, truce(120) as never] };
    const far: WorldState = { ...base, elapsedStep: 100, polityAgreements: [...base.polityAgreements, truce(200) as never] };
    expect(deadlinesFor(near, "syracuse").map((d) => [d.kind, d.dueStep])).toEqual([["truce_ends", 120]]);
    expect(deadlinesFor(far, "syracuse")).toEqual([]);
  });
});
