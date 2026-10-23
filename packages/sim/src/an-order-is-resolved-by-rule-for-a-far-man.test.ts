import { describe, expect, it } from "vitest";
import { OrderAttemptSchema, type OrderAttempt, type WorldState } from "@chronica/shared";
import { playerInterests } from "./cognition-policy";
import { routeAmbientActors } from "./attention";
import { DELAY_DAYS, answerOrdersByRule, orderTemperOf } from "./order-by-rule";
import { createIdFactory } from "./ports";
import { definition, government, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";

/**
 * An order is resolved by rule for a far man (the user's rule, 2026-10-08).
 *
 * The player's order put to a man who is not of the cast (not the nemesis, not a friend with a plot, not a man near him with a plot of his own) is not a reason to ask
 * the model about him: he answers by his temper, at once, and what the order asks is carried out by the engine. A cast recipient is still the model's.
 */

const PLAYER = "gaius-genucius";
const world0 = (): WorldState => withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage");

function farMan(world: WorldState, wanted: "keeps" | "delays"): string {
  const player = world.characters.find((character) => character.id === PLAYER)!;
  const found = world.characters.find((character) => character.alive && character.id !== PLAYER && character.polityId !== player.polityId
    && !world.material.forces.some((force) => force.commanderCharacterId === character.id) && orderTemperOf(character) === wanted);
  return found!.id;
}

/** The man made, by his temper, one who keeps or one who delays. */
function withTemper(world: WorldState, id: string, temper: "keeps" | "delays"): WorldState {
  return { ...world, characters: world.characters.map((character) => (character.id !== id ? character : {
    ...character, mind: { ...character.mind,
      temperament: { ...character.mind.temperament, honesty: temper === "keeps" ? 75 : 50, caution: temper === "keeps" ? 40 : 80 },
      drives: { ...character.mind.drives, duty: temper === "keeps" ? 80 : 40 } } })) };
}

function ordered(world: WorldState, recipientId: string, ask: OrderAttempt["ask"], instruction = "Do this for me."): WorldState {
  const attempt = OrderAttemptSchema.parse({
    id: "order-far-1", actionId: "action-far-1", issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: recipientId },
    claimedAuthorityGrantId: null, authorityCheck: { authorized: false, grant: null, standing: null, reason: "" }, instruction, standing: "binding",
    status: "issued", recipientDecisionReason: null, issuedAtStep: world.elapsedStep, decidedAtStep: null, consequenceFactRefs: [], servesRef: null,
    ...(ask === undefined ? {} : { ask }), answerDueByStep: world.elapsedStep + 7,
  });
  return { ...world, orderAttempts: [...world.orderAttempts, attempt] };
}

const rules = () => ({ toDay: 150, offices: government.offices, ids: createIdFactory("by-rule"), playerCharacterId: PLAYER, rules: { warfare: definition.warfare, terrains: definition.map.terrains, gameId: "by-rule" } });
const statusOf = (world: WorldState): OrderAttempt["status"] => world.orderAttempts.find((attempt) => attempt.id === "order-far-1")!.status;

describe("an order is resolved by rule for a far man", () => {
  it("answers at once, by his temper, with no call: the man who keeps his word does it", () => {
    const base = world0();
    const id = farMan(base, "keeps");
    const world = ordered(withTemper(base, id, "keeps"), id, { kind: "other" }, "Keep the road to the sea open.");
    const done = answerOrdersByRule(world, { ...rules(), castIds: new Set(), issuerId: PLAYER });
    expect(done.answered).toEqual(["order-far-1"]);
    expect(["accepted", "carried_out"]).toContain(statusOf(done.world));
    // The player is told, in a line he reads.
    expect(done.facts.some((fact) => /request_/.test(fact.kind) && fact.knownToRefs?.some((ref) => ref.id === PLAYER))).toBe(true);
  });

  it("puts a cautious man's order off for a week, and then does it", () => {
    const base = world0();
    const id = farMan(base, "delays");
    const world = ordered(withTemper(base, id, "delays"), id, { kind: "other" }, "Keep the road to the sea open.");
    expect(orderTemperOf(world.characters.find((character) => character.id === id)!)).toBe("delays");
    const first = answerOrdersByRule(world, { ...rules(), castIds: new Set(), issuerId: PLAYER });
    expect(first.delayed).toEqual(["order-far-1"]);
    expect(statusOf(first.world)).toBe("delayed");
    // Not before the week is out.
    const early = answerOrdersByRule(first.world, { ...rules(), toDay: 150 + DELAY_DAYS - 1, castIds: new Set(), issuerId: PLAYER });
    expect(early.answered).toEqual([]);
    expect(statusOf(early.world)).toBe("delayed");
    const later = answerOrdersByRule(first.world, { ...rules(), toDay: 150 + DELAY_DAYS, castIds: new Set(), issuerId: PLAYER });
    expect(later.answered).toEqual(["order-far-1"]);
    expect(["accepted", "carried_out"]).toContain(statusOf(later.world));
  });

  it("refuses by rule what is not his to give, and says why", () => {
    const base = world0();
    const id = farMan(base, "keeps");
    const world = ordered(withTemper(base, id, "keeps"), id, { kind: "appoint_to_post", ref: "legate" }, "Make my friend a legate.");
    const done = answerOrdersByRule(world, { ...rules(), castIds: new Set(), issuerId: PLAYER });
    expect(statusOf(done.world)).toBe("refused");
    expect(done.facts.map((fact) => fact.summary).join(" ")).toMatch(/not his to give|serves in no army|would not/);
  });

  it("leaves the cast to the model: a cast recipient's order is not answered here", () => {
    const base = world0();
    const id = farMan(base, "keeps");
    const world = ordered(withTemper(base, id, "keeps"), id, { kind: "other" });
    const done = answerOrdersByRule(world, { ...rules(), castIds: new Set([id]), issuerId: PLAYER });
    expect(done.answered).toEqual([]);
    expect(statusOf(done.world)).toBe("issued");
  });

  it("takes a far man's order out of the router's scoring, and keeps a cast man's in", () => {
    const base = world0();
    const id = farMan(base, "keeps");
    const world = ordered(withTemper(base, id, "keeps"), id, { kind: "other" });
    const eligible = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
    const scoreOf = (castIds: ReadonlySet<string> | undefined): number | undefined => routeAmbientActors({ world, cognitionEligible: eligible, facts: [], offices: government.offices, excludeCharacterIds: [PLAYER], max: 900,
      ...(castIds === undefined ? {} : { castIds }) }).find((actor) => actor.characterId === id)?.score;
    const legacy = scoreOf(undefined)!;
    const far = scoreOf(new Set())!;
    const cast = scoreOf(new Set([id]))!;
    expect(legacy - far).toBe(32);
    expect(cast).toBe(legacy);
  });

  it("is never the model who is asked about him in a burst, and is the same every time", () => {
    const base = world0();
    const id = farMan(base, "keeps");
    const world = ordered(withTemper(base, id, "keeps"), id, { kind: "other" });
    const interests = playerInterests(world, PLAYER, government.offices);
    // He holds an order of the player's, so he is of the circle; the order is answered for him all the same.
    expect(interests.detailOf(id)).toBe("personal");
    const a = JSON.stringify(answerOrdersByRule(world, { ...rules(), castIds: new Set(), issuerId: PLAYER }).world);
    const b = JSON.stringify(answerOrdersByRule(world, { ...rules(), castIds: new Set(), issuerId: PLAYER }).world);
    expect(a).toBe(b);
  });
});
