import {
  resolveBattle,
  summarizeBattleResult,
  type BattlePosture,
  type BattleResult,
  type Character,
  type FactProposal,
  type Force,
  type ScenarioWarfareRules,
  type TacticalModifierProposal,
  type WorldState,
} from "@chronica/shared";

/**
 * Battle (VISION §3, §12, §29).
 *
 * `@chronica/shared`'s warfare module is a complete, tested, deterministic
 * resolver -- effective strength from personnel, morale, cohesion, fatigue,
 * terrain, position, structures, supply and the commander, then casualties,
 * morale, retreats, captures and ground. It sat with no callers at all, so two
 * armies could stand in the same province indefinitely and nothing could happen
 * between them.
 *
 * This is the wiring, and it is deliberately thin. The model decides that a
 * battle occurs, who is in it and how they mean to fight; it may propose a
 * tactic, which the engine is free to refuse. Everything after that is
 * arithmetic, and arithmetic is the engine's. A model permitted to author its
 * own casualties would win every battle it cared about.
 *
 * Seeded from the burst, so a replay of the same burst fights the same battle.
 */

export interface EngagementInput {
  readonly world: WorldState;
  readonly attacker: Force;
  readonly defender: Force;
  readonly posture: BattlePosture;
  readonly tactic: { readonly factor: TacticalModifierProposal["factor"]; readonly magnitude: "minor" | "meaningful"; readonly rationale: string } | null;
  readonly warfare: ScenarioWarfareRules;
  readonly battleId: string;
  readonly seed: string;
}

export interface EngagementResult {
  readonly world: WorldState;
  readonly facts: readonly FactProposal[];
}

/** Every province sharing an edge with this one, in a stable order. */
function neighboursOf(world: WorldState, provinceId: string): string[] {
  const found = new Set<string>();
  for (const edge of world.map.edges) {
    if (edge.from === provinceId) found.add(edge.to);
    if (edge.to === provinceId) found.add(edge.from);
  }
  return [...found].sort();
}

function commanderOf(world: WorldState, force: Force): Character | null {
  return world.characters.find((character) => character.id === force.commanderCharacterId) ?? null;
}

/**
 * Folds a resolved battle back into the world.
 *
 * Nothing here decides anything: every number comes from the result. The only
 * judgement is about what an unrepresentable outcome means -- a retreat to
 * nowhere leaves a force where it stood, because a force must be somewhere.
 */
function applyResult(world: WorldState, result: BattleResult, atStep: number): WorldState {
  const lossesByForce = new Map<string, Map<string, number>>();
  for (const casualty of result.casualties) {
    const gone = casualty.dead + casualty.deserted + casualty.wounded;
    if (gone === 0) continue;
    const byCategory = lossesByForce.get(casualty.forceId) ?? new Map<string, number>();
    byCategory.set(casualty.categoryId, (byCategory.get(casualty.categoryId) ?? 0) + gone);
    lossesByForce.set(casualty.forceId, byCategory);
  }

  const stateByForce = new Map(result.forceChanges.map((change) => [change.forceId, change]));
  const retreatByForce = new Map(result.retreats.map((retreat) => [retreat.forceId, retreat]));

  const forces = world.material.forces.map((force) => {
    const losses = lossesByForce.get(force.id);
    const state = stateByForce.get(force.id);
    const retreat = retreatByForce.get(force.id);
    if (losses === undefined && state === undefined && retreat === undefined) return force;

    const personnel = losses === undefined
      ? force.personnel
      : force.personnel.map((category) => ({ ...category, fit: Math.max(0, category.fit - (losses.get(category.categoryId) ?? 0)) }));

    const history = [
      ...force.history,
      ...result.casualties
        .filter((casualty) => casualty.forceId === force.id && casualty.dead > 0)
        .map((casualty) => ({
          id: `${result.battleId}:${force.id}:${casualty.categoryId}:dead`,
          atStep,
          kind: "battle_death" as const,
          categoryId: casualty.categoryId,
          count: casualty.dead,
          causeId: result.battleId,
        })),
      ...result.casualties
        .filter((casualty) => casualty.forceId === force.id && casualty.deserted > 0)
        .map((casualty) => ({
          id: `${result.battleId}:${force.id}:${casualty.categoryId}:deserted`,
          atStep,
          kind: "desertion" as const,
          categoryId: casualty.categoryId,
          count: casualty.deserted,
          causeId: result.battleId,
        })),
    ];

    return {
      ...force,
      personnel,
      // The paper establishment follows the men actually present: a legion that
      // lost half its strength is not still a full legion on the books.
      authorizedStrength: Math.max(1, personnel.reduce((sum, category) => sum + category.fit, 0)),
      ...(state === undefined ? {} : { moraleBps: state.moraleBps, cohesionBps: state.cohesionBps, fatigueBps: state.fatigueBps }),
      // A force must stand somewhere. A retreat with nowhere to go is a force
      // that could not get away, not a force that ceased to exist.
      ...(retreat?.toProvinceId == null ? {} : { locationId: retreat.toProvinceId, positionId: null }),
      history: history.slice(-64),
    };
  });

  // Death is final, and a commander who dies in the field dies for good
  // (VISION §12's consequences are not reversible).
  const characters = world.characters.map((character) => {
    const change = result.commanderChanges.find((candidate) => candidate.characterId === character.id);
    if (change === undefined || change.outcome !== "killed") return character;
    return { ...character, alive: false, diedAtStep: atStep };
  });

  const provinces = world.map.provinces.map((province) => {
    const change = result.siegeAndControlChanges.find((candidate) => candidate.provinceId === province.id);
    if (change === undefined) return province;
    return { ...province, controllerPolityId: change.newControllerPolityId };
  });

  return { ...world, characters, map: { ...world.map, provinces }, material: { ...world.material, forces } };
}

