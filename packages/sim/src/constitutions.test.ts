import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, recordTenures, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { constitutionOf, ensureConstitutions, keepThrones, readForm, recast, rulerOf, templateFor, EMPTY_THRONE_DAYS } from "./constitutions";
import { killCharacter } from "./mortality";
import { raiseOpenings } from "./openings";
import { createIdFactory } from "./ports";
import { concernsOf } from "./questions";
import { attemptRegimeChange } from "./regime";
import { ADVICE_DAYS, blocLeanings, holdVotes } from "./senate";
import { reviewSociety } from "./society";

/**
 * Only Rome had chambers: every other power's questions could not be put to a
 * vote, a king who died was never followed, and no government could become
 * another kind of government. These are the pieces that changed that -- each
 * power's constitution as parts, the groups the world makes for itself, and
 * the ways a constitution changes.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const base = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const opening = (): WorldState => ensureConstitutions({ world: base(), government, toDay: 0 });

let calls = 0;
const context = (actor: string, day = 0) => ({
  now: { day, minute: 540 }, actorRef: { kind: "character" as const, id: actor }, offices: government.offices, successionRules: government.successionRules,
  warfare: definition.warfare, ids: createIdFactory(`constitution-${(calls += 1)}`), gameId: "game-constitutions",
});
const act = (world: WorldState, actor: string, delta: Record<string, unknown>, day = 0) => applyDeltas(world, [WorldDeltaSchema.parse(delta)], context(actor, day));
const valid = (world: WorldState): void => {
  const parsed = WorldStateSchema.safeParse(world);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
};
const question = (world: WorldState, id: string) => world.material.politicalProcedures.find((procedure) => procedure.id === id)!;
const vote = (world: WorldState, toDay: number) => holdVotes({ world, offices: government.offices, successionRules: government.successionRules, toDay, ids: createIdFactory(`count-${toDay}`) });
const withProvinces = (world: WorldState, provinceIds: readonly string[], change: Partial<WorldState["material"]["provinceMaterial"][number]>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((entry) => (provinceIds.includes(entry.provinceId) ? { ...entry, ...change } : entry)) },
});
const withLegitimacy = (world: WorldState, polityId: string, legitimacyBps: number): WorldState => ({
  ...world,
  material: {
    ...world.material,
    polityLegitimacy: world.material.polityLegitimacy.some((entry) => entry.polityId === polityId)
      ? world.material.polityLegitimacy.map((entry) => (entry.polityId === polityId ? { ...entry, legitimacyBps } : entry))
      : [...world.material.polityLegitimacy, { polityId, legitimacyBps, institutionalConfidenceBps: 5_000, causes: [] }],
  },
});

describe("every power's constitution", () => {
  it("is recorded for the powers the scenario wrote, and grown from its form for every other", () => {
    const world = opening();
    valid(world);
    for (const polity of world.map.polities) expect(constitutionOf(world, polity.id), polity.id).toBeDefined();
    expect(constitutionOf(world, "rome")).toMatchObject({ origin: "scenario", form: "oligarchic_republic", rulerOfficeId: "roman-consul" });
    expect(constitutionOf(world, "carthage")).toMatchObject({ origin: "scenario", form: "oligarchic_republic", sovereignInstitutionId: "carthaginian-council" });
    expect(constitutionOf(world, "syracuse")).toMatchObject({ origin: "scenario", form: "monarchy", rulerOfficeId: "syracusan-king", sovereignInstitutionId: null });
    expect(constitutionOf(world, "mamertines")).toMatchObject({ form: "soldier_commune", sovereignInstitutionId: "mamertine-assembly" });
    expect(constitutionOf(world, "boii")).toMatchObject({ origin: "generated", form: "tribal_confederation" });
    expect(constitutionOf(world, "achaean-league")?.form).toBe("league");
    expect(constitutionOf(world, "macedon")?.form).toBe("monarchy");
    // Macedon's council counsels its king and binds nobody.
    expect(world.material.institutions.filter((institution) => institution.polityId === "macedon").every((institution) => institution.advisory === true)).toBe(true);
    // Every generated form reads back as itself.
    for (const polityId of ["boii", "achaean-league", "athens", "macedon", "massalia"]) expect(readForm(world, polityId, government)).toBe(constitutionOf(world, polityId)!.form);
  });

  it("is the same on every replay, and differs between two powers of the same form", () => {
    expect(JSON.stringify(opening())).toBe(JSON.stringify(opening()));
    const world = base();
    const boii = world.map.polities.find((polity) => polity.id === "boii")!;
    const insubres = world.map.polities.find((polity) => polity.id === "insubres")!;
    expect(JSON.stringify(templateFor(boii, "tribal_confederation"))).not.toBe(JSON.stringify(templateFor(insubres, "tribal_confederation").chambers.map((chamber) => chamber).map(() => null)));
    const names = (polity: typeof boii) => templateFor(polity, "tribal_confederation").chambers.map((chamber) => `${chamber.name}/${chamber.blocs.map((bloc) => bloc.weight).join(",")}/${chamber.passageThresholdBps}`).join("|");
    expect(names(boii)).not.toBe(names(insubres));
  });

  it("gives a gathering of chiefs a bloc for every province its people hold", () => {
    const reviewed = reviewSociety({ world: opening(), government, warfare: definition.warfare, toDay: 0, ids: createIdFactory("society") }).world;
    valid(reviewed);
    const gathering = reviewed.material.institutions.find((institution) => institution.polityId === "boii" && institution.franchise === "chiefs")!;
    expect(gathering.votingBlocs.some((bloc) => bloc.interests?.includes("regional") && bloc.name.includes("Boii"))).toBe(true);
    expect(gathering.totalVotingWeight).toBe(gathering.votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0));
  });
});

describe("a question, weighed by what each bloc wants", () => {
  it("sets the landed Patricians against a land law, whatever their mood", () => {
    const opened = act(opening(), "gaius-genucius", {
      op: "political_procedure_open", localId: "land", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "Land allotments for the poor from the public land", resolutionMechanism: "vote", deadlineInDays: 20, reason: "The people ask it.",
    });
    expect(opened.rejected).toEqual([]);
    const procedure = question(opened.world, opened.assignedIds.get("land")!);
    expect(concernsOf(opened.world, procedure)).toContain("land");
    const senate = opened.world.material.institutions.find((institution) => institution.id === "roman-senate")!;
    const leanings = blocLeanings(opened.world, procedure, senate);
    const patricians = leanings.find((leaning) => leaning.bloc.id === "patrician-bloc")!;
    const populars = leanings.find((leaning) => leaning.bloc.id === "popular-bloc")!;
    expect(patricians.lean).toBeLessThan(0);
    expect(patricians.choice).toBe("no");
    expect(populars.lean).toBeGreaterThan(0);
    expect(patricians.reasons.join(" ")).toContain("land for the landless");
  });
});

describe("a king's council", () => {
  const putToCouncil = (label: string) => {
    const opened = act(opening(), "hieron-ii", {
      op: "political_procedure_open", localId: "q", type: "council_deliberation", institutionRef: "syracusan-council", sponsorCharacterRef: "hieron-ii",
      subjectKind: "polity", subjectRef: "syracuse", label, resolutionMechanism: "vote", deadlineInDays: 10, reason: "The king asks his friends.",
    });
    expect(opened.rejected).toEqual([]);
    return { world: opened.world, id: opened.assignedIds.get("q")! };
  };

  it("is counted, and then the king decides; if he says nothing, its advice stands", () => {
    const { world, id } = putToCouncil("Take the old families' land for the crown");
    const counted = vote(world, 10);
    valid(counted.world);
    const advised = question(counted.world, id);
    expect(advised.stage).toBe("voting_or_deciding");
    expect(advised.voteRecordId).not.toBeNull();
    expect(counted.facts.some((fact) => fact.kind === "council_advised")).toBe(true);
    expect(counted.world.characterPressures.some((pressure) => pressure.characterId === "hieron-ii" && pressure.label.includes("overrule"))).toBe(true);
    // Not counted twice.
    expect(vote(counted.world, 11).facts.filter((fact) => fact.kind === "council_advised")).toEqual([]);
    const lapsed = vote(counted.world, 10 + ADVICE_DAYS);
    expect(question(lapsed.world, id).stage).toBe("withdrawn");
  });

  it("may be overruled, and the king pays for it", () => {
    const { world, id } = putToCouncil("Take the old families' land for the crown");
    const counted = vote(world, 10);
    const record = counted.world.material.voteRecords.find((candidate) => candidate.id === question(counted.world, id).voteRecordId)!;
    expect(record.outcome).toBe("failed");
    const before = counted.world.material.polityLegitimacy.find((entry) => entry.polityId === "syracuse")?.legitimacyBps;
    const overruled = act(counted.world, "hieron-ii", { op: "political_procedure_resolve", procedureRef: id, outcome: "passed", outcomeReason: "The king wills it.", reason: "He is king." }, 12);
    expect(overruled.rejected).toEqual([]);
    expect(overruled.factProposals.some((fact) => fact.kind === "council_overruled")).toBe(true);
    if (before !== undefined) expect(overruled.world.material.polityLegitimacy.find((entry) => entry.polityId === "syracuse")!.legitimacyBps).toBeLessThan(before);
    expect(overruled.world.society.precedents.some((precedent) => precedent.kind === "overruled_council" && precedent.polityId === "syracuse")).toBe(true);
  });
});

describe("Carthage's council and people", () => {
  it("sends a magistrate's question it rejects on to the people, once", () => {
    const opened = act(opening(), "hanno-carthage", {
      op: "political_procedure_open", localId: "war", type: "council_deliberation", institutionRef: "carthaginian-council", sponsorCharacterRef: "hanno-carthage",
      subjectKind: "polity", subjectRef: "mamertines", label: "Declare war on the Mamertines", resolutionMechanism: "vote", deadlineInDays: 10, reason: "Messana must be ours.",
    });
    expect(opened.rejected).toEqual([]);
    const id = opened.assignedIds.get("war")!;
    const counted = vote(opened.world, 10);
    valid(counted.world);
    const referred = question(counted.world, id);
    expect(referred).toMatchObject({ institutionId: "carthaginian-assembly", referredFromInstitutionId: "carthaginian-council", stage: "gathering_support" });
    expect(counted.facts.some((fact) => fact.kind === "motion_referred")).toBe(true);
    const again = vote(counted.world, 30);
    expect(question(again.world, id).stage).toBe("resolved");
    expect(again.facts.some((fact) => fact.kind === "motion_referred")).toBe(false);
  });

  it("changes its constitution only in the council that holds it", () => {
    const refused = act(opening(), "hanno-carthage", {
      op: "political_procedure_open", localId: "c", type: "vote", institutionRef: "carthaginian-assembly", sponsorCharacterRef: "hanno-carthage",
      subjectKind: "polity", subjectRef: "carthage", label: "Give the people the government", resolutionMechanism: "vote", deadlineInDays: 10,
      enacts: { constitution: { form: "popular_republic" } }, reason: "Reform.",
    });
    expect(refused.rejected[0]?.reason).toContain("Council of Elders");
  });
});

describe("a constitution changed by law", () => {
  it("makes the Mamertines' council bind, when their assembly carries it", () => {
    let world = opening();
    const opened = act(world, "mamertine-spokesman", {
      op: "political_procedure_open", localId: "c", type: "vote", institutionRef: "mamertine-assembly", sponsorCharacterRef: "mamertine-spokesman",
      subjectKind: "polity", subjectRef: "mamertines", label: "The captains shall govern with the assembly", resolutionMechanism: "vote", deadlineInDays: 10,
      enacts: { constitution: { chamber: { institutionRef: "mamertine-council", advisory: false } } }, reason: "Order in the city.",
    });
    expect(opened.rejected).toEqual([]);
    world = opened.world;
    const id = opened.assignedIds.get("c")!;
    for (const bloc of ["mamertine-old-hands", "mamertine-settled-men"]) {
      const said = act(world, "mamertine-spokesman", { op: "political_support_set", procedureRef: id, supporterKind: "group", supporterRef: bloc, position: "support", influenceWeight: 50, reasonKind: "ideology", reasonLabel: "Order.", reason: "They back it." });
      expect(said.rejected).toEqual([]);
      world = said.world;
    }
    const counted = vote(world, 10);
    valid(counted.world);
    expect(question(counted.world, id).outcome).toBe("passed");
    expect(counted.world.material.institutions.find((institution) => institution.id === "mamertine-council")!.advisory).toBe(false);
  });

  it("recasts Carthage as a republic of its citizens: its chambers go, and so do the offices the new form lacks", () => {
    const opened = act(opening(), "hanno-carthage", {
      op: "political_procedure_open", localId: "q", type: "council_deliberation", institutionRef: "carthaginian-council", sponsorCharacterRef: "hanno-carthage",
      subjectKind: "polity", subjectRef: "carthage", label: "Grain for the city", resolutionMechanism: "vote", deadlineInDays: 30, reason: "Hunger.",
    });
    const done = recast({ world: opened.world, polityId: "carthage", toForm: "popular_republic", origin: "reform", byCharacterId: "hanno-carthage", seatRuler: null, government, atStep: 5, summary: "The people's law was carried." });
    valid(done.world);
    expect(done.world.material.institutions.some((institution) => institution.id === "carthaginian-council")).toBe(false);
    expect(done.world.material.institutions.some((institution) => institution.polityId === "carthage" && institution.franchise === "citizens" && institution.powers?.includes("constitution"))).toBe(true);
    expect(done.world.offices.find((office) => office.id === "carthaginian-elder")?.successionRuleId).toBe("abolished");
    expect(question(done.world, opened.assignedIds.get("q")!).stage).toBe("withdrawn");
    expect(constitutionOf(done.world, "carthage")).toMatchObject({ form: "popular_republic", origin: "reform" });
    expect(constitutionOf(done.world, "carthage")!.history.at(-1)).toMatchObject({ fromForm: "oligarchic_republic", toForm: "popular_republic" });
    expect(done.facts[0]!.kind).toBe("constitution_changed");
  });
});

describe("a throne that passes by blood", () => {
  const withHeir = (world: WorldState): WorldState => {
    const hieron = world.characters.find((character) => character.id === "hieron-ii")!;
    return {
      ...world,
      characters: [...world.characters, { ...hieron, id: "gelon-syracuse", name: "Gelon", birthStep: -20 * 365, officeId: null, officesHeld: [], prestigeBps: 4_000 }],
      familyLinks: [...world.familyLinks, { id: "family-gelon", characterId: "hieron-ii", relatedCharacterId: "gelon-syracuse", kind: "parent", startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null }],
    };
  };
  const kingDies = (world: WorldState, day: number): WorldState => killCharacter(recordTenures(world, day - 1), "hieron-ii", "He died in his sleep.", day).world;

  it("passes to the king's son the day he dies", () => {
    const dead = kingDies(withHeir(opening()), 10);
    const kept = keepThrones({ world: dead, government, toDay: 10 });
    valid(kept.world);
    expect(rulerOf(kept.world, "syracuse", government)?.id).toBe("gelon-syracuse");
    expect(kept.facts[0]).toMatchObject({ kind: "succession" });
  });

  it("with no heir, stands empty, and then its council takes the choosing on", () => {
    const dead = kingDies(opening(), 10);
    const waiting = keepThrones({ world: dead, government, toDay: 20 });
    expect(rulerOf(waiting.world, "syracuse", government)).toBeNull();
    expect(waiting.facts).toEqual([]);
    const opened = raiseOpenings({ world: waiting.world, government, toDay: 20 });
    expect(opened.characterPressures.some((pressure) => pressure.id.startsWith("opening:syracuse:empty-throne"))).toBe(true);
    const chosen = keepThrones({ world: waiting.world, government, toDay: 10 + EMPTY_THRONE_DAYS });
    valid(chosen.world);
    expect(chosen.facts[0]!.summary).toContain("Council of the King's Friends");
    const office = chosen.world.offices.find((candidate) => candidate.id === "syracusan-king")!;
    expect(chosen.world.successionRules.find((rule) => rule.id === office.successionRuleId)).toMatchObject({ kind: "elective", institutionId: "syracusan-council" });
    expect(constitutionOf(chosen.world, "syracuse")!.history.at(-1)?.origin).toBe("extinction");
  });
});

describe("a government taken by force", () => {
  const leptinesWithTheArmy = (): WorldState => {
    const world = opening();
    return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "syracusan-army" ? { ...force, commanderCharacterId: "leptines-syracuse", controllerCharacterId: "leptines-syracuse" } : force)) } };
  };

  it("is refused to a man with no army at the capital", () => {
    const refused = act(opening(), "leptines-syracuse", { op: "regime_change", actorCharacterRef: "leptines-syracuse", polityRef: "syracuse", route: "coup", forceRefs: ["syracusan-squadron"], reason: "The crown." });
    expect(refused.rejected[0]?.reason).toContain("no army");
  });

  it("is refused a revolution where nobody is in unrest", () => {
    const refused = act(opening(), "leptines-syracuse", { op: "regime_change", actorCharacterRef: "leptines-syracuse", polityRef: "syracuse", route: "revolution", reason: "The people." });
    expect(refused.rejected[0]?.reason).toContain("not in unrest");
  });

  it("is rolled, and either makes Leptines king and gathers Hieron's party, or ruins him", () => {
    const world = leptinesWithTheArmy();
    const outcomes = Array.from({ length: 40 }, (_, day) => attemptRegimeChange({ world, actorId: "leptines-syracuse", polityId: "syracuse", route: "coup", form: null, forceIds: ["syracusan-army"], government, atStep: day + 1, gameId: "game-constitutions" }));
    const won = outcomes.find((outcome) => "succeeded" in outcome && outcome.succeeded);
    const lost = outcomes.find((outcome) => "succeeded" in outcome && !outcome.succeeded);
    expect(won).toBeDefined();
    expect(lost).toBeDefined();
    if (won === undefined || !("world" in won) || lost === undefined || !("world" in lost)) return;
    valid(won.world);
    expect(rulerOf(won.world, "syracuse", government)?.id).toBe("leptines-syracuse");
    expect(won.world.material.politicalGroups.some((group) => group.type === "deposed_party" && group.leaderCharacterId === "hieron-ii" && group.active)).toBe(true);
    expect(won.world.society.precedents.some((precedent) => precedent.kind === "army_made_ruler")).toBe(true);
    valid(lost.world);
    expect(rulerOf(lost.world, "syracuse", government)?.id).toBe("hieron-ii");
    expect(lost.world.characterPressures.some((pressure) => pressure.characterId === "leptines-syracuse" && pressure.kind === "political_danger")).toBe(true);
    expect(lost.world.characterPressures.some((pressure) => pressure.characterId === "hieron-ii" && pressure.label.includes("Leptines"))).toBe(true);
  });

  it("lets a conqueror holding the capital dictate a government", () => {
    const world = opening();
    const taken: WorldState = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === "ita-72843720b81376294924159-sicily-northeast" ? { ...province, controllerPolityId: "rome" } : province)) },
    };
    const imposed = act(taken, "gaius-genucius", { op: "regime_change", actorCharacterRef: "gaius-genucius", polityRef: "mamertines", route: "imposition", form: "oligarchic_republic", reason: "Order in Messana." });
    expect(imposed.rejected).toEqual([]);
    valid(imposed.world);
    expect(constitutionOf(imposed.world, "mamertines")).toMatchObject({ form: "oligarchic_republic", origin: "imposition" });
    expect(imposed.world.material.institutions.some((institution) => institution.id === "mamertine-assembly")).toBe(false);
  });
});

describe("the world's groups", () => {
  const review = (world: WorldState, toDay: number) => reviewSociety({ world, government, warfare: definition.warfare, toDay, ids: createIdFactory(`society-${toDay}`) });
  const romanLand = ["punic-italy-latium", "punic-italy-campanian-plain"];

  it("gathers Rome's ruined into a party of debtors with seats in its assemblies, and lets it go when they recover", () => {
    const ruined = withProvinces(opening(), romanLand, { warDamageBps: 8_000, foodSecurityBps: 2_000 });
    const first = review(ruined, 0);
    valid(first.world);
    const debtors = first.world.material.politicalGroups.find((group) => group.emergentKey === "debtors:rome")!;
    expect(debtors.active).toBe(true);
    const centuriate = first.world.material.institutions.find((institution) => institution.id === "roman-comitia-centuriata")!;
    expect(centuriate.votingBlocs.some((bloc) => bloc.groupId === debtors.id && bloc.interests?.includes("debtors"))).toBe(true);
    // The Senate's franchise has no room for them.
    expect(first.world.material.institutions.find((institution) => institution.id === "roman-senate")!.votingBlocs.some((bloc) => bloc.groupId === debtors.id)).toBe(false);
    const recovered = review(withProvinces(first.world, romanLand, { warDamageBps: 0, foodSecurityBps: 10_000 }), 30);
    valid(recovered.world);
    expect(recovered.world.material.politicalGroups.find((group) => group.id === debtors.id)!.active).toBe(false);
    expect(recovered.world.material.institutions.find((institution) => institution.id === "roman-comitia-centuriata")!.votingBlocs.some((bloc) => bloc.groupId === debtors.id)).toBe(false);
    expect(recovered.facts.some((fact) => fact.kind === "group_dissolved")).toBe(true);
  });

  it("remembers men sent home, and makes veterans of them", () => {
    const first = review(opening(), 0).world;
    const sent: WorldState = {
      ...first,
      material: { ...first.material, forces: first.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, personnel: force.personnel.map((category) => ({ ...category, fit: Math.max(0, category.fit - 1_700) })) } : force)) },
    };
    const second = review(sent, 30);
    valid(second.world);
    expect(second.world.society.discharged.some((entry) => entry.polityId === "rome" && entry.count >= 3_000)).toBe(true);
    expect(second.world.material.politicalGroups.some((group) => group.emergentKey === "veterans:rome" && group.active)).toBe(true);
    expect(second.facts.some((fact) => fact.kind === "group_formed")).toBe(true);
  });

  it("makes an army its general's own after two years", () => {
    const first = review(opening(), 0).world;
    const later = review(first, 800).world;
    expect(later.material.politicalGroups.some((group) => group.emergentKey === "army:roman-field-army:gaius-genucius" && group.active)).toBe(true);
  });

  it("finds a faction in men who keep declaring as a leading man does", () => {
    let world = opening();
    // Manius Curius, the first man of the house, and two of lesser standing who always vote with him.
    const leader = "manius-curius";
    const followers = ["gaius-genucius", "quintus-ogulnius"];
    for (const [index, label] of ["A thanksgiving", "A new road", "A levy of ships"].entries()) {
      const opened = act(world, "gaius-genucius", {
        op: "political_procedure_open", localId: `q${index}`, type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
        subjectKind: "polity", subjectRef: "rome", label, resolutionMechanism: "vote", deadlineInDays: 20, reason: "Business.",
      });
      world = opened.world;
      for (const who of [leader, ...followers]) {
        world = act(world, who, { op: "political_support_set", procedureRef: opened.assignedIds.get(`q${index}`)!, supporterKind: "character", supporterRef: who, position: "support", influenceWeight: 20, reasonKind: "relationship", reasonLabel: "With Curius.", reason: "He agrees." }).world;
      }
    }
    const reviewed = review(world, 0).world;
    valid(reviewed);
    const faction = reviewed.material.politicalGroups.find((group) => group.emergentKey === `faction:${leader}`)!;
    expect(faction.active).toBe(true);
    expect(reviewed.material.groupMemberships.filter((membership) => membership.groupId === faction.id && membership.leftAtStep === null).map((membership) => membership.characterId).sort()).toEqual([...followers, leader].sort());
    const senate = reviewed.material.institutions.find((institution) => institution.id === "roman-senate")!;
    const bloc = senate.votingBlocs.find((candidate) => candidate.groupId === faction.id)!;
    expect(bloc).toBeDefined();
    // The faction goes where Curius goes.
    const opened = act(reviewed, "gaius-genucius", {
      op: "political_procedure_open", localId: "next", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "A thanksgiving for the harvest", resolutionMechanism: "vote", deadlineInDays: 20, reason: "Business.",
    });
    const id = opened.assignedIds.get("next")!;
    const said = act(opened.world, leader, { op: "political_support_set", procedureRef: id, supporterKind: "character", supporterRef: leader, position: "oppose", influenceWeight: 20, reasonKind: "belief", reasonLabel: "Waste.", reason: "He objects." }).world;
    const leaning = blocLeanings(said, question(said, id), said.material.institutions.find((institution) => institution.id === "roman-senate")!).find((candidate) => candidate.bloc.id === bloc.id)!;
    expect(leaning.choice).toBe("no");
  });

  it("names an admiral for a power with a fleet and nobody to command it", () => {
    const reviewed = review(opening(), 0).world;
    expect(reviewed.offices.some((office) => office.id === "carthage:admiral" && office.label.includes("fleet"))).toBe(true);
  });

  it("writes down as custom what has been done twice", () => {
    const world = opening();
    const twice: WorldState = { ...world, society: { ...world.society, precedents: [{ polityId: "syracuse", kind: "overruled_council", key: "syracusan-council", atStep: 0 }, { polityId: "syracuse", kind: "overruled_council", key: "syracusan-council", atStep: 100 }] } };
    const reviewed = review(twice, 120).world;
    expect(reviewed.genericEntities.some((entity) => entity.kind === "custom" && entity.attributes["customKind"] === "overruled_council")).toBe(true);
  });
});

describe("the moment, offered", () => {
  it("tells a general whose army is his own that a weak government could be his", () => {
    // Not the consul -- he is the government -- but a man given the field army and kept at its head.
    const world = opening();
    const given: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, commanderCharacterId: "quintus-ogulnius", controllerCharacterId: "quintus-ogulnius" } : force)) } };
    const first = reviewSociety({ world: given, government, warfare: definition.warfare, toDay: 0, ids: createIdFactory("s0") }).world;
    const loyal = reviewSociety({ world: first, government, warfare: definition.warfare, toDay: 800, ids: createIdFactory("s1") }).world;
    const weak = withLegitimacy(loyal, "rome", 3_000);
    const opened = raiseOpenings({ world: weak, government, toDay: 800 });
    const strongMan = opened.characterPressures.find((pressure) => pressure.id.startsWith("opening:rome:strong-man"));
    expect(strongMan?.characterId).toBe("quintus-ogulnius");
    // Offered once a season, not every day.
    expect(raiseOpenings({ world: opened, government, toDay: 801 }).characterPressures.length).toBe(opened.characterPressures.length);
  });
});
