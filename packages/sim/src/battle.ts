import {
  INJURIES,
  applyInjury,
  boundedId,
  chestOf,
  stableHash,
  findPosition,
  resolveBattle,
  sackTheProvince,
  takeTheChest,
  summarizeBattleResult,
  terrainDefenseBps,
  warfareWith,
  type BattlePosture,
  type BattleResult,
  type Character,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type TacticalModifierProposal,
  type TacticalPremise,
  type WorldState,
} from "@chronica/shared";
import { killCharacter } from "./mortality";

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
  /** Other armies on the attacking side, already standing in the same province. */
  readonly attackerAllies?: readonly Force[];
  /** Other armies on the defending side, already standing in the same province. */
  readonly defenderAllies?: readonly Force[];
  readonly posture: BattlePosture;
  readonly tactic: {
    readonly factor: TacticalModifierProposal["factor"];
    readonly magnitude: "minor" | "meaningful";
    readonly rationale: string;
    readonly restsOn?: readonly TacticalPremise[] | undefined;
  } | null;
  /**
   * The plan the side being attacked already had (`Force.battlePlan`), judged
   * exactly as the attacker's is, from the defenders' side of the field.
   */
  readonly defenderTactic?: EngagementInput["tactic"];
  /**
   * The engine's own tactic, not the author's: an ambush that springs. Taken as
   * given, because the engine decided it -- premises are how an author's claim
   * is checked, and there is no author here to check.
   */
  readonly engineTactic?: boolean;
  /** The attackers come down off ground they already held -- the ambush from the pass. */
  readonly attackerFromPosition?: boolean;
  readonly warfare: ScenarioWarfareRules;
  readonly battleId: string;
  readonly seed: string;
}