/** What a battle leaves in the record. A battle is never a secret. */
function factsFor(world: WorldState, result: BattleResult, provinceId: string, index: number): FactProposal[] {
  const names = new Map(world.material.forces.map((force) => [force.id, force.name]));
  const provinceName = world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
  const facts: FactProposal[] = [
    {
      localId: `battle_${index}`,
      kind: "battle",
      summary: summarizeBattleResult(result, names, provinceName).slice(0, 600),
      affectedRefs: [
        { kind: "province", id: provinceId },
        ...result.participantIds.map((forceId) => ({ kind: "force" as const, id: forceId })),
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      // Armies meeting in the field is the kind of thing a reign is remembered
      // for, and an inconclusive one still cost men.
      significance: result.outcome === "inconclusive" ? 75 : 90,
    },
  ];

  for (const change of result.commanderChanges) {
    if (change.outcome === "unharmed") continue;
    const commander = world.characters.find((character) => character.id === change.characterId);
    facts.push({
      localId: `commander_${index}_${change.characterId}`,
      kind: change.outcome === "killed" ? "character_death" : `commander_${change.outcome}`,
      summary: `${commander?.name ?? change.characterId} was ${change.outcome} at ${provinceName}.`,
      affectedRefs: [{ kind: "character", id: change.characterId }, { kind: "province", id: provinceId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: change.outcome === "killed" ? 95 : 70,
    });
  }

  for (const change of result.siegeAndControlChanges) {
    const held = world.map.provinces.find((province) => province.id === change.provinceId)?.controllerPolityId ?? null;
    const taken = world.map.polities.find((polity) => polity.id === change.newControllerPolityId);
    // A beaten defender who keeps the ground has not lost it. Saying "Boii
    // passed to Boii" reads as nonsense in a Chronicle and is also untrue.
    const changedHands = change.newControllerPolityId !== held;
    facts.push({
      localId: `ground_${index}_${change.provinceId}`,
      kind: changedHands ? "province_control_change" : "province_control_weakened",
      summary: changedHands
        ? `${provinceName} passed to ${taken?.name ?? "no one"}. ${change.explanation}`
        : `${taken?.name ?? "Its holders"} still hold ${provinceName}, but less firmly. ${change.explanation}`,
      affectedRefs: [
        { kind: "province", id: change.provinceId },
        ...(change.newControllerPolityId === null ? [] : [{ kind: "polity" as const, id: change.newControllerPolityId }]),
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: changedHands ? 85 : 45,
    });
  }

  for (const refusal of result.rejectedTactics) {
    facts.push({
      localId: `tactic_${index}_${refusal.actorId}`,
      kind: "tactic_refused",
      summary: `The attempt failed before it began: ${refusal.reason}`,
      affectedRefs: [{ kind: "character", id: refusal.actorId }],
      // Only the man who tried it knows it did not work.
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      significance: 10,
    });
  }

  return facts;
}

/**
 * Resolves one engagement and returns the world after it, with what the world
 * now knows. The two forces must already stand in the same province: getting
 * them there is movement, which is somebody's decision, not a battle's.
 */
export function resolveEngagement(input: EngagementInput, index: number): EngagementResult {
  const { world, attacker, defender } = input;
  const province = world.map.provinces.find((candidate) => candidate.id === attacker.locationId);
  if (province === undefined) return { world, facts: [] };

  const tacticalProposals: TacticalModifierProposal[] = input.tactic === null
    ? []
    : [
      {
        battleId: input.battleId,
        actorId: attacker.commanderCharacterId,
        factor: input.tactic.factor,
        magnitude: input.tactic.magnitude,
        phases: ["contact"],
        preconditions: [],
        costs: [],
        rationale: input.tactic.rationale,
      },
    ];

  const result = resolveBattle(
    {
      battle: {
        battleId: input.battleId,
        provinceId: province.id,
        startedAtStep: world.elapsedStep,
        participants: [
          { forceId: attacker.id, side: "attacker", arrivesAtPhase: "contact" },
          { forceId: defender.id, side: "defender", arrivesAtPhase: "contact" },
        ],
      },
      participants: [
        { forceId: attacker.id, side: "attacker", force: attacker, commander: commanderOf(world, attacker), posture: input.posture },
        { forceId: defender.id, side: "defender", force: defender, commander: commanderOf(world, defender), posture: "defend" },
      ],
      province,
      provinceMaterial: world.material.provinceMaterial.find((material) => material.provinceId === province.id) ?? null,
      adjacentProvinceIds: neighboursOf(world, province.id),
      warfareRules: input.warfare,
      tacticalProposals,
      structures: world.structures.filter((structure) => structure.provinceId === province.id),
    },
    input.seed,
  );

  return {
    world: applyResult(world, result, world.elapsedStep),
    facts: factsFor(world, result, province.id, index),
  };
}
