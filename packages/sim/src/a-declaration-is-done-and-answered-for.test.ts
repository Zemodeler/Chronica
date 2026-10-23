import { describe, expect, it } from "vitest";
import { computeOpinion, WorldDeltaSchema, atWar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { as, chestOf, holdersOf, opening } from "./competence-test-kit";
import { USURPATION_YEAR_DAYS, usurpedLately } from "./usurpation";

/**
 * A declaration is done, and answered for (the user's rule, 2026-10-08): "If the player says 'propose to declare war' the Senate votes; if he says 'I declare war'
 * the engine takes the consequences of that action: he said it, it happened."
 *
 * A consul who says he declares war on Carthage has done it: it stands, with no vote. The republic answers him for it by rule: the state's standing falls, the
 * Senate's blocs and its senators think the less of him, his colleague's gens and his own are at feud, the tribunes are his enemies, there is a charge for him to
 * answer when his office ends, the Senate's purse is shut to him and his command will not be prorogued, and the city's order suffers.
 */

const [CONSUL, COLLEAGUE] = holdersOf(opening(), "roman-consul") as [string, string];
const war = (against = "carthage") => WorldDeltaSchema.parse({ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: against, terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage must answer." });
/** The consul says he does it. */
function declare(world: WorldState, who = CONSUL, delta = war()) {
  return applyDeltas(world, [delta], { ...as(who, world.elapsedStep, [delta]), declaredDeltas: new Set([delta]) });
}
const legitimacy = (world: WorldState): number => world.material.polityLegitimacy.find((entry) => entry.polityId === "rome")?.legitimacyBps ?? 5_000;
const warWithCarthage = (world: WorldState): boolean => atWar(world.polityAgreements, "rome", "carthage");

describe("a declaration is done, and answered for", () => {
  it("is carried out at once by a consul, with no vote: the war exists", () => {
    const world = opening();
    expect(warWithCarthage(world)).toBe(false);
    const done = declare(world);
    expect(done.rejected).toEqual([]);
    expect(warWithCarthage(done.world)).toBe(true);
    // No motion was moved: nobody was asked.
    expect(done.world.material.politicalProcedures.length).toBe(world.material.politicalProcedures.length);
    expect(done.factProposals.map((fact) => fact.kind)).toContain("act_usurped");
    expect(done.factProposals.find((fact) => fact.kind === "act_usurped")!.summary).toMatch(/without the Roman Senate|without the Senate/);
  });

  it("costs the state its standing, the senators their good opinion, and the gentes their peace", () => {
    const world = opening();
    const done = declare(world).world;
    expect(legitimacy(done)).toBeLessThan(legitimacy(world));
    // The senators think worse of him than before.
    const senators = world.characters.filter((character) => character.alive && character.polityId === "rome" && character.officeId !== null && character.id !== CONSUL).slice(0, 12);
    expect(senators.length).toBeGreaterThan(3);
    const worse = senators.filter((senator) => computeOpinion(done.characters.find((character) => character.id === senator.id)!, CONSUL) < computeOpinion(senator, CONSUL));
    expect(worse.length).toBeGreaterThanOrEqual(Math.ceil(senators.length / 2));
    // His colleague, above all.
    expect(computeOpinion(done.characters.find((character) => character.id === COLLEAGUE)!, CONSUL)).toBeLessThan(computeOpinion(world.characters.find((character) => character.id === COLLEAGUE)!, CONSUL));
    // His colleague's gens feuds with his own.
    const theirs = done.gentes.find((gens) => gens.id === "gens-cornelius")!;
    expect(theirs.feuds.find((feud) => feud.againstGensId === "gens-genucius")?.intensityBps ?? 0).toBeGreaterThan(0);
    // The chamber's blocs carry the memory of it.
    const senate = done.material.institutions.find((institution) => institution.id === "roman-senate")!;
    expect(senate.votingBlocs.every((bloc) => bloc.causes.some((cause) => cause.sourceId === CONSUL && cause.score < 0))).toBe(true);
  });

  it("leaves a charge to answer, shuts the Senate's purse and denies the prorogation", () => {
    const world = opening();
    const done = declare(world).world;
    const mark = done.answerable.find((entry) => entry.characterId === CONSUL && entry.kind === "usurpation");
    expect(mark).toBeDefined();
    expect(mark!.weight).toBeGreaterThanOrEqual(3);
    expect(usurpedLately(done, CONSUL)).toBe(true);
    expect(usurpedLately({ ...done, elapsedStep: done.elapsedStep + USURPATION_YEAR_DAYS + 1 }, CONSUL)).toBe(false);
    // The Senate gives him nothing for the war it did not make: even his own allowance is not drawn on the public chest.
    const before = chestOf(done, "rome").balance;
    const draw = WorldDeltaSchema.parse({ op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 1_000, reason: "Silver for the war." });
    const refused = applyDeltas(done, [draw], as(CONSUL, done.elapsedStep, [draw]));
    expect(refused.applied).toHaveLength(0);
    expect(refused.rejected[0]!.reason).toMatch(/will not open the public chest/);
    expect(chestOf(refused.world, "rome").balance).toBe(before);
    // And the same draw, before he declared, was his to make.
    const free = applyDeltas(world, [draw], as(CONSUL, world.elapsedStep, [draw]));
    expect(free.applied).toHaveLength(1);
  });

  it("takes the act's own weight: war and an alliance cost more than a pact of trade", () => {
    const world = opening();
    const pact = (kind: string) => WorldDeltaSchema.parse({ op: "agreement_open", localId: kind, kind, polityId: "rome", otherPolityId: "syracuse", terms: "A pact.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Friends." });
    const allied = declare(world, CONSUL, pact("alliance")).world;
    const warred = declare(world).world;
    const traded = declare(world, CONSUL, pact("trade_pact")).world;
    expect(allied.answerable.some((entry) => entry.kind === "usurpation")).toBe(true);
    const loss = (after: WorldState): number => legitimacy(world) - legitimacy(after);
    expect(loss(warred)).toBeGreaterThan(loss(traded));
    expect(loss(allied)).toBeGreaterThan(loss(traded));
  });

  it("is the same every time", () => {
    const a = JSON.stringify(declare(opening()).world);
    const b = JSON.stringify(declare(opening()).world);
    expect(a).toBe(b);
  });
});
