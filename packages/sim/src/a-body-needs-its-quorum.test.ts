import { describe, expect, it } from "vitest";
import { type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { blocLeanings, countVote } from "./senate";
import { absenceFrom, awayFromTheCity, MOST_AWAY_SHARE, seatIsEmpty, underArmsShare } from "./quorum";
import { atDay, opening } from "./government-test-kit";

/**
 * A body needs its quorum.
 *
 * A member of a chamber who leads an army in the field, or stands in another power's country, is not in his seat: his vote is not counted, and a chamber whose
 * present members fall short of its quorum cannot decide ("could not muster a quorum"). An assembly of the people is thinned by the share of its men under arms.
 */
const sketch = (senate: string, id = "quorum-test"): PoliticalProcedure => ({
  id, type: "council_deliberation", institutionId: senate, sponsorCharacterId: "gaius-genucius", subjectKind: "polity", subjectId: "rome", label: "Motion of Gaius Genucius: that the tribute be laid anew",
  eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: 200, deadlineStep: 220, resolvedAtStep: null, visibility: "public",
  voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: ["taxes"],
} as PoliticalProcedure);

/** The first `count` named senators put at the head of an army in a province of Rome that is not the city's. */
function sendOut(world: WorldState, count: number): { world: WorldState; sent: string[] } {
  const senate = world.material.institutions.find((i) => i.id === "roman-senate")!;
  const capital = world.map.polities.find((p) => p.id === "rome")!.capitalSettlementId;
  const city = world.map.provinces.find((p) => p.settlements.some((s) => s.id === capital))!.id;
  const field = world.map.provinces.find((p) => p.controllerPolityId === "rome" && p.id !== city)!.id;
  const template = world.material.forces.find((f) => f.polityId === "rome")!;
  const sitting = world.material.officeSeats.filter((s) => s.officeId === "roman-senator" && s.status === "held").map((s) => s.holderCharacterId!).filter((id) => world.characters.some((c) => c.id === id && c.alive));
  const sent = sitting.slice(0, count);
  const forces = sent.map((id, n) => ({ ...template, id: `army-abroad-${n}`, name: `An army abroad ${n}`, polityId: "rome", commanderCharacterId: id, controllerCharacterId: id, locationId: field }));
  void senate;
  return { world: { ...world, material: { ...world.material, forces: [...world.material.forces.filter((f) => !sent.includes(f.commanderCharacterId)), ...forces] } }, sent };
}

describe("a body needs its quorum", () => {
  const world = atDay(opening(200), 200);
  const senate = world.material.institutions.find((i) => i.id === "roman-senate")!;
  const present = (w: WorldState, institution = senate) => countVote("v", sketch(institution.id), institution, blocLeanings(w, sketch(institution.id), institution), 200);

  it("counts every member when nobody is away", () => {
    const base = world.material.forces.filter((f) => f.polityId === "rome").length;
    expect(base).toBeGreaterThanOrEqual(0);
    const all = present({ ...world, material: { ...world.material, forces: [] } });
    expect(all.presentWeight).toBe(senate.totalVotingWeight);
  });

  it("leaves the empty seats of the men who are with the armies out of the count", () => {
    const { world: out, sent } = sendOut(world, 12);
    expect(sent.length).toBe(12);
    expect([...awayFromTheCity(out, "rome")]).toEqual(expect.arrayContaining(sent));
    const record = present(out);
    const full = present({ ...world, material: { ...world.material, forces: [] } });
    expect(record.presentWeight).toBeLessThan(full.presentWeight);
    expect(full.presentWeight - record.presentWeight).toBeGreaterThanOrEqual(sent.length - 1);
    const ballots = (record.ballots ?? []).map((b) => b.characterId);
    for (const id of sent) expect(ballots).not.toContain(id);
  });

  it("cannot decide when too many are away: no quorum, and the question falls", () => {
    const { world: out } = sendOut(world, 40);
    const strict = { ...senate, quorumBps: 9_900 };
    const record = countVote("v", sketch(strict.id), strict, blocLeanings(out, sketch(strict.id), strict), 200);
    expect(record.quorumMet).toBe(false);
    expect(record.outcome).toBe("failed");
    // With none away, the same chamber has its quorum.
    const home = countVote("v", sketch(strict.id), strict, blocLeanings({ ...world, material: { ...world.material, forces: [] } }, sketch(strict.id), strict), 200);
    expect(home.quorumMet).toBe(true);
  });

  it("counts a man who stands in another power's country as away, and not one at the city", () => {
    const man = world.characters.find((c) => c.alive && c.polityId === "rome" && world.material.officeSeats.some((s) => s.officeId === "roman-senator" && s.holderCharacterId === c.id) && !world.material.forces.some((f) => f.commanderCharacterId === c.id || f.controllerCharacterId === c.id))!;
    const foreign = world.map.provinces.find((p) => p.controllerPolityId === "carthage")!.id;
    const abroad = { ...world, characters: world.characters.map((c) => (c.id === man.id ? { ...c, locationProvinceId: foreign } : c)) };
    expect(awayFromTheCity(abroad, "rome").has(man.id)).toBe(true);
    const capital = world.map.polities.find((p) => p.id === "rome")!.capitalSettlementId;
    const city = world.map.provinces.find((p) => p.settlements.some((s) => s.id === capital))!.id;
    const atHome = { ...world, characters: world.characters.map((c) => (c.id === man.id ? { ...c, locationProvinceId: city } : c)) };
    expect(awayFromTheCity(atHome, "rome").has(man.id)).toBe(false);
  });

  it("thins an assembly of the people by the share of its men under arms, never past the most", () => {
    const { world: out } = sendOut(world, 30);
    const big = { ...out, material: { ...out.material, forces: out.material.forces.map((f) => (f.id.startsWith("army-abroad") ? { ...f, personnel: f.personnel.map((p) => ({ ...p, fit: p.fit * 400 })) } : f)) } };
    const share = underArmsShare(big, "rome");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(MOST_AWAY_SHARE);
    const assembly = world.material.institutions.find((i) => i.id === "roman-comitia-centuriata")!;
    const absence = absenceFrom(big, assembly);
    const empty = Array.from({ length: 400 }, (_, n) => seatIsEmpty(absence, { id: `${assembly.id}:seat-${n}`, characterId: null }, "q")).filter(Boolean).length;
    expect(empty).toBeGreaterThan(0);
    expect(empty / 400).toBeLessThanOrEqual(MOST_AWAY_SHARE + 0.08);
    // The Senate's unnamed seats are not an assembly's: only its named men can be away.
    expect(absenceFrom(big, senate).unnamedShare).toBe(0);
  });

  it("is the same on every run", () => {
    const { world: out } = sendOut(world, 12);
    expect(JSON.stringify(present(out))).toBe(JSON.stringify(present(structuredClone(out))));
  });
});
