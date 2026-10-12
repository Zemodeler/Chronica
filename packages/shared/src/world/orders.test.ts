import { describe, expect, it } from "vitest";
import {
  AppliedEffectSchema, MAX_OWED_BURSTS, OrderPartSchema, OrderStageSchema, OrderWorkRefSchema, OwedTurnSchema, effectsOf, owedTurnStands, workWasMadeByPart,
  type OrderPart,
} from "./orders";
import type { WorldState } from "./world-state";

/**
 * The causal links an order's record keeps, and the owed turn's standing:
 * every field is optional, so an old save loads as it was, and a record with
 * none of them proves nothing was made.
 */

describe("a work ref's causal link", () => {
  it("loads an old save's ref, which says nothing of how the thing came to be the part's", () => {
    const ref = OrderWorkRefSchema.parse({ kind: "force", id: "roman-field-army" });
    expect(ref.madeAtStep).toBeUndefined();
    expect(ref.op).toBeUndefined();
    expect(ref.by).toBeUndefined();
    expect(workWasMadeByPart(ref, 0)).toBe(false);
  });

  it("says the part's act made the thing only when stamped on or after the order's day, and not as a guess", () => {
    expect(workWasMadeByPart({ kind: "force", id: "x", madeAtStep: 145, op: "force_create", by: "act" }, 140)).toBe(true);
    expect(workWasMadeByPart({ kind: "force", id: "x", madeAtStep: 139, op: "force_create", by: "act" }, 140)).toBe(false);
    expect(workWasMadeByPart({ kind: "force", id: "x", madeAtStep: 145, op: "force_create", by: "guess" }, 140)).toBe(false);
    expect(workWasMadeByPart({ kind: "force", id: "x", madeAtStep: 145, op: "force_create", by: "stage" }, 140)).toBe(true);
  });
});

describe("a part's applied effects", () => {
  it("are absent on an old save and read as none", () => {
    const part = OrderPartSchema.parse({ said: "Raise an army" });
    expect(part.effects).toBeUndefined();
    expect(effectsOf(part)).toEqual([]);
  });

  it("keep the op, the day, the refs and how it was done, and load again as written", () => {
    const effect = AppliedEffectSchema.parse({ op: "force_create", atStep: 150, refs: [{ kind: "force", id: "legio-nova" }] });
    expect(effect.by).toBe("act");
    expect(effect.attemptId).toBeNull();
    const part = OrderPartSchema.parse({ said: "Raise an army", effects: [effect] });
    expect(OrderPartSchema.parse(JSON.parse(JSON.stringify(part)))).toEqual(part);
  });

  it("refuses more effects than a part keeps", () => {
    const effect = { op: "money_transfer", atStep: 1, refs: [] };
    expect(() => OrderPartSchema.parse({ said: "Pay", effects: Array.from({ length: 25 }, () => effect) })).toThrow();
  });
});

describe("a held act taken up again", () => {
  it("loads an old save's stage with no day of resumption", () => {
    const stage = OrderStageSchema.parse({ held: { op: "force_modify" }, waitsOn: [{ kind: "funds", accountId: "rome-treasury", amount: 5 }] });
    expect(stage.resumedAtStep).toBeUndefined();
    expect(OrderStageSchema.parse({ ...stage, status: "resumed", resumedAtStep: 160 }).resumedAtStep).toBe(160);
  });
});

describe("an owed turn", () => {
  it("loads an old save's entry, which says nothing of why", () => {
    expect(OwedTurnSchema.parse({ characterId: "x", why: "an order", sinceStep: 3 }).cause).toBeUndefined();
    expect(OwedTurnSchema.parse({ characterId: "x", why: "an order", sinceStep: 3, cause: "provider" }).cause).toBe("provider");
  });

  const person = (id: string, alive = true) => ({ id, alive } as unknown as WorldState["characters"][number]);
  const attempt = (recipient: string, status: string, servesRef: string | null = null) => ({ id: `att-${recipient}-${status}`, recipientRef: { kind: "character", id: recipient }, status, servesRef } as unknown as WorldState["orderAttempts"][number]);
  const part = (closedAtStep: number | null): OrderPart => OrderPartSchema.parse({ said: "Bring the fleet round", closedAtStep });
  const world = (change: Partial<Pick<WorldState, "orderAttempts" | "orders" | "diplomacy" | "characters">>) => ({
    orderAttempts: [], orders: [], diplomacy: [], characters: [person("a"), person("b"), person("dead", false)], ...change,
  }) as Pick<WorldState, "orderAttempts" | "orders" | "diplomacy" | "characters">;

  it("stands while a request put to him is unanswered, however many bursts", () => {
    expect(owedTurnStands(world({ orderAttempts: [attempt("a", "issued")] }), { characterId: "a", bursts: 9 })).toBe(true);
    expect(owedTurnStands(world({ orderAttempts: [attempt("a", "refused")] }), { characterId: "a", bursts: 9 })).toBe(false);
  });

  it("stands while he holds an open part of an order, and not once the part is closed", () => {
    const open = world({ orderAttempts: [attempt("a", "accepted", "rec-p0")], orders: [{ id: "rec", actorCharacterId: "p", text: "x", givenAtStep: 0, parts: [part(null)] }] });
    expect(owedTurnStands(open, { characterId: "a", bursts: 9 })).toBe(true);
    const closed = world({ orderAttempts: [attempt("a", "accepted", "rec-p0")], orders: [{ id: "rec", actorCharacterId: "p", text: "x", givenAtStep: 0, parts: [part(150)] }] });
    expect(owedTurnStands(closed, { characterId: "a", bursts: 9 })).toBe(false);
  });

  it("stands while a letter awaits his answer", () => {
    const letter = { id: "m1", status: "awaiting_reply", toCharacterId: "a" } as unknown as WorldState["diplomacy"][number];
    expect(owedTurnStands(world({ diplomacy: [letter] }), { characterId: "a", bursts: 9 })).toBe(true);
  });

  it("stands for a reason it cannot read only a few bursts, and never for a dead man", () => {
    expect(owedTurnStands(world({}), { characterId: "b", bursts: MAX_OWED_BURSTS - 1 })).toBe(true);
    expect(owedTurnStands(world({}), { characterId: "b", bursts: MAX_OWED_BURSTS })).toBe(false);
    expect(owedTurnStands(world({ orderAttempts: [attempt("dead", "issued")] }), { characterId: "dead", bursts: 0 })).toBe(false);
  });
});
