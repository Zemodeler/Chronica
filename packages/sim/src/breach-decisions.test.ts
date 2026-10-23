import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { BREACH_COOLDOWN_DAYS, answerBreach, breachDecision, isGrandBreach } from "./breach-decisions";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const PLAYER = "gaius-genucius";
/** A ranking Roman who is not the player: a consul's colleague. */
const COLLEAGUE = "gnaeus-cornelius";
const delta = (body: Record<string, unknown>) => WorldDeltaSchema.parse(body);

describe("which acts beyond leave are big enough to put to the player", () => {
  // Plan item 5: big things only.
  it("is a ranking man committing an army of consequence, or spending at treasury scale", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const move = delta({ op: "force_modify", forceRef: legion.id, locationId: legion.locationId, reason: "Moved." });
    expect(isGrandBreach(state, move, COLLEAGUE, "rome")).toBe(true);
    const treasury = state.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === "rome").reduce((sum, account) => sum + account.balance, 0);
    const purse = state.material.accounts.find((account) => account.owner.kind === "character")!;
    const big = delta({ op: "money_transfer", fromAccountRef: state.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id, toAccountRef: purse.id, amount: Math.ceil(treasury * 0.2), reason: "Spent." });
    const small = delta({ op: "money_transfer", fromAccountRef: state.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id, toAccountRef: purse.id, amount: 5, reason: "Spent." });
    expect(isGrandBreach(state, big, COLLEAGUE, "rome")).toBe(true);
    expect(isGrandBreach(state, small, COLLEAGUE, "rome")).toBe(false);
  });

  it("is never a man of no rank, whatever he does", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const move = delta({ op: "force_modify", forceRef: legion.id, locationId: legion.locationId, reason: "Moved." });
    const nobody = state.characters.find((character) => character.alive && character.polityId === "rome"
      && !state.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held")
      && !state.material.forces.some((force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id))!;
    expect(isGrandBreach(state, move, nobody.id, "rome")).toBe(false);
  });

  it("is not a small detachment, even of a ranking man", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const tiny: WorldState = { ...state, material: { ...state.material, forces: state.material.forces.map((force) => force.id === legion.id ? { ...force, personnel: [{ categoryId: "infantry", label: "Men", fit: 200, unavailable: [] }] } : force) } };
    expect(isGrandBreach(tiny, delta({ op: "force_modify", forceRef: legion.id, locationId: legion.locationId, reason: "Moved." }), COLLEAGUE, "rome")).toBe(false);
  });
});

describe("the decision and the answer", () => {
  const entry = (change: Record<string, unknown> = {}) => ({ characterId: COLLEAGUE, polityId: "rome", kind: "breach" as const, label: "Gnaeus Cornelius moved the legion without leave.", atStep: 40, weight: 1, grand: true, ...change });
  const waiting = (change: Record<string, unknown> = {}): WorldState => ({ ...world(), elapsedStep: 50, answerable: [entry(change)] });

  it("is put to the player only for a big breach waiting on him, with the three answers", () => {
    const decision = breachDecision(waiting(), PLAYER)!;
    expect(decision.options.map((option) => option.id)).toEqual(["breach-censure", "breach-endorse", "breach-ignore"]);
    expect(decision.prompt).toContain("without your leave");
    expect(breachDecision({ ...world(), answerable: [entry({ grand: undefined })] }, PLAYER)).toBeUndefined();
    expect(breachDecision(waiting(), null)).toBeUndefined();
  });

  it("waits out a month after the last one, so a run of breaches cannot hold him in prompts", () => {
    const recentlyAnswered = { ...waiting(), answerable: [entry({ grand: false, atStep: 45 }), entry({ atStep: 49 })] };
    expect(breachDecision(recentlyAnswered, PLAYER)).toBeUndefined();
    expect(breachDecision({ ...recentlyAnswered, elapsedStep: 45 + BREACH_COOLDOWN_DAYS }, PLAYER)).toBeDefined();
  });

  it("censure keeps it on his record, a little heavier, and he holds it against the player", () => {
    const { world: after, facts } = answerBreach(waiting(), PLAYER, "breach-censure", 50);
    expect(after.answerable).toHaveLength(1);
    expect(after.answerable[0]).toMatchObject({ grand: false, weight: 2 });
    const held = after.characters.find((character) => character.id === COLLEAGUE)!.relations.find((relation) => relation.subjectCharacterId === PLAYER)!;
    expect(held.causes.at(-1)!.score).toBeLessThan(0);
    expect(facts[0]!.kind).toBe("subordinate_censured");
    expect(breachDecision(after, PLAYER)).toBeUndefined();
  });

  it("endorsing clears it from his record, and he is grateful", () => {
    const { world: after, facts } = answerBreach(waiting(), PLAYER, "breach-endorse", 50);
    expect(after.answerable).toHaveLength(0);
    expect(after.characters.find((character) => character.id === COLLEAGUE)!.relations.find((relation) => relation.subjectCharacterId === PLAYER)!.causes.at(-1)!.score).toBeGreaterThan(0);
    expect(facts[0]!.kind).toBe("subordinate_endorsed");
  });

  it("letting it pass, or giving an order instead, closes the question and leaves the record as it was", () => {
    for (const answered of ["breach-ignore", null, "something-else"]) {
      const { world: after, facts } = answerBreach(waiting(), PLAYER, answered, 50);
      expect(facts).toEqual([]);
      expect(after.answerable[0]).toMatchObject({ grand: false, weight: 1 });
      expect(breachDecision(after, PLAYER)).toBeUndefined();
    }
  });
});
