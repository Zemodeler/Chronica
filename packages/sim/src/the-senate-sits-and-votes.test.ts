import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { BACKLOG_MAX, agendaOf, backlogOf, bodyHasRoom, cityIsOpen, keepTheBodies, sitTheBodies } from "./bodies";
import { holdVotes } from "./senate";
import { createIdFactory } from "./ports";
import { atDay, government, holdersOfOffice, opening, question } from "./government-test-kit";

/**
 * The Senate sits and votes.
 *
 * A chamber puts only so many questions on a sitting (the Senate five, an assembly two); what is due beyond it waits a month; a chamber whose city is shut does not sit; a
 * chamber holds only so many questions open at once. What is put is counted by its blocs and carried or rejected, as it always was.
 */

const day = 200;
function senateWith(count: number, concerns: readonly string[] = ["taxes"]): WorldState {
  let world = atDay(opening(), day);
  const sponsor = holdersOfOffice(world, "roman-consul")[0]!;
  for (let n = 0; n < count; n += 1) world = question(world, { id: `q${n}`, bodyId: "roman-senate", sponsor, label: `Motion of a consul: that matter ${n} be settled`, concerns, openedAt: 100 + n, votesOn: day - 1 });
  return world;
}
const open = (world: WorldState, bodyId = "roman-senate") => world.material.politicalProcedures.filter((p) => p.institutionId === bodyId && p.outcome === null && p.stage !== "resolved");
const input = (world: WorldState) => ({ world, offices: government.offices, successionRules: government.successionRules, toDay: day });

describe("the Senate sits and votes", () => {
  it("puts five questions to a sitting and the oldest first, and puts the rest off a month", () => {
    const world = senateWith(8);
    expect(agendaOf(world.material.institutions.find((i) => i.id === "roman-senate")!)).toBe(5);
    expect(agendaOf(world.material.institutions.find((i) => i.id === "roman-comitia-centuriata")!)).toBe(2);
    const sat = sitTheBodies(input(world));
    const late = open(sat.world).filter((p) => (p.deadlineStep ?? 0) > day);
    expect(late.map((p) => p.id)).toEqual(["q5", "q6", "q7"]);
    expect(late.every((p) => p.deadlineStep === day + 30)).toBe(true);
    expect(sat.facts.length).toBeLessThanOrEqual(1);
  });

  it("counts what is put, and carries or rejects it by its blocs", () => {
    const sat = keepTheBodies(input(senateWith(7)));
    const voted = holdVotes({ ...input(sat.world), ids: createIdFactory("senate-sits") });
    const settled = voted.world.material.politicalProcedures.filter((p) => p.outcome !== null);
    expect(settled.length).toBeGreaterThanOrEqual(1);
    expect(settled.length).toBeLessThanOrEqual(5);
    expect(voted.world.material.voteRecords.length).toBeGreaterThanOrEqual(1);
    // The two that wait are still open for the next sitting.
    expect(open(voted.world).filter((p) => (p.deadlineStep ?? 0) >= day + 30).length).toBeGreaterThanOrEqual(2);
  });

  it("does not sit with its city shut: the questions wait", () => {
    const world = senateWith(2);
    const capital = world.map.polities.find((p) => p.id === "rome")!.capitalSettlementId;
    const province = world.map.provinces.find((p) => p.settlements.some((s) => s.id === capital))!;
    const taken: WorldState = { ...world, map: { ...world.map, provinces: world.map.provinces.map((p) => (p.id === province.id ? { ...p, controllerPolityId: "carthage" } : p)) } };
    expect(cityIsOpen(world, "rome")).toBe(true);
    expect(cityIsOpen(taken, "rome")).toBe(false);
    const sat = sitTheBodies(input(taken));
    expect(open(sat.world).every((p) => p.deadlineStep === day + 30)).toBe(true);
  });

  it("holds only so many questions open at once", () => {
    const world = senateWith(BACKLOG_MAX - 1);
    expect(backlogOf(world, "roman-senate")).toBe(BACKLOG_MAX - 1);
    expect(bodyHasRoom(world, "roman-senate")).toBe(true);
    expect(bodyHasRoom(senateWith(BACKLOG_MAX), "roman-senate")).toBe(false);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(keepTheBodies(input(senateWith(7))).world.material.politicalProcedures);
    const b = JSON.stringify(keepTheBodies(input(senateWith(7))).world.material.politicalProcedures);
    expect(a).toBe(b);
  });
});
