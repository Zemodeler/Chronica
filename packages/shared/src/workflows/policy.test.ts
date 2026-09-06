import { describe, expect, it } from "vitest";
import { createInvocationDuplicateGuard } from "./policy";

// docs/27: idempotency is enforced once, by a guard any caller can hold --
// not re-derived per source. `session.ts` used to only check this for
// `game_master`-sourced invocations; the guard itself makes no such
// distinction, so widening its use to every source closes that gap without
// touching the guard's own behavior.

describe("createInvocationDuplicateGuard", () => {
  it("is not a duplicate the first time an invocation is seen", () => {
    const guard = createInvocationDuplicateGuard();
    const invocation = { actionId: "move_force", actorId: "legio-i", parameters: { forceId: "legio-i", destinationProvinceId: "sicily-west" } };
    expect(guard.isDuplicate(invocation)).toBe(false);
  });

  it("is a duplicate once the exact same invocation has been recorded", () => {
    const guard = createInvocationDuplicateGuard();
    const invocation = { actionId: "resolve_battle", actorId: "system", parameters: { battleId: "battle-1" } };
    guard.record(invocation);
    expect(guard.isDuplicate(invocation)).toBe(true);
  });

  it("distinguishes invocations by parameters, not just action and actor", () => {
    const guard = createInvocationDuplicateGuard();
    guard.record({ actionId: "move_force", actorId: "legio-i", parameters: { forceId: "legio-i", destinationProvinceId: "sicily-west" } });
    expect(guard.isDuplicate({ actionId: "move_force", actorId: "legio-i", parameters: { forceId: "legio-i", destinationProvinceId: "sicily-east" } })).toBe(false);
  });

  it("treats key order in parameters as equivalent", () => {
    const guard = createInvocationDuplicateGuard();
    guard.record({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "battle-1", attackerPosture: "assault" } });
    expect(guard.isDuplicate({ actionId: "resolve_battle", actorId: "system", parameters: { attackerPosture: "assault", battleId: "battle-1" } })).toBe(true);
  });
});
