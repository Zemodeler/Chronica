import { describe, expect, it } from "vitest";
import { PUNIC_IDS } from "@chronica/db";
import { competenceOf, mayAct } from "@chronica/shared";
import { act, atDay, government, holdersOf, opening, rateOf, taxSet } from "./competence-test-kit";

/**
 * A tribune stops a levy, and a colleague stops a consul's tribute.
 *
 * The tribune holds no charge of the state's money: every act of the twelve is forbidden him. What he holds is the right to
 * stand in the way of a magistrate's, inside the city, and that is in his competence as the acts he may stop. A consul's
 * colleague may stop what the consul does as a tribune does (*par potestas*), wherever he is.
 */

const levy = (consul: string) => ({
  op: "force_create", localId: "legio", name: "A third legion", polityId: "rome", commanderCharacterRef: consul, controllerCharacterRef: consul,
  locationId: PUNIC_IDS.rome, authorizedStrength: 4_000, reason: "War.",
});
const intercession = (owner: string, against: string, what: string) => ({
  op: "generic_entity_create", localId: "veto", kind: "intercession", label: `A word against the ${what}`, ownerRef: { kind: "character", id: owner },
  attributes: { against, act: what }, reason: "The plebs have given enough.",
});

describe("a tribune stops a levy", () => {
  it("reads as the tribune's competence: nothing of the twelve is his to do, and the levy and the purse are his to stop", () => {
    const world = opening();
    const tribune = competenceOf(world, "roman-tribune", government.offices)!;
    expect(Object.values(tribune.acts).every((line) => line.grade === "forbidden")).toBe(true);
    expect(tribune.mayStop).toEqual(expect.arrayContaining(["levy", "spending", "tax_rate", "coinage"]));
    const [man] = holdersOf(world, "roman-tribune");
    expect(mayAct(world, man!, "levy", { offices: government.offices })).toMatchObject({ grade: "forbidden", stops: true });
    // The consul holds the levy with his colleague.
    expect(competenceOf(world, "roman-consul", government.offices)!.acts.levy.grade).toBe("with_colleague");
  });

  it("forbids the consul's levy in the city while his word stands, and lifts when he retires it", () => {
    const world = opening();
    const [consul] = holdersOf(world, "roman-consul") as [string, string];
    const [tribune] = holdersOf(world, "roman-tribune") as [string];
    const made = act(world, tribune, intercession(tribune, consul, "levy"));
    expect(made.applied[0]?.authority.authorized).toBe(true);
    const blocked = act(made.world, consul, levy(consul));
    expect(blocked.applied).toHaveLength(0);
    expect(blocked.rejected[0]!.reason).toMatch(/as Tribune of the plebs, has interceded against .*'s levy/);
    const entity = made.assignedIds.get("veto")!;
    const lifted = act(made.world, tribune, { op: "generic_entity_update", entityRef: entity, retire: true, reason: "He relents." });
    expect(act(lifted.world, consul, levy(consul)).applied).toHaveLength(1);
  });

  it("stops the consul's tribute too, and so does his colleague, as one of two of equal power", () => {
    const world = opening();
    const [first, second] = holdersOf(world, "roman-consul") as [string, string];
    const [tribune] = holdersOf(world, "roman-tribune") as [string];
    const byTribune = act(world, tribune, intercession(tribune, first, "tax"));
    const stopped = act(byTribune.world, first, taxSet("rome", 1_100));
    expect(stopped.applied).toHaveLength(0);
    expect(stopped.rejected[0]!.reason).toMatch(/as Tribune of the plebs, has interceded against .*'s tribute and coin/);

    const byColleague = act(world, second, intercession(second, first, "tax"));
    expect(byColleague.applied).toHaveLength(1);
    const stoppedByHim = act(byColleague.world, first, taxSet("rome", 1_100));
    expect(stoppedByHim.applied).toHaveLength(0);
    expect(stoppedByHim.rejected[0]!.reason).toMatch(/his colleague as Roman consul, has interceded against .*: what one of two of equal power does, the other may stop/);
    // And the colleague's own acts are not touched by it.
    expect(rateOf(act(atDay(byColleague.world, 205), second, taxSet("rome", 1_050)).world, "rome")).toBe(1_050);
  });
});
