import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { CUSTOMARY_TAX_BURDEN, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, taxBurdens, taxShortfallSummary, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * "Double the tributum." "Triple it."
 *
 * Both used to work exactly as written: the model set a new amount and the
 * tick collected it in full every month, from a people in revolt as readily as
 * from a contented one. Now what a power's lands pay is bounded by what they
 * can bear, and pressing them past half of it lowers the order they settle to
 * -- which lowers what they can bear. These walk a year of each.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
// Middling tax men: these count what the land bears, not who collects it.
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));

/** Run a year month by month, returning what the Roman treasury took in each month and the last tick's facts. */
function aYearOf(world: WorldState) {
  let current = world;
  const monthly: number[] = [];
  const facts: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const before = current.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
    const expenses = current.material.obligations
      .filter((obligation) => obligation.active && obligation.payerAccountId === "rome-treasury")
      .reduce((sum, obligation) => sum + obligation.amount, 0);
    const ticked = runDeterministicTick({ world: current, toDay: month * 30, ids: createIdFactory(`tax-${month}`), warfare: definition.warfare });
    expect(WorldStateSchema.safeParse(ticked.world).success).toBe(true);
    current = ticked.world;
    const after = current.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
    monthly.push(after - before + expenses);
    facts.push(...ticked.factProposals.map((fact) => String(fact.kind)));
  }
  return { world: current, monthly, facts };
}

const romanStability = (world: WorldState): number => {
  const held = world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id);
  const rows = world.material.provinceMaterial.filter((row) => held.includes(row.provinceId));
  return rows.reduce((sum, row) => sum + row.stabilityBps, 0) / rows.length;
};

const withTributum = (world: WorldState, amount: number): WorldState => ({
  ...world,
  material: {
    ...world.material,
    incomeSources: world.material.incomeSources.map((source) => (source.id === "rome-tributum" ? { ...source, amount } : source)),
  },
});

