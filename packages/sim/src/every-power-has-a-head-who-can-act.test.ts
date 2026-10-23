import { describe, expect, it } from "vitest";
import { allOffices, chargeHolders, competenceOf, isOwnToDo, type ActKind, type WorldState } from "@chronica/shared";
import { government, holdersOf, opening } from "./competence-test-kit";

/**
 * Every power has a head who can act.
 *
 * Whatever its form, a power that holds ground has somebody seated in the office its constitution names as its head, and that man's charge covers the acts a ruler must hold:
 * war and peace and the treaties (his own, or his to move in the chamber that holds them), the levy, the naming of men and the chest. And no power has a fiscal act with
 * nobody to decide it: for each of the acts of the purse some office of the power may do it (alone or with a colleague), or the power has a chamber that holds it and some
 * office may move it there.
 */

const RULERS_ACTS: readonly ActKind[] = ["war", "peace", "pacts", "levy", "appointment", "spending"];
const FISCAL_ACTS: readonly ActKind[] = ["tax_rate", "customs", "coinage", "loans", "grain", "spending"];

/** Whether the power keeps a chest at all: a people with no treasury has nothing to draw on, and nobody to be told he may not. */
const hasChest = (world: WorldState, polityId: string): boolean => world.material.accounts.some((account) => account.owner.kind === "polity" && account.owner.id === polityId);

/** The powers that hold ground and were given a government: the ones a game can be played in. */
function powers(world: WorldState) {
  const holding = new Set(world.map.provinces.map((province) => province.controllerPolityId).filter((id): id is string => id !== null));
  return world.constitutions.filter((record) => holding.has(record.polityId) && world.map.polities.find((polity) => polity.id === record.polityId)?.endedAtStep == null);
}

describe("every power has a head who can act", () => {
  const world = opening();
  const everyOffice = allOffices(world, government.offices);

  it("seats a living man in the office each constitution names as its head", () => {
    const records = powers(world);
    expect(records.length).toBeGreaterThan(60);
    const without = records.filter((record) => {
      if (record.rulerOfficeId === null || !everyOffice.some((office) => office.id === record.rulerOfficeId)) return true;
      return !holdersOf(world, record.rulerOfficeId).some((id) => world.characters.some((character) => character.id === id && character.alive));
    }).map((record) => `${record.polityId} (${record.rulerOfficeId})`);
    expect(without).toEqual([]);
  });

  it("gives the head a charge over every act a ruler must hold: his own, or his to move in the chamber that holds it", () => {
    const stuck = powers(world).flatMap((record) => {
      const competence = competenceOf(world, record.rulerOfficeId!, government.offices);
      if (competence === null) return [`${record.polityId}: no competence for ${record.rulerOfficeId}`];
      return RULERS_ACTS.filter((act) => {
        const line = competence.acts[act];
        // A power bound to a leader by the foedus leaves its war and its peace to the leader (`competence.ts`): that is a charge somewhere else, not none.
        const bound = (act === "war" || act === "peace") && world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.polityId === record.polityId);
        return !bound && !(act === "spending" && !hasChest(world, record.polityId)) && line.grade === "forbidden";
      }).map((act) => `${record.polityId}: ${record.rulerOfficeId} may not ${act}`);
    });
    expect(stuck).toEqual([]);
  });

  it("has somebody to decide every act of the purse: an office that may do it, or a chamber that holds it and an office that may move it there", () => {
    const undecided = powers(world).flatMap((record) => {
      const offices = everyOffice.filter((office) => office.polityId === record.polityId && office.successionRuleId !== "abolished");
      const readings = offices.map((office) => competenceOf(world, office.id, government.offices)).filter((reading): reading is NonNullable<typeof reading> => reading !== null);
      return FISCAL_ACTS.filter((act) => {
        if (act === "spending" && !hasChest(world, record.polityId)) return false;
        // A tribal people has no standing tax and no loans by its form (the research); the stand-in "ruler" the scenario wrote beside its chief used to hide that, and is reformed away.
        if (record.form === "tribal_confederation" && (act === "tax_rate" || act === "loans")) return false;
        const owns = readings.some((reading) => isOwnToDo(reading.acts[act].grade));
        const moves = readings.some((reading) => reading.acts[act].grade === "by_the_body" && reading.acts[act].body !== null);
        return !owns && !moves;
      }).map((act) => `${record.polityId}: nobody decides ${act}`);
    });
    expect(undecided).toEqual([]);
  });

  it("has a living man seated to decide each act of the purse and each treaty act: not an office with an empty seat", () => {
    const seated = (polityId: string, act: ActKind): boolean => world.material.officeSeats.some((seat) => {
      if (seat.status !== "held" || seat.holderCharacterId === null) return false;
      const office = everyOffice.find((candidate) => candidate.id === seat.officeId);
      if (office === undefined || office.polityId !== polityId) return false;
      if (!world.characters.some((character) => character.id === seat.holderCharacterId && character.alive)) return false;
      const line = competenceOf(world, office.id, government.offices)?.acts[act];
      return line !== undefined && (isOwnToDo(line.grade) || (line.grade === "by_the_body" && line.body !== null));
    });
    const nobody = powers(world).flatMap((record) => [...FISCAL_ACTS, "embargoes" as ActKind]
      .filter((act) => !(act === "spending" && !hasChest(world, record.polityId)) && !seated(record.polityId, act)
        // A tribal people has no standing tax and no loans (the research: its chief takes tribute and plunder, and has no chest to borrow for): by its form, nobody decides them.
        && !(record.form === "tribal_confederation" && (act === "tax_rate" || act === "loans")))
      .map((act) => `${record.polityId}: nobody seated may decide ${act}`));
    expect(nobody).toEqual([]);
  });

  it("finds a man of the power to write to about its treaties and its customs", () => {
    const lacking = powers(world).filter((record) => chargeHolders(world, record.polityId, "pacts", government.offices).length === 0).map((record) => record.polityId);
    expect(lacking).toEqual([]);
  });
});
