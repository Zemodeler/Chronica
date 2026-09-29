import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PROVINCE_LEVELS } from "../material-state";
import { MECHANIC_ARMS, MechanicDraftSchema, MechanicPredicateSchema, MechanicSchema, stableKey, type MechanicDraft } from "./mechanic";
import { WATCH_ARMS, WatchPredicateSchema } from "./watch";

const toll: MechanicDraft = {
  trigger: { kind: "monthly" },
  conditions: [{ kind: "province_level_above", provinceId: "latium", level: "stability", bps: 4_000 }],
  effects: [{ op: "money_transfer", fromAccountId: "gaius-purse", toAccountId: "rome-treasury", amount: { kind: "band", band: "slight" } }],
  end: { kind: "owner_death" },
  price: { setup: 120, upkeepPerMonth: 10 },
  why: "A toll on the bridge, while the province is orderly enough to collect it.",
};

describe("the mechanic schema", () => {
  it("round-trips a draft and fills the engine's bookkeeping with defaults", () => {
    const parsed = MechanicSchema.parse({ ...toll, attachedAtStep: 12, origin: "written", shapeKey: stableKey(toll) });
    expect(parsed.firedCount).toBe(0);
    expect(parsed.debitWarrants).toEqual([]);
    expect(parsed.nextDueStep).toBeNull();
    expect(MechanicSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("refuses a rule that fires on its own firings, or one with nothing to do", () => {
    expect(MechanicDraftSchema.safeParse({ ...toll, trigger: { kind: "on_fact", factKind: "mechanic_fired", subjectRef: null } }).success).toBe(false);
    expect(MechanicDraftSchema.safeParse({ ...toll, effects: [] }).success).toBe(false);
  });

  it("speaks every arm the watch speaks, and its own, and no other", () => {
    expect(MechanicPredicateSchema.options).toHaveLength(WATCH_ARMS.length + MECHANIC_ARMS.length);
    const kinds = MechanicPredicateSchema.options.map((arm) => arm.shape.kind.value);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const arm of WATCH_ARMS) expect(kinds).toContain(arm.shape.kind.value);
  });

  it("leaves the watch's own language, and so the orchestrator's prompt, exactly as it was", () => {
    // The watch union is a named $def in the orchestrator's schema; it must
    // not grow by an arm for anything a mechanic can do.
    const printed = JSON.stringify(z.toJSONSchema(WatchPredicateSchema, { io: "input" }));
    expect(printed).not.toContain("province_level_above");
    expect(printed).not.toContain("at_war");
    // Twelve: "question_decided" and "letter_answered" were added as watch arms in their own right --
    // "once the Senate gives me the command", "if Syracuse refuses", are things to be woken for.
    expect(WatchPredicateSchema.options).toHaveLength(12);
  });

  it("tests a province by each level it has", () => {
    for (const level of PROVINCE_LEVELS) {
      expect(MechanicPredicateSchema.safeParse({ kind: "province_level_below", provinceId: "x", level, bps: 1 }).success).toBe(true);
    }
  });
});

describe("a rule's fingerprint", () => {
  it("is the same whoever it is bound to, and different when it works differently", () => {
    const elsewhere: MechanicDraft = {
      ...toll,
      conditions: [{ kind: "province_level_above", provinceId: "campania", level: "stability", bps: 2_000 }],
      effects: [{ op: "money_transfer", fromAccountId: "leptines-purse", toAccountId: "syracuse-treasury", amount: { kind: "band", band: "great" } }],
      price: { setup: 900, upkeepPerMonth: 40 },
    };
    expect(stableKey(elsewhere)).toBe(stableKey(toll));
    expect(stableKey({ ...toll, trigger: { kind: "on_fact", factKind: "trade", subjectRef: null } })).not.toBe(stableKey(toll));
    expect(stableKey({ ...toll, end: { kind: "never" } })).not.toBe(stableKey(toll));
    expect(stableKey({ ...toll, effects: [{ op: "legitimacy_shift", polityId: "rome", direction: "raise", band: "slight" }] })).not.toBe(stableKey(toll));
  });
});
