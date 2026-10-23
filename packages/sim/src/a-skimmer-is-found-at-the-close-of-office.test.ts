import { describe, expect, it } from "vitest";
import { renderTheAccounts, FOUND_STANDING_BPS } from "./close-of-office";
import { ending, holderOf, opening, withSkills, withTheft, atDay } from "./accounts-test-kit";
import { decideTheMonth, carryOut } from "./government-test-kit";
import { opening as fiscalOpening } from "./fiscal-test-kit";

/**
 * A skimmer is found at the close of office.
 *
 * A quaestor whose hand was in the chest leaves a gap between what his charge should have brought in and what reached it. The man who reads his accounts finds it
 * or not by his eye against the thief's care; found, the gap is evidence: the man loses standing, a mark is made against him, and the praetor brings the case,
 * before the people in Rome (a hundred years before any standing court), before the Hundred and Four in Carthage.
 */
describe("a skimmer is found at the close of office", () => {
  const base = opening(365);
  const man = holderOf(base, "roman-quaestor");
  const sharp = withSkills(withTheft(base, man.id, "rome"), { [man.id]: { intrigue: 5, stewardship: 20 } });

  /** Every man who could look at the books made keen, so the finding is the gap's and not the dice's. */
  const keen = (world: typeof base) => withSkills(world, Object.fromEntries(world.characters.filter((c) => c.id !== man.id).map((c) => [c.id, { stewardship: 100, intrigue: 100, learning: 100, diplomacy: 100 }])));

  it("finds the gap when the examiner is keen and the man careless", () => {
    const done = renderTheAccounts(ending(keen(sharp), "roman-quaestor", man));
    expect(done.renderings[0]!.gap).toBe(18_000);
    expect(done.renderings[0]!.found).toBeGreaterThan(0);
    const foundRows = done.world.diversions.filter((row) => row.byCharacterId === man.id && row.foundAtStep === 365);
    expect(foundRows.length).toBeGreaterThan(0);
    expect(done.world.characters.find((c) => c.id === man.id)!.prestigeBps).toBeLessThanOrEqual(man.prestigeBps + FOUND_STANDING_BPS + 1);
    expect(done.world.answerable.find((entry) => entry.characterId === man.id)).toMatchObject({ kind: "breach", weight: 2 });
    expect(done.facts.map((f) => f.kind)).toEqual(["accounts_found"]);
    // One finding fact a power in a month, however many men lay down their offices.
    const two = renderTheAccounts({ ...ending(keen(sharp), "roman-quaestor", man), endedTerms: [...ending(sharp, "roman-quaestor", man).endedTerms, ...ending(sharp, "roman-quaestor", holderOf(sharp, "roman-quaestor", 1)).endedTerms] });
    expect(two.facts.filter((f) => f.affectedRefs?.some((ref) => ref.id === "rome"))).toHaveLength(1);
  });

  it("misses a hidden gap when the man is careful and the examiner dull, at least some of the time", () => {
    const careful = withSkills(withTheft(base, man.id, "rome"), { [man.id]: { intrigue: 100, stewardship: 100, diplomacy: 100, learning: 100 } });
    const dull = withSkills(careful, Object.fromEntries(careful.characters.filter((c) => c.id !== man.id).map((c) => [c.id, { stewardship: 5, intrigue: 5, learning: 5, diplomacy: 5 }])));
    const done = renderTheAccounts(ending(dull, "roman-quaestor", man));
    expect(done.renderings[0]!.found).toBeLessThan(done.renderings[0]!.gap);
    expect(done.world.diversions.filter((row) => row.foundAtStep === null).length).toBeGreaterThan(0);
  });

  it("has the praetor bring the case of a found skimmer before the people, not the Senate", () => {
    const found = renderTheAccounts(ending(keen(sharp), "roman-quaestor", man)).world;
    const world = { ...fiscalOpening(400), ...found, instant: { ...found.instant, day: 400 }, elapsedStep: 400 };
    let opened: ReturnType<typeof decideTheMonth>[number] | undefined;
    let when = 0;
    for (let day = 400; day <= 700 && opened === undefined; day += 30) {
      opened = decideTheMonth(atDay(world, day), day).find((d) => d.polityId === "rome" && /^justice/.test(d.why));
      when = day;
    }
    expect(opened).toBeDefined();
    expect(opened!.deltas[0]).toMatchObject({ op: "political_procedure_open", type: "denunciation", subjectRef: man.id, institutionRef: "roman-comitia-tributa" });
    const done = carryOut(atDay(world, when), opened!);
    expect(done.rejected).toEqual([]);
  });

  it("brings Carthage's case at once, before the Hundred and Four", () => {
    const suffete = holderOf(base, "carthaginian-suffete");
    const thief = withSkills(withTheft(base, suffete.id, "carthage"), { [suffete.id]: { intrigue: 5, stewardship: 20 } });
    const keenAll = withSkills(thief, Object.fromEntries(thief.characters.filter((c) => c.id !== suffete.id).map((c) => [c.id, { stewardship: 100, intrigue: 100, learning: 100, diplomacy: 100 }])));
    const done = renderTheAccounts(ending(keenAll, "carthaginian-suffete", suffete));
    expect(done.renderings[0]).toMatchObject({ style: "examination" });
    const case_ = done.world.material.politicalProcedures.find((p) => p.type === "denunciation" && p.subjectId === suffete.id);
    expect(case_).toMatchObject({ institutionId: "carthaginian-hundred-and-four", concerns: ["punishment"] });
  });
});