describe("taxes the land can bear", () => {
  it("leaves the opening's taxes alone: every power asks less than its lands can bear", () => {
    const burdens = taxBurdens(opening());
    for (const polityId of ["rome", "carthage", "syracuse"]) {
      const burden = burdens.get(polityId)!;
      expect(burden.collectedShare).toBe(1);
    }
    // Rome asks well under the customary share, so its provinces settle where they always did.
    const rome = burdens.get("rome")!;
    expect(rome.asked / rome.bearable).toBeLessThan(CUSTOMARY_TAX_BURDEN);
    expect(rome.stabilityShiftBps).toBe(0);

    const year = aYearOf(opening());
    expect(year.facts).not.toContain("tax_shortfall");
    // The tributum and the land rents, as authored: about 1 600 a month. The
    // allies pay no tribute (v32); two of the rents come from land Rome took
    // from the Bruttians and Samnites.
    // What Rome levies at home is gathered by the Treasury of Saturn (v35):
    // four quaestors nobody named and two centuries of the work, at 60 --
    // three in a hundred more than a middling hand. The rents from the
    // Bruttians' and Samnites' country are paid, not gathered.
    const treasury = 1 + ((60 - 50) / 50) * 0.15;
    expect(year.monthly[0]).toBe(Math.round(1_100 * 0.9 * treasury) + Math.round(330 * treasury) + 150 + 150);
  });

  it("does not collect a tenfold tributum: the collectors raise what the land can bear, and say so", () => {
    const pressed = aYearOf(withTributum(opening(), 11_000));
    const bearable = taxBurdens(opening()).get("rome")!.bearable;
    // What Rome's own lands can bear, plus the rents it draws from its allies'
    // country, which that ceiling does not govern.
    const fromAbroad = opening().material.incomeSources
      .filter((source) => source.beneficiaryAccountId === "rome-treasury" && source.counterpartyPolityId !== null)
      .reduce((sum, source) => sum + source.amount, 0);
    expect(pressed.monthly[0]).toBeLessThanOrEqual(bearable + fromAbroad + 1);
    expect(pressed.facts).toContain("tax_shortfall");
  });

  it("sours order when a power presses hard, and still pays: tripling the tributum is a real choice, not a trap", () => {
    const calm = aYearOf(opening());
    const tripled = aYearOf(withTributum(opening(), 3_300));
    expect(romanStability(tripled.world)).toBeLessThan(romanStability(calm.world) - 1_000);
    expect(tripled.monthly.reduce((a, b) => a + b, 0)).toBeGreaterThan(calm.monthly.reduce((a, b) => a + b, 0));
  });

  it("gets less and less out of a land pressed past what it bears", () => {
    const crushed = aYearOf(withTributum(opening(), 5_500));
    // The collectors bring in what there is, and there is less every month.
    expect(crushed.monthly[11]!).toBeLessThan(crushed.monthly[0]! / 2);
    // A tax five times the old one raised no more over the year than one three
    // times it, give or take a twentieth: both are pressed to what the land
    // bears, and a land whose people now grow bears the same few coins more
    // under either. (Seventy-odd provinces settle one by one, not two.)
    const tripled = aYearOf(withTributum(opening(), 3_300));
    expect(crushed.monthly.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(tripled.monthly.reduce((a, b) => a + b, 0) * 1.05);
  });

  describe("ground the enemy holds", () => {
    // A Roman province the enemy holds pays nobody, so Rome's collected share
    // falls below one. Which used to be written up as Rome asking more of its
    // lands than they could bear -- even when a skilled treasury brought in
    // more than was due: "of 816 due, the collectors raised 874" (E28).
    /** Rome's provinces taken by Carthage, the poorest first and never Rome itself, until Rome holds no more than `share` of what its own land could pay. */
    const occupied = (world: WorldState, share: number): WorldState => {
      const ours = world.map.provinces
        .filter((province) => province.controllerPolityId === "rome")
        .map((province) => ({ id: province.id, capacity: world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.taxCapacity ?? 0 }))
        .sort((a, b) => a.capacity - b.capacity)
        .slice(0, -1);
      let current = world;
      for (const { id } of ours) {
        if (taxBurdens(current).get("rome")!.held <= share) break;
        current = { ...current, map: { ...current.map, provinces: current.map.provinces.map((province) => (province.id === id ? { ...province, controllerPolityId: "carthage", ownerPolityId: "rome" } : province)) } };
      }
      return current;
    };
    const month = (world: WorldState) => runDeterministicTick({ world, toDay: 30, ids: createIdFactory("occupied"), warfare: definition.warfare }).factProposals;

    it("writes no shortfall when a skilled treasury brings in more than was due", () => {
      const base = opening();
      const treasury = readDepartments(base).holding({ kind: "polity", id: "rome" }, "tax_roll").department!;
      const officeId = treasury.headOfficeId ?? treasury.officeIds[0]!;
      const quaestor = base.characters.find((character) => character.alive && character.polityId === "rome")!;
      const skilled: WorldState = {
        ...base,
        characters: base.characters.map((character) => (character.id === quaestor.id
          ? { ...character, skills: { ...character.skills, subSkills: { ...character.skills.subSkills, taxation: 100 } } }
          : character)),
        material: { ...base.material, officeSeats: [...base.material.officeSeats, {
          id: "quaestor-seat", officeId, seatIndex: 0, holderCharacterId: quaestor.id, status: "held", vacancyCause: "none",
          termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
        }] },
      };
      const skill = readDepartments(skilled).skill({ kind: "polity", id: "rome" }, "tax_roll");
      expect(skill).toBeGreaterThan(60);
      // Held to a share his skill more than makes up for.
      const world = occupied(skilled, (1 + 1 / (1 + ((skill - 50) / 50) * 0.15)) / 2);
      const burden = taxBurdens(world).get("rome")!;
      expect(burden.held).toBeLessThan(1);
      expect(burden.collectedShare).toBeLessThan(1);
      expect(month(world).map((fact) => String(fact.kind))).not.toContain("tax_shortfall");
    });

    it("blames the occupation, not the tax, when the collectors do come back short", () => {
      const facts = month(occupied(opening(), 0.8));
      const short = facts.find((fact) => String(fact.kind) === "tax_shortfall" && (fact.affectedRefs ?? []).some((ref) => ref.id === "rome"));
      expect(short?.summary).toContain("occupied districts, which paid nothing");
      expect(short?.summary).not.toContain("than they could bear");
    });
  });

  it("names its cause in the shortfall line, and writes none for a surplus", () => {
    const burden = { polityId: "rome", bearable: 1_000, asked: 500, collectedShare: 0.9, held: 0.9, stabilityShiftBps: 0 };
    expect(taxShortfallSummary("Rome", burden, { asked: 816, raised: 874 })).toBeNull();
    expect(taxShortfallSummary("Rome", burden, { asked: 816, raised: 734 })).toContain("occupied districts");
    expect(taxShortfallSummary("Rome", { ...burden, asked: 2_000, held: 1, collectedShare: 0.5 }, { asked: 816, raised: 408 })).toContain("more of its lands than they could bear");
    expect(taxShortfallSummary("Rome", { ...burden, asked: 2_000, collectedShare: 0.45 }, { asked: 816, raised: 367 })).toMatch(/could bear, and its occupied districts/);
  });

  it("leaves trade alone: harbour dues are not a levy on anybody's land", () => {
    const world = opening();
    const burdens = taxBurdens(world);
    // Carthage's harbour dues are larger than its tribute and are not counted against its land.
    expect(burdens.get("carthage")!.asked).toBe(Math.round(960 * 0.85));
    expect(burdens.has("mamertines")).toBe(false);
  });
});
