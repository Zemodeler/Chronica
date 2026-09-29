import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, aptitude, applyDiplomaticAnswerToStance, ensureProvinceMaterial, practise, spreadSubSkills, type Character, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { exposureMultiplier } from "./mortality";
import { createIdFactory } from "./ports";
import { blocLeanings } from "./senate";

/**
 * The finer skills, read. Fourteen were defined and none was ever read; the
 * seven skills were read in six places.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const withSkill = (world: WorldState, id: string, change: (character: Character) => Character): WorldState =>
  ({ ...world, characters: world.characters.map((character) => (character.id === id ? change(character) : character)) });
const sub = (character: Character, skill: string, value: number): Character =>
  ({ ...character, skills: { ...character.skills, subSkills: { ...character.skills.subSkills, [skill]: value } } });

describe("what a man is good at", () => {
  it("is read from his finer skill, or his skill where none is written", () => {
    const man = { skills: { martial: 70, intrigue: 40, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: { logistics: 90 } } };
    expect(aptitude(man, "logistics")).toBe(90);
    expect(aptitude(man, "strategist")).toBe(70);
  });

  it("gives everybody finer skills of their own, near their skills, and the same every time", () => {
    const skills = { martial: 70, intrigue: 40, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50 };
    const spread = spreadSubSkills("someone", skills);
    expect(spread).toEqual(spreadSubSkills("someone", skills));
    expect(Math.abs(spread.strategist! - 70)).toBeLessThanOrEqual(15);
    expect(spreadSubSkills("someone", skills, { rhetoric: 99 }).rhetoric).toBe(99);
  });

  it("gets better for doing the work, and never past ninety", () => {
    const man = { skills: { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: { rhetoric: 89 } } };
    expect(aptitude(practise(man, "rhetoric", 5), "rhetoric")).toBe(90);
    expect(aptitude(practise(practise(man, "rhetoric", 5), "rhetoric", 5), "rhetoric")).toBe(90);
  });

  it("marches an army faster for a commander who can feed it", () => {
    const march = (logistics: number) => {
      const world = withSkill(opening(), "gaius-genucius", (character) => sub(character, "logistics", logistics));
      const result = applyDeltas(world, [WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: "punic-italy-bruttian-highlands", reason: "South." })], {
        now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
        terrains: definition.map.terrains, ids: createIdFactory(`march-${logistics}`), gameId: "game-skill",
      } satisfies ApplyContext);
      return result.world.projects.find((project) => project.completionOutcome?.kind === "force_move")!.milestones.at(-1)!.requiredAtElapsedOffset;
    };
    expect(march(95)).toBeLessThan(march(50));
    expect(march(50)).toBeLessThan(march(5));
  });

  it("keeps a hard man healthier", () => {
    const world = opening();
    const hardy = withSkill(world, "manius-curius", (character) => sub(character, "endurance", 95));
    const frail = withSkill(world, "manius-curius", (character) => sub(character, "endurance", 5));
    const of = (state: WorldState) => exposureMultiplier(state, state.characters.find((character) => character.id === "manius-curius")!);
    expect(of(hardy)).toBeLessThan(of(frail));
  });

  it("refuses without giving offence, where the man refusing has the gift for it", () => {
    const refused = { fromPolityId: "rome", toPolityId: "syracuse", answer: "refused" as const, subject: "Messana" };
    const trustAfter = (arbitration: number) => applyDiplomaticAnswerToStance([], refused, 1, { answerer: { skills: { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: { arbitration } } } })
      .find((stance) => stance.polityId === "rome" && stance.towardPolityId === "syracuse")!.trustScore;
    expect(trustAfter(95)).toBeGreaterThan(trustAfter(5));
  });

  it("moves the house more for an orator than for a man who cannot speak", () => {
    const opened = applyDeltas(opening(), [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "q", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "A question", resolutionMechanism: "vote", deadlineInDays: 10, reason: "Asked.",
    }), WorldDeltaSchema.parse({
      op: "political_support_set", procedureRef: "local:q", supporterKind: "character", supporterRef: "manius-curius", position: "support",
      influenceWeight: 50, reasonKind: "material_interest", reasonLabel: "For it.", reason: "He speaks.",
    })], { now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "manius-curius" }, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("q"), gameId: "game-q" });
    const id = opened.assignedIds.get("q")!;
    const procedure = opened.world.material.politicalProcedures.find((candidate) => candidate.id === id)!;
    const senate = opened.world.material.institutions.find((institution) => institution.id === "roman-senate")!;
    const lean = (rhetoric: number) => blocLeanings(withSkill(opened.world, "manius-curius", (character) => sub(character, "rhetoric", rhetoric)), procedure, senate).reduce((sum, bloc) => sum + bloc.lean, 0);
    expect(lean(95)).toBeGreaterThan(lean(5));
  });
});