export interface EngagementResult {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  /** The fight itself, for whoever writes it up. Absent when no battle happened. */
  readonly account?: BattleAccount | undefined;
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
 *
 * It also settles the spoils, which is the one thing here the resolver does
 * not compute: ground that changed hands is plundered by the army that took
 * it, and a beaten army's pay chest goes to whoever beat it. What was taken
 * comes back out so the Chronicle can say so.
 */
export interface SpoilsTaken {
  readonly kind: "province" | "chest";
  /** The province sacked, or the force whose chest was taken. */
  readonly ofId: string;
  readonly byForceId: string | null;
  readonly byPolityId: string;
  readonly amount: number;
}

/**
 * What became of the named men in the ranks.
 *
 * Only commanders used to roll for their fate, because an army had nobody else
 * in it: a player serving as a legionary could not be hurt in the battle his
 * legion lost. Each member now shares his own force's losses -- dead as often
 * as the men around him died, wounded as often as they were -- by a roll of
 * his own, hashed from the battle and his name so a replay goes the same way.
 * A share of the wounded are maimed, which is a man's body keeping the
 * battle.
 */
export interface MemberFate {
  readonly forceId: string;
  readonly characterId: string;
  readonly outcome: "killed" | "maimed" | "wounded" | "unharmed";
  readonly injuryId: string | null;
}

/** Of a force's wounded, the share whose wounds are a maiming. */
const MAIMED_SHARE = 0.3;

export function memberFates(world: WorldState, result: BattleResult): MemberFate[] {
  const fates: MemberFate[] = [];
  for (const forceId of result.participantIds) {
    const force = world.material.forces.find((candidate) => candidate.id === forceId);
    if (force === undefined || force.memberCharacterIds.length === 0) continue;
    const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
    if (fit <= 0) continue;
    const losses = result.casualties.filter((casualty) => casualty.forceId === forceId);
    const deadRate = losses.reduce((sum, casualty) => sum + casualty.dead, 0) / fit;
    const woundedRate = losses.reduce((sum, casualty) => sum + casualty.wounded, 0) / fit;
    for (const characterId of force.memberCharacterIds) {
      const member = world.characters.find((character) => character.id === characterId);
      if (member === undefined || !member.alive || characterId === force.commanderCharacterId) continue;
      const roll = stableHash([result.battleId, forceId, characterId, "fate"]) / 0x1_0000_0000;
      if (roll < deadRate) {
        fates.push({ forceId, characterId, outcome: "killed", injuryId: null });
      } else if (roll < deadRate + woundedRate) {
        const maimed = stableHash([result.battleId, characterId, "maimed"]) / 0x1_0000_0000 < MAIMED_SHARE;
        const injury = maimed ? INJURIES[stableHash([result.battleId, characterId, "injury"]) % INJURIES.length] ?? null : null;
        fates.push({ forceId, characterId, outcome: injury === null ? "wounded" : "maimed", injuryId: injury?.id ?? null });
      } else {
        fates.push({ forceId, characterId, outcome: "unharmed", injuryId: null });
      }
    }
  }
  return fates;
}

function applyResult(world: WorldState, result: BattleResult, atStep: number, members: readonly MemberFate[]): { world: WorldState; spoils: SpoilsTaken[] } {
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
          id: boundedId(result.battleId, force.id, casualty.categoryId, "dead"),
          atStep,
          kind: "battle_death" as const,
          categoryId: casualty.categoryId,
          count: casualty.dead,
          causeId: result.battleId,
        })),
      ...result.casualties
        .filter((casualty) => casualty.forceId === force.id && casualty.deserted > 0)
        .map((casualty) => ({
          id: boundedId(result.battleId, force.id, casualty.categoryId, "deserted"),
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

  // Being taken, and being carried off the field alive, were both computed by
  // the resolver and both thrown away: a captured consul went on sitting in
  // the Senate and a wounded one was as fit next week as the week before.
  const characters = world.characters.map((character) => {
    const fate = members.find((candidate) => candidate.characterId === character.id);
    if (fate !== undefined && (fate.outcome === "wounded" || fate.outcome === "maimed")) {
      const injury = fate.injuryId === null ? undefined : INJURIES.find((candidate) => candidate.id === fate.injuryId);
      const hurt = injury === undefined ? character : applyInjury(character, injury);
      return {
        ...hurt,
        healthBps: Math.max(500, hurt.healthBps - 3_000),
        disqualifyingStatuses: hurt.disqualifyingStatuses.includes("wounded")
          ? hurt.disqualifyingStatuses
          : [...hurt.disqualifyingStatuses, "wounded"].slice(0, 8),
      };
    }
    const change = result.commanderChanges.find((candidate) => candidate.characterId === character.id);
    if (change === undefined || change.outcome === "killed" || change.outcome === "unharmed") return character;
    const status = change.outcome === "captured" ? "captured" : "wounded";
    return {
      ...character,
      healthBps: Math.max(500, character.healthBps - (change.outcome === "captured" ? 1_000 : 3_000)),
      disqualifyingStatuses: character.disqualifyingStatuses.includes(status)
        ? character.disqualifyingStatuses
        : [...character.disqualifyingStatuses, status].slice(0, 8),
    };
  });
  const killed = [
    ...result.commanderChanges.filter((change) => change.outcome === "killed").map((change) => change.characterId),
    ...members.filter((fate) => fate.outcome === "killed").map((fate) => fate.characterId),
  ];

  const provinces = world.map.provinces.map((province) => {
    const change = result.siegeAndControlChanges.find((candidate) => candidate.provinceId === province.id);
    if (change === undefined) return province;
    return { ...province, controllerPolityId: change.newControllerPolityId };
  });

  // Death in battle is the one death the engine takes at once -- for the
  // player too -- because the battle is its own foreshadowing. It goes through
  // the same door as every other death, so the seat is vacated, the army is
  // handed to somebody living, and the estate is settled. Letting it write
  // `alive: false` itself left a dead man commanding his own legion, because
  // `commanderCharacterId` is not nullable and nothing here reassigned it.
  let next: WorldState = { ...world, characters, map: { ...world.map, provinces }, material: { ...world.material, forces } };

  // ── The spoils ──────────────────────────────────────────────────────────
  //
  // Who won, by force rather than by role: `outcome` names the side, and
  // `attackerForceIds` is what says which army was on it.
  const attacking = new Set(result.attackerForceIds);
  const victors = result.outcome === "inconclusive"
    ? []
    : result.participantIds.filter((id) => attacking.has(id) === (result.outcome === "attacker_victory"));
  const beaten = result.outcome === "inconclusive"
    ? []
    : result.participantIds.filter((id) => !victors.includes(id));
  const polityOf = (forceId: string): string | null =>
    next.material.forces.find((force) => force.id === forceId)?.polityId ?? null;

  const spoils: SpoilsTaken[] = [];

  // Ground taken is ground plundered. Only where it actually changed hands: a
  // beaten defender who keeps the field has not had his province sacked.
  for (const change of result.siegeAndControlChanges) {
    const before = world.map.provinces.find((province) => province.id === change.provinceId)?.controllerPolityId ?? null;
    if (change.newControllerPolityId === null || change.newControllerPolityId === before) continue;
    const taker = victors.find((id) => polityOf(id) === change.newControllerPolityId) ?? null;
    const sack = sackTheProvince(next, {
      provinceId: change.provinceId,
      takerPolityId: change.newControllerPolityId,
      takingForceId: taker,
      atStep,
      cause: { kind: "battle_result", id: result.battleId, explanation: change.explanation },
      transactionId: boundedId(result.battleId, "spoils", change.provinceId),
    });
    next = sack.world;
    if (sack.taken > 0) {
      spoils.push({ kind: "province", ofId: change.provinceId, byForceId: taker, byPolityId: change.newControllerPolityId, amount: sack.taken });
    }
  }

  // And the loser's own war chest, which is what `force_pay_chest` was always
  // for. An army paid out of what it takes carries its wages with it, and
  // loses them with the field.
  for (const loserId of beaten) {
    if (chestOf(next, loserId) === null) continue;
    const victorId = victors[0] ?? null;
    const victorPolityId = victorId === null ? null : polityOf(victorId);
    if (victorPolityId === null) continue;
    // Never off your own side. A power's two armies can end up on opposite
    // sides of a field -- a mutiny, a usurper, a legion that will not stand
    // down -- and the winner beating the loser is not the winner robbing his
    // own treasury. Taking a fellow army's wages is a political act somebody
    // has to order, not something a battle does by itself.
    if (polityOf(loserId) === victorPolityId) continue;
    const captured = takeTheChest(next, {
      beatenForceId: loserId,
      victorForceId: victorId,
      victorPolityId,
      atStep,
      cause: { kind: "battle_result", id: result.battleId, explanation: "Taken with the field." },
      transactionId: boundedId(result.battleId, "chest", loserId),
    });
    next = captured.world;
    if (captured.taken > 0) {
      spoils.push({ kind: "chest", ofId: loserId, byForceId: victorId, byPolityId: victorPolityId, amount: captured.taken });
    }
  }

  for (const characterId of killed) {
    // The facts are `factsFor`'s: a commander killed at Agrigentum is written
    // as that and not as "died of natural causes".
    next = killCharacter(next, characterId, "Killed in the field.", atStep).world;
  }
  return { world: next, spoils };
}

/** What a battle leaves in the record. A battle is never a secret. */
function factsFor(world: WorldState, result: BattleResult, provinceId: string, index: number, members: readonly MemberFate[]): FactProposalDraft[] {
  const names = new Map(world.material.forces.map((force) => [force.id, force.name]));
  const provinceName = world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
  const facts: FactProposalDraft[] = [
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

  // A man in the ranks who fell or was carried off. Known to his own side,
  // not proclaimed: the city hears a consul fell, not that a legionary did.
  for (const fate of members) {
    if (fate.outcome === "unharmed") continue;
    const member = world.characters.find((character) => character.id === fate.characterId);
    const army = world.material.forces.find((force) => force.id === fate.forceId);
    const forceName = army?.name ?? fate.forceId;
    const armyPolity = army?.polityId;
    const injury = fate.injuryId === null ? undefined : INJURIES.find((candidate) => candidate.id === fate.injuryId);
    const what = fate.outcome === "killed" ? "was killed" : injury !== undefined ? `${injury.label}` : "was wounded";
    facts.push({
      localId: `member_${index}_${fate.characterId}`,
      kind: fate.outcome === "killed" ? "character_death" : `soldier_${fate.outcome}`,
      summary: `${member?.name ?? fate.characterId}, in the ranks of ${forceName}, ${what} at ${provinceName}.`,
      // Named with his army's power: a polity fact is known to those whose
      // polity it names, and without it nobody at all would hear of him.
      affectedRefs: [
        { kind: "character", id: fate.characterId },
        { kind: "force", id: fate.forceId },
        { kind: "province", id: provinceId },
        ...(armyPolity === undefined ? [] : [{ kind: "polity" as const, id: armyPolity }]),
      ],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: fate.outcome === "killed" ? 70 : 50,
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
 * What was carried off, for the record.
 *
 * Money moving is not by itself history -- the ledger holds every transfer and
 * the Chronicle holds none of them. A city stripped and an army's wages taken
 * on the field are both history, and both are things the people they happened
 * to would talk about for a generation.
 */
function spoilsFacts(world: WorldState, spoils: readonly SpoilsTaken[], index: number): FactProposalDraft[] {
  const name = (id: string, kind: "province" | "force" | "polity"): string => {
    if (kind === "province") return world.map.provinces.find((province) => province.id === id)?.name ?? id;
    if (kind === "force") return world.material.forces.find((force) => force.id === id)?.name ?? id;
    return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  };
  return spoils.map((taken, order) => {
    const by = taken.byForceId === null ? name(taken.byPolityId, "polity") : name(taken.byForceId, "force");
    return taken.kind === "province"
      ? {
        localId: `spoils_${index}_${order}`,
        kind: "province_plundered",
        summary: `${by} carried ${taken.amount} out of ${name(taken.ofId, "province")}, and left it the poorer for it.`,
        affectedRefs: [
          { kind: "province" as const, id: taken.ofId },
          ...(taken.byForceId === null ? [] : [{ kind: "force" as const, id: taken.byForceId }]),
        ],
        visibility: "public" as const,
        discoveryState: "public" as const,
        knowableInDays: 0,
        // A sacked city is remembered by the people it was done to long after
        // the battle that preceded it.
        significance: 80,
      }
      : {
        localId: `spoils_${index}_${order}`,
        kind: "war_chest_taken",
        summary: `${by} took ${taken.amount} from the pay chest of ${name(taken.ofId, "force")}.`,
        affectedRefs: [
          { kind: "force" as const, id: taken.ofId },
          ...(taken.byForceId === null ? [] : [{ kind: "force" as const, id: taken.byForceId }]),
        ],
        visibility: "public" as const,
        discoveryState: "public" as const,
        knowableInDays: 0,
        // An army that has lost its wages is an army about to find out whether
        // anybody else has undertaken to pay it.
        significance: 65,
      };
  });
}

/**
 * Resolves one engagement and returns the world after it, with what the world
 * now knows. The two forces must already stand in the same province: getting
 * them there is movement, which is somebody's decision, not a battle's.
 */

/**
 * What actually happened in a battle, for somebody to write it up.
 *
 * `resolveBattle` computes the shape of a fight in detail: five phases with
 * their own summaries and the effective strength on each side at each,
 * the tactics tried and the tactics refused and why, casualties by force and by
 * kind, who broke and where they ran to, and what became of each commander.
 * All of it was collapsed into one summary line of at most six hundred
 * characters and discarded.
 *
 * That was tolerable while a battle was one line of a report. It stopped being
 * tolerable the moment the player could die in one: a death has to be earned by
 * the account of the fight that caused it, and "the defender prevails" earns
 * nothing. So the account travels to the Chronicle beside the facts, on exactly
 * the pattern accounts and quotations already use -- tied to fact ids, and
 * therefore gated by the same visibility rules without needing its own.
 */
export interface BattleAccount {
  /** The facts this is an account of. It publishes only where one of them does. */
  readonly factIds: readonly string[];
  readonly provinceName: string;
  /** Who attacked, who defended, and what each was worth going in. */
  readonly sides: readonly { readonly name: string; readonly attacking: boolean; readonly strength: number; readonly commander: string }[];
  /** The fight in order, with the weight on each side as it shifted. */
  readonly phases: readonly { readonly phase: string; readonly summary: string; readonly attacker: number; readonly defender: number }[];
  /** What was tried out of the ordinary, and what the ground would not allow. */
  readonly tactics: readonly string[];
  readonly refusedTactics: readonly string[];
  /** Dead, deserted and wounded, by force. */
  readonly losses: readonly { readonly name: string; readonly dead: number; readonly deserted: number; readonly wounded: number }[];
  readonly commanders: readonly { readonly name: string; readonly outcome: string }[];
  /** Named men in the ranks, and what became of each -- including those who came through. */
  readonly members: readonly { readonly name: string; readonly force: string; readonly outcome: string }[];
  readonly retreats: readonly { readonly name: string; readonly to: string | null; readonly orderly: boolean }[];
  readonly outcome: string;
}

function accountOf(world: WorldState, result: BattleResult, provinceId: string, factIds: readonly string[], members: readonly MemberFate[]): BattleAccount {
  const forceName = (id: string): string => world.material.forces.find((force) => force.id === id)?.name ?? id;
  const characterName = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const attacking = new Set(result.attackerForceIds);

  const lossesByForce = new Map<string, { dead: number; deserted: number; wounded: number }>();
  for (const casualty of result.casualties) {
    const held = lossesByForce.get(casualty.forceId) ?? { dead: 0, deserted: 0, wounded: 0 };
    lossesByForce.set(casualty.forceId, {
      dead: held.dead + casualty.dead,
      deserted: held.deserted + casualty.deserted,
      wounded: held.wounded + casualty.wounded,
    });
  }

  return {
    factIds,
    provinceName: provinceName(provinceId),
    sides: result.participantIds.map((forceId) => {
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      return {
        name: forceName(forceId),
        attacking: attacking.has(forceId),
        strength: force?.personnel.reduce((sum, category) => sum + category.fit, 0) ?? 0,
        commander: force === undefined ? "nobody" : characterName(force.commanderCharacterId),
      };
    }),
    phases: result.phases.map((phase) => ({
      phase: phase.phase,
      summary: phase.summary,
      attacker: phase.attackerEffectiveStrength,
      defender: phase.defenderEffectiveStrength,
    })),
    tactics: result.acceptedTactics.map((tactic) => `${characterName(tactic.actorId)} tried ${tactic.factor} (${tactic.magnitude}): ${tactic.rationale}`),
    refusedTactics: result.rejectedTactics.map((rejected) => `${characterName(rejected.actorId)} could not: ${rejected.reason}`),
    losses: [...lossesByForce.entries()].map(([forceId, losses]) => ({ name: forceName(forceId), ...losses })),
    commanders: result.commanderChanges
      .filter((change) => change.outcome !== "unharmed")
      .map((change) => ({ name: characterName(change.characterId), outcome: change.outcome })),
    members: members.map((fate) => ({
      name: characterName(fate.characterId),
      force: forceName(fate.forceId),
      outcome: fate.injuryId === null ? fate.outcome : INJURIES.find((injury) => injury.id === fate.injuryId)?.label ?? fate.outcome,
    })),
    retreats: result.retreats.map((retreat) => ({
      name: forceName(retreat.forceId),
      to: retreat.toProvinceId === null ? null : provinceName(retreat.toProvinceId),
      orderly: retreat.orderly,
    })),
    outcome: result.outcome,
  };
}

/** What a victory is worth to the man who won it, and a defeat costs the man who lost it. */
const VICTORY_STANDING_BPS = 400;

/**
 * A battle moves the standing of the men who led it.
 *
 * Standing is what a Roman election is counted on, and nothing in the world
 * could raise it: a consul who beat the Carthaginians came home exactly as
 * electable as he left. Commanders on the winning side gain, the losing side's
 * lose; an inconclusive day moves nobody.
 */
function withStandingFromTheField(world: WorldState, result: BattleResult, attackers: readonly Force[], defenders: readonly Force[]): WorldState {
  if (result.outcome === "inconclusive") return world;
  const [won, lost] = result.outcome === "attacker_victory" ? [attackers, defenders] : [defenders, attackers];
  const winners = new Set(won.map((force) => force.commanderCharacterId));
  const losers = new Set(lost.map((force) => force.commanderCharacterId));
  const clamp = (value: number): number => Math.max(0, Math.min(10_000, value));
  return {
    ...world,
    characters: world.characters.map((character) => {
      if (!character.alive) return character;
      if (winners.has(character.id)) return { ...character, prestigeBps: clamp(character.prestigeBps + VICTORY_STANDING_BPS) };
      if (losers.has(character.id)) return { ...character, prestigeBps: clamp(character.prestigeBps - VICTORY_STANDING_BPS) };
      return character;
    }),
  };
}

/**
 * How much of a plan the field bears out.
 *
 * Each premise the plan names is checked against the world as it stands; what
 * the author wrote about it is not evidence. Nothing true refuses the plan, one
 * true thing makes it minor, and two or more let it be what was asked. A plan
 * that names nothing is judged as naming nothing.
 */
export function judgeTactic(
  world: WorldState,
  province: WorldState["map"]["provinces"][number],
  attackers: readonly Force[],
  defenders: readonly Force[],
  restsOn: readonly TacticalPremise[],
  warfare: ScenarioWarfareRules,
): { readonly borneOut: readonly TacticalPremise[]; readonly notBorneOut: readonly TacticalPremise[] } {
  const rules = warfareWith(world, warfare);
  const categoryOf = (id: string) => rules.troopCategories.find((category) => category.id === id);
  const heads = (forces: readonly Force[]): number =>
    forces.reduce((sum, force) => sum + force.personnel.reduce((men, category) => men + category.fit, 0), 0);
  const fast = (forces: readonly Force[]): number =>
    forces.reduce((sum, force) => sum + force.personnel
      .filter((category) => (categoryOf(category.categoryId)?.mobilityBps ?? 5_000) >= 8_000)
      .reduce((men, category) => men + category.fit, 0), 0);
  const meanMobility = (forces: readonly Force[]): number => {
    const total = heads(forces);
    if (total === 0) return 0;
    return forces.reduce((sum, force) => sum + force.personnel
      .reduce((acc, category) => acc + category.fit * (categoryOf(category.categoryId)?.mobilityBps ?? 5_000), 0), 0) / total;
  };
  const positionOf = (force: Force) => (force.positionId === null ? undefined : findPosition(province, force.positionId));

  const holds: Record<TacticalPremise, () => boolean> = {
    scouted_ground: () => attackers.some((force) => force.positionId !== null),
    prepared_position: () => attackers.some((force) => (positionOf(force)?.combatModifierBps ?? 0) > 0),
    rough_ground: () => terrainDefenseBps(province.terrainId) > 0 && meanMobility(attackers) > meanMobility(defenders),
    superior_horse: () => fast(attackers) > fast(defenders),
    second_force: () => attackers.length > 1,
    numbers: () => heads(attackers) >= heads(defenders) * 1.25,
  };
  const claimed = [...new Set(restsOn)];
  return {
    borneOut: claimed.filter((premise) => holds[premise]()),
    notBorneOut: claimed.filter((premise) => !holds[premise]()),
  };
}

const PREMISE_IN_WORDS: Record<TacticalPremise, string> = {
  scouted_ground: "ground scouted and taken up in advance",
  prepared_position: "a position worth holding",
  rough_ground: "broken country that slows the enemy more than his own men",
  superior_horse: "more horse than the enemy",
  second_force: "a second army coming in on the flank",
  numbers: "the greater numbers",
};

export function resolveEngagement(input: EngagementInput, index: number): EngagementResult {
  const { world, attacker, defender } = input;
  const province = world.map.provinces.find((candidate) => candidate.id === attacker.locationId);
  if (province === undefined) return { world, facts: [] };
  const attackers = [attacker, ...(input.attackerAllies ?? []).filter((force) => force.id !== attacker.id && force.id !== defender.id)];
  const defenders = [defender, ...(input.defenderAllies ?? []).filter((force) => !attackers.some((ally) => ally.id === force.id) && force.id !== defender.id)];

  // What the plan was worth, decided from the field and not from the prose.
  const preRejected: { actorId: string; reason: string }[] = [];
  let tactic: EngagementInput["tactic"] = input.tactic;
  if (tactic !== null && input.engineTactic !== true) {
    const judged = judgeTactic(world, province, attackers, defenders, tactic.restsOn ?? [], input.warfare);
    const missing = judged.notBorneOut.map((premise) => PREMISE_IN_WORDS[premise]);
    if (judged.borneOut.length === 0) {
      preRejected.push({
        actorId: attacker.commanderCharacterId,
        reason: missing.length === 0
          ? "the plan rested on nothing the field could bear out."
          : `the plan rested on ${missing.join(", ")}, and the field showed none of it.`,
      });
      tactic = null;
    } else if (judged.borneOut.length === 1 && tactic.magnitude === "meaningful") {
      tactic = { ...tactic, magnitude: "minor", rationale: `${tactic.rationale} (Only ${PREMISE_IN_WORDS[judged.borneOut[0]!]} bore it out.)`.slice(0, 600) };
    }
  }

  // And the defender's, which he laid before anybody came: the same test from
  // the other side of the field, so a fortified ford counts for the men
  // holding it and "the greater numbers" means the defenders' numbers.
  let defenderTactic: EngagementInput["tactic"] = input.defenderTactic ?? null;
  if (defenderTactic !== null) {
    const judged = judgeTactic(world, province, defenders, attackers, defenderTactic.restsOn ?? [], input.warfare);
    const missing = judged.notBorneOut.map((premise) => PREMISE_IN_WORDS[premise]);
    if (judged.borneOut.length === 0) {
      preRejected.push({
        actorId: defender.commanderCharacterId,
        reason: missing.length === 0
          ? "the plan rested on nothing the field could bear out."
          : `the plan rested on ${missing.join(", ")}, and the field showed none of it.`,
      });
      defenderTactic = null;
    } else if (judged.borneOut.length === 1 && defenderTactic.magnitude === "meaningful") {
      defenderTactic = { ...defenderTactic, magnitude: "minor", rationale: `${defenderTactic.rationale} (Only ${PREMISE_IN_WORDS[judged.borneOut[0]!]} bore it out.)`.slice(0, 600) };
    }
  }

  const proposalFor = (plan: NonNullable<EngagementInput["tactic"]>, actorId: string): TacticalModifierProposal => ({
    battleId: input.battleId,
    actorId,
    factor: plan.factor,
    magnitude: plan.magnitude,
    phases: ["contact"],
    preconditions: [],
    costs: [],
    rationale: plan.rationale,
  });
  const tacticalProposals: TacticalModifierProposal[] = [
    ...(tactic === null ? [] : [proposalFor(tactic, attacker.commanderCharacterId)]),
    ...(defenderTactic === null ? [] : [proposalFor(defenderTactic, defender.commanderCharacterId)]),
  ];

  const resolved = resolveBattle(
    {
      battle: {
        battleId: input.battleId,
        provinceId: province.id,
        startedAtStep: world.elapsedStep,
        participants: [
          ...attackers.map((force) => ({ forceId: force.id, side: "attacker" as const, arrivesAtPhase: "contact" as const })),
          ...defenders.map((force) => ({ forceId: force.id, side: "defender" as const, arrivesAtPhase: "contact" as const })),
        ],
      },
      participants: [
        ...attackers.map((force) => ({
          forceId: force.id,
          side: "attacker" as const,
          force,
          commander: commanderOf(world, force),
          posture: input.posture,
          fightsFromPosition: input.attackerFromPosition === true && force.positionId !== null,
        })),
        ...defenders.map((force) => ({ forceId: force.id, side: "defender" as const, force, commander: commanderOf(world, force), posture: "defend" as const })),
      ],
      province,
      provinceMaterial: world.material.provinceMaterial.find((material) => material.provinceId === province.id) ?? null,
      adjacentProvinceIds: neighboursOf(world, province.id),
      warfareRules: warfareWith(world, input.warfare),
      tacticalProposals,
      structures: world.structures.filter((structure) => structure.provinceId === province.id),
    },
    input.seed,
  );
  const result: BattleResult = preRejected.length === 0
    ? resolved
    : { ...resolved, rejectedTactics: [...preRejected, ...resolved.rejectedTactics] };

  const members = memberFates(world, result);
  const applied = applyResult(world, result, world.elapsedStep, members);
  const facts = [...factsFor(world, result, province.id, index, members), ...spoilsFacts(world, applied.spoils, index)];
  return {
    world: withStandingFromTheField(applied.world, result, attackers, defenders),
    facts,
    // Read from the world as it stood *before* the fight, so the strengths are
    // what each side brought to it rather than what survived it.
    account: accountOf(world, result, province.id, facts.map((fact) => fact.localId), members),
  };
}
