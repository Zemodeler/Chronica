import {
  moraleInWords,
  paperWeightedStrength,
  retreatRoute,
  warfareWith,
  type Engagement,
  type FactProposalDraft,
  type Force,
  type PlayerDecision,
  type ScenarioWarfareRules,
  type TurningPointKind,
  type WorldState,
} from "@chronica/shared";
import { stoodIdle } from "./engagements";

/**
 * The player's word at a turning point of a fight (docs/plans/battles-that-last.md, phase 3).
 *
 * A fight his army is in runs by itself, a round a day, until something happens
 * that his decision could change: battle offered to his camp, his line
 * wavering, his commander lost, the enemy reinforced, his bread gone. Then that
 * fight stands still (`engagement.awaiting`) and the report ends on the
 * question. His answer is taken at the start of the next report, the way the
 * man surrounded on a lost field is answered (`field-perils.ts`); a report that
 * begins without one keeps the course he was on.
 */

export const FIGHT_OPTION_PREFIX = "fight-";
const ACTIONS = ["fight", "refuse", "press", "hold", "fall_back", "join", "stay"] as const;
type FightAction = (typeof ACTIONS)[number];

const optionId = (action: FightAction): string => `${FIGHT_OPTION_PREFIX}${action.replace("_", "-")}`;
function actionOf(id: string | null | undefined): FightAction | null {
  if (id == null || !id.startsWith(FIGHT_OPTION_PREFIX)) return null;
  const action = id.slice(FIGHT_OPTION_PREFIX.length).replace("-", "_");
  return (ACTIONS as readonly string[]).includes(action) ? action as FightAction : null;
}

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const his = (force: Force, player: string): boolean => force.commanderCharacterId === player || force.controllerCharacterId === player;
const names = (forces: readonly Force[]): string => {
  const list = forces.map((force) => force.name);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

/** The fight that waits on this player's word, if one does. */
function awaitingFor(world: WorldState, player: string | null): { readonly engagement: Engagement; readonly mine: Force[]; readonly theirs: Force[] } | undefined {
  if (player === null) return undefined;
  for (const engagement of world.engagements) {
    if (engagement.status !== "open" || engagement.awaiting === null) continue;
    const onField = (id: string): Force | undefined => world.material.forces.find((force) => force.id === id && force.locationId === engagement.provinceId && fitOf(force) > 0);
    const attackers = engagement.attackerForceIds.map(onField).filter((force): force is Force => force !== undefined);
    const defenders = engagement.defenderForceIds.map(onField).filter((force): force is Force => force !== undefined);
    // An army of his standing by: his forces on that ground that are not in it.
    if (engagement.awaiting.kind === "ally_fighting") {
      const fighting = new Set([...engagement.attackerForceIds, ...engagement.defenderForceIds]);
      const bystanders = world.material.forces.filter((force) => force.locationId === engagement.provinceId && !fighting.has(force.id) && his(force, player) && fitOf(force) > 0);
      if (bystanders.length > 0) return { engagement, mine: bystanders, theirs: defenders };
      continue;
    }
    const [mine, theirs] = engagement.awaiting.side === "attacker" ? [attackers, defenders] : [defenders, attackers];
    if (mine.some((force) => his(force, player))) return { engagement, mine, theirs };
  }
  return undefined;
}

/** "About even", "twice their number": the one comparison a commander makes before anything else. */
function odds(mine: readonly Force[], theirs: readonly Force[], rules: ScenarioWarfareRules | undefined): string {
  const weigh = (side: readonly Force[]): number => side.reduce((sum, force) => sum + paperWeightedStrength(force, rules), 0);
  const ratio = weigh(mine) / Math.max(1, weigh(theirs));
  if (ratio >= 1.8) return "You have nearly twice their strength";
  if (ratio >= 1.15) return "You are the stronger";
  if (ratio > 0.87) return "The two sides are about even";
  if (ratio > 0.55) return "They are the stronger";
  return "They have nearly twice your strength";
}

const OPTIONS: Readonly<Record<TurningPointKind, readonly FightAction[]>> = {
  battle_offered: ["fight", "refuse", "fall_back"],
  wavering: ["press", "hold", "fall_back"],
  commander_lost: ["press", "hold", "fall_back"],
  reinforced: ["press", "hold", "fall_back"],
  hungry: ["fight", "refuse", "fall_back"],
  ally_fighting: ["join", "stay"],
};

/** The question the report ends on, when a fight of the player's is waiting on him. */
export function engagementDecision(world: WorldState, player: string | null, warfare?: ScenarioWarfareRules): PlayerDecision | undefined {
  const waiting = awaitingFor(world, player);
  if (waiting === undefined) return undefined;
  const { engagement, mine, theirs } = waiting;
  const kind = engagement.awaiting!.kind;
  const where = world.map.provinces.find((province) => province.id === engagement.provinceId)?.name ?? engagement.provinceId;
  const rules = warfare === undefined ? undefined : warfareWith(world, warfare);
  const morale = moraleInWords(Math.round(mine.reduce((sum, force) => sum + force.moraleBps, 0) / Math.max(1, mine.length)));
  const fed = mine.every((force) => force.provisionStatus === "provisioned") ? "fed" : mine.some((force) => force.provisionStatus === "critical") ? "starving" : "on short rations";
  const attacking = engagement.awaiting!.side === "attacker";
  const situation: Readonly<Record<TurningPointKind, string>> = {
    battle_offered: `${names(theirs)} ${theirs.length === 1 ? "is" : "are"} drawn up before your camp at ${where}, offering battle.`,
    wavering: `The day's fighting at ${where} has gone hard: your men are ${morale}.`,
    commander_lost: `Your side at ${where} has lost its commander, and ${names(theirs)} still ${theirs.length === 1 ? "holds" : "hold"} the field.`,
    reinforced: `Fresh troops have come onto the field at ${where}: ${names(theirs)} now ${theirs.length === 1 ? "stands" : "stand"} against you.`,
    hungry: `${names(mine)} ${mine.length === 1 ? "has" : "have"} eaten the bread ${mine.length === 1 ? "it" : "they"} carried at ${where}.`,
    ally_fighting: `Your own side is fighting ${names(theirs)} at ${where}, and ${names(mine)} ${mine.length === 1 ? "stands" : "stand"} by on the same ground.`,
  };
  const label: Readonly<Record<FightAction, string>> = {
    fight: attacking ? "Offer battle" : "Come out and fight",
    refuse: kind === "hungry" ? "Hold out" : "Keep to the camp",
    press: "Press on",
    hold: attacking ? "Break off and hold" : "Stand on the defensive",
    fall_back: "Fall back by night",
    join: "Join the fight",
    stay: "Stand aside",
  };
  const summary: Readonly<Record<FightAction, string>> = {
    fight: "Form the line and take the battle they offer. It is decided today, one way or the other.",
    refuse: kind === "hungry"
      ? "Keep to your lines and live on half rations while you can. Every day costs men and heart."
      : "Stay behind your rampart and let them wait. Your foragers will suffer, and the men will think you afraid.",
    press: "Keep the fight going as it stands.",
    hold: attacking ? "Stop attacking and stand where you are. If nobody on your side is still attacking, the fight ends here." : "Give no more battle than you must; defend the camp.",
    fall_back: "Leave the fires burning and slip away before dawn. The field is theirs, and so is your camp.",
    join: "March your men into the line beside them.",
    stay: "Keep your men out of it. Whatever the day brings, it will be remembered that you stood by.",
  };
  return {
    prompt: `${situation[kind]} ${odds(mine, theirs, rules)}; your men are ${morale} and ${fed}. What do you do?`.slice(0, 1_200),
    options: OPTIONS[kind].map((action) => ({ id: optionId(action), label: label[action], summary: summary[action] })),
  };
}

/**
 * The player's answer, taken at the start of the next report.
 *
 * No answer at all (he gave an order instead) keeps the course he was on: an
 * offer of battle is refused and anything else pressed. The fight is released
 * either way, so a report never ends twice on the same question.
 */
export function answerEngagement(world: WorldState, player: string | null, answeredOptionId: string | null, day: number): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const waiting = awaitingFor(world, player);
  if (waiting === undefined) return { world, facts: [] };
  const { engagement, mine, theirs } = waiting;
  const kind = engagement.awaiting!.kind;
  const chosen = actionOf(answeredOptionId);
  const action: FightAction = chosen !== null && OPTIONS[kind].includes(chosen) ? chosen : (kind === "battle_offered" || kind === "hungry" ? "refuse" : kind === "ally_fighting" ? "stay" : "press");
  const attacking = engagement.awaiting!.side === "attacker";
  const released: Engagement = {
    ...engagement,
    awaiting: null,
    // He answers for today: the fight goes on from here, not from the day it stopped.
    lastRoundStep: Math.max(engagement.lastRoundStep, day - 1),
    ...(action === "fight" ? (attacking ? { seeking: "battle" as const } : { playerStance: "fight" as const }) : {}),
    ...(action === "refuse" && !attacking ? { playerStance: "refuse" as const } : {}),
  };
  let next: WorldState = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id ? released : candidate)) };
  const facts: FactProposalDraft[] = [];
  const where = world.map.provinces.find((province) => province.id === engagement.provinceId)?.name ?? engagement.provinceId;

  if (action === "join") {
    next = { ...next, engagements: next.engagements.map((candidate) => (candidate.id === engagement.id
      ? { ...candidate, attackerForceIds: [...new Set([...candidate.attackerForceIds, ...mine.map((force) => force.id)])].slice(0, 16) }
      : candidate)) };
  }
  if (action === "stay") {
    const fighting = world.material.forces.find((force) => force.id === engagement.attackerForceIds[0]);
    if (fighting !== undefined) for (const bystander of mine) next = stoodIdle(next, bystander, fighting, false, day, engagement.id);
  }
  if (action === "hold") {
    const holding = new Set(mine.map((force) => force.id));
    next = { ...next, material: { ...next.material, forces: next.material.forces.map((force) => (holding.has(force.id) ? { ...force, hold: true } : force)) } };
  }
  if (action === "fall_back") {
    const to = retreatRoute(next, mine[0]!, engagement.provinceId, new Set(theirs.map((force) => force.polityId)));
    if (to !== null) {
      const going = new Set(mine.map((force) => force.id));
      next = {
        ...next,
        material: { ...next.material, forces: next.material.forces.map((force) => (going.has(force.id) ? { ...force, locationId: to, positionId: null, fatigueBps: Math.min(10_000, force.fatigueBps + 1_000) } : force)) },
        engagements: next.engagements.map((candidate) => (candidate.id === engagement.id
          ? { ...candidate, status: "ended" as const, endedBy: "withdrew" as const, winner: attacking ? "defender" as const : "attacker" as const, endedAtStep: day }
          : candidate)),
      };
      const toName = world.map.provinces.find((province) => province.id === to)?.name ?? to;
      facts.push({
        localId: `fell_back_${engagement.id}_${day}`.slice(0, 60),
        kind: "force_withdrew",
        summary: `${names(mine)} left ${mine.length === 1 ? "its" : "their"} fires burning at ${where} and slipped away by night into ${toName}, leaving the field to ${names(theirs)}.`.slice(0, 600),
        affectedRefs: [{ kind: "province", id: engagement.provinceId }, { kind: "province", id: to }, ...[...mine, ...theirs].slice(0, 6).map((force) => ({ kind: "force" as const, id: force.id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 60,
      });
    }
  }
  return { world: next, facts };
}
