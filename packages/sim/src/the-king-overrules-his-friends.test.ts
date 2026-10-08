import { describe, expect, it } from "vitest";
import { type Character, type WorldState } from "@chronica/shared";
import { consultTheFriends, decideCouncils, stubbornness } from "./bodies";
import { applyDecision, atDay, opening, question } from "./government-test-kit";

/**
 * The king overrules his friends.
 *
 * A king's council only advises. A king who would make war asks his friends first, in his mind: if they would advise against, a heeding king lets it wait and a headstrong one goes
 * on and pays in legitimacy; advice a council has given on a question is taken or overruled by the king by his temper, and the overruling is what `overruleCost` charges for.
 */

const world0 = atDay(opening(), 200);
const hiero = world0.characters.find((c) => c.id === "hieron-ii")!;
const withTemper = (world: WorldState, boldness: number, caution: number, status: number): WorldState => ({
  ...world, characters: world.characters.map((c) => (c.id === "hieron-ii" ? { ...c, mind: { ...c.mind, temperament: { ...c.mind.temperament, boldness, caution }, drives: { ...c.mind.drives, status } } } : c)),
});
/** The friends' council set against every war. */
function friendsAgainst(world: WorldState): WorldState {
  return { ...world, material: { ...world.material, institutions: world.material.institutions.map((i) => (i.id === "syracusan-council" ? { ...i, votingBlocs: i.votingBlocs.map((b) => ({ ...b, baseSupport: -90 })) } : i)) } };
}

describe("the king overrules his friends", () => {
  it("is headstrong or heeding by what he is", () => {
    expect(stubbornness(withTemper(world0, 90, 10, 90).characters.find((c) => c.id === "hieron-ii")!)).toBeGreaterThan(stubbornness(withTemper(world0, 10, 90, 10).characters.find((c) => c.id === "hieron-ii")!));
  });

  it("asks nobody where no council advises, and is not against where the friends would agree", () => {
    expect(consultTheFriends(world0, "rome", hiero as Character, { label: "war be made on Carthage", concerns: ["war"] }, "g")).toBeNull();
    const agreeing = { ...world0, material: { ...world0.material, institutions: world0.material.institutions.map((i) => (i.id === "syracusan-council" ? { ...i, votingBlocs: i.votingBlocs.map((b) => ({ ...b, baseSupport: 90 })) } : i)) } };
    expect(consultTheFriends(agreeing, "syracuse", hiero as Character, { label: "war be made on Carthage", concerns: ["war"] }, "g")).toMatchObject({ against: false, cost: null });
  });

  it("lets the war wait for a heeding king, and charges a headstrong one in legitimacy", () => {
    const meek = consultTheFriends(withTemper(friendsAgainst(world0), 5, 95, 5), "syracuse", hiero as Character, { label: "war be made on Carthage", concerns: ["war"] }, "g1");
    expect(meek).toMatchObject({ against: true });
    const proud = consultTheFriends(withTemper(friendsAgainst(world0), 100, 0, 100), "syracuse", hiero as Character, { label: "war be made on Carthage", concerns: ["war"] }, "g1");
    expect(proud).toMatchObject({ against: true });
    // Over the months, the proud go on more often than the meek.
    const goes = (boldness: number, caution: number, status: number) => [...Array(40).keys()].filter((n) => {
      const w = atDay(withTemper(friendsAgainst(world0), boldness, caution, status), 200 + n * 30);
      return consultTheFriends(w, "syracuse", w.characters.find((c) => c.id === "hieron-ii")!, { label: "war be made on Carthage", concerns: ["war"] }, "g")?.heeds === false;
    }).length;
    expect(goes(100, 0, 100)).toBeGreaterThan(goes(5, 95, 5));
    const costly = [...Array(40).keys()].map((n) => { const w = atDay(withTemper(friendsAgainst(world0), 100, 0, 100), 200 + n * 30); return consultTheFriends(w, "syracuse", w.characters.find((c) => c.id === "hieron-ii")!, { label: "war be made on Carthage", concerns: ["war"] }, "g"); }).find((r) => r?.cost != null)!;
    expect(costly.cost).toMatchObject({ op: "legitimacy_shift", target: "polity", targetId: "syracuse" });
    expect((costly.cost as { legitimacyBpsDelta: number }).legitimacyBpsDelta).toBe(-400);
  });

  it("takes or overrules advice already given on a question: for, he does it; against, by his temper", () => {
    let world = question(world0, { id: "advised-1", bodyId: "syracusan-council", sponsor: "hieron-ii", label: "Motion of Hieron: that the harbour dues be doubled", concerns: ["taxes"], votesOn: 190, subjectId: "syracuse" });
    const advise = (outcome: "passed" | "failed", w: WorldState): WorldState => ({
      ...w, material: {
        ...w.material,
        voteRecords: [...w.material.voteRecords, { id: "vr1", motionId: "advised-1", ballots: [], votes: [], yesWeight: 1, noWeight: 1, abstainWeight: 0, presentWeight: 2, quorumMet: true, thresholdMet: outcome === "passed", outcome, resolvedAtStep: 195 }],
        politicalProcedures: w.material.politicalProcedures.map((p) => (p.id === "advised-1" ? { ...p, stage: "voting_or_deciding" as const, voteRecordId: "vr1", deadlineStep: 225 } : p)),
      },
    });
    const ctx = (w: WorldState) => ({ world: w, gameId: "g", excludedPolityIds: new Set<string>(), playedByModel: new Set<string>(), playerCharacterId: null, rulers: (id: string) => w.characters.filter((c) => c.id === "hieron-ii" && c.polityId === id) });
    const forIt = decideCouncils(ctx(advise("passed", world)));
    expect(forIt).toHaveLength(1);
    expect(forIt[0]!.deltas[0]).toMatchObject({ op: "political_procedure_resolve", outcome: "passed" });
    const proud = decideCouncils(ctx(withTemper(advise("failed", world), 100, 0, 100)));
    const meek = decideCouncils(ctx(withTemper(advise("failed", world), 5, 95, 5)));
    expect(proud[0]!.deltas[0]).toMatchObject({ outcome: expect.stringMatching(/passed|withdrawn/) });
    expect(meek[0]!.deltas[0]).toMatchObject({ outcome: expect.stringMatching(/passed|withdrawn/) });
    // An overruling, applied, costs the power its legitimacy (`overruleCost`).
    const overrule = [...Array(40).keys()].map((n) => decideCouncils({ ...ctx(withTemper(advise("failed", world), 100, 0, 100)), gameId: `g${n}` })[0]!).find((d) => (d.deltas[0] as { outcome: string }).outcome === "passed");
    expect(overrule).toBeDefined();
    const legit = (w: WorldState) => w.material.polityLegitimacy.find((l) => l.polityId === "syracuse")?.legitimacyBps ?? 5_000;
    const done = applyDecision(withTemper(advise("failed", world), 100, 0, 100), overrule!);
    expect(done.rejected).toEqual([]);
    expect(legit(done.world)).toBeLessThan(legit(world));
  });

  it("leaves the king the player is, and the king the model plays, to himself", () => {
    const ctx = (played: boolean, player: string | null) => ({ world: world0, gameId: "g", excludedPolityIds: new Set<string>(), playedByModel: new Set(played ? ["hieron-ii"] : []), playerCharacterId: player, rulers: () => [hiero as Character] });
    expect(decideCouncils(ctx(true, null))).toEqual([]);
    expect(decideCouncils(ctx(false, "hieron-ii"))).toEqual([]);
  });
});
