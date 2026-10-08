import {
  aptitude,
  fitStrengthOf,
  stableHash,
  warfareWith,
  type Character,
  type Force,
  type ScenarioWarfareRules,
  type TacticalPremise,
  type WorldState,
} from "@chronica/shared";
import { judgeTactic } from "./battle";
import { acceptsBattle, canRefuse } from "./engagements";

/**
 * The plan a general takes into a battle, chosen by rule (docs/plans/war-plans.md).
 *
 * The engine had a place for a plan of battle from the first (`Force.battlePlan`, `force_engage.tactic`,
 * `judgeTactic`) and the rules never wrote one: every army the rules led went into every field with
 * nothing in mind. Here a general looks at the ground and at the two armies and claims what the field
 * itself will bear out -- the horse he has more of, the broken country that slows the enemy more than
 * his own, the position he has taken up, the numbers -- and nothing else. `judgeTactic` weighs each
 * claim against the field again when the battle is fought, so a plan cannot be worth more than the
 * field shows, and the engine's own cap on what a plan may add is the same for everybody.
 */

export type BattlePlan = NonNullable<Force["battlePlan"]>;

const ALL_PREMISES: readonly TacticalPremise[] = ["scouted_ground", "prepared_position", "rough_ground", "superior_horse", "second_force", "numbers"];

const IN_WORDS: Record<TacticalPremise, string> = {
  scouted_ground: "the ground scouted and taken up beforehand",
  prepared_position: "a position worth holding",
  rough_ground: "the broken country, which slows the enemy more than his own men",
  superior_horse: "the greater strength in horse",
  second_force: "a second army on the flank",
  numbers: "the greater numbers",
};

/** What a general is: how bold, how careful, how good at it. */
export interface Temper {
  readonly bold: number;
  readonly careful: number;
  readonly skill: number;
  readonly logistics: number;
  readonly cruel: number;
}

export function temperOf(commander: Character | undefined): Temper {
  if (commander === undefined) return { bold: 50, careful: 50, skill: 50, logistics: 50, cruel: 50 };
  return {
    bold: commander.mind.temperament.boldness,
    careful: commander.mind.temperament.caution,
    skill: aptitude(commander, "strategist"),
    logistics: aptitude(commander, "logistics"),
    cruel: commander.mind.temperament.cruelty,
  };
}

/**
 * The plan this side takes into the field at `provinceId`, or null where the field bears none out.
 * `own` is the side choosing; `enemy` the army it expects (it need not be there yet: a defender plans against the army coming).
 */
export function chooseBattlePlan(
  world: WorldState,
  provinceId: string,
  own: readonly Force[],
  enemy: readonly Force[],
  commander: Character | undefined,
  warfare: ScenarioWarfareRules | undefined,
): BattlePlan | null {
  if (warfare === undefined || own.length === 0 || enemy.length === 0) return null;
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined) return null;
  const rules = warfareWith(world, warfare);
  const judged = judgeTactic(world, province, own, enemy, ALL_PREMISES, rules);
  const held = judged.borneOut;
  if (held.length === 0) return null;
  const temper = temperOf(commander);
  // The man chooses what to lean on: a clever bold man on surprise where the ground gives it, a careful man on order, anyone on the horse and the numbers he has.
  const factor: BattlePlan["factor"] =
    (held.includes("scouted_ground") || held.includes("rough_ground")) && temper.bold >= 50 && temper.skill >= 45 ? "surprise"
      : held.includes("prepared_position") && temper.careful >= 45 ? "cohesion"
      : held.includes("superior_horse") ? "deployment"
      : held.includes("numbers") ? "effective_strength"
      : held.includes("prepared_position") ? "cohesion"
      : "deployment";
  // Two things borne out are worth what is asked; a man of little skill asks for little.
  const magnitude: BattlePlan["magnitude"] = held.length >= 2 && temper.skill >= 45 ? "meaningful" : "minor";
  const claimed = held.slice(0, 3);
  return {
    factor,
    magnitude,
    rationale: `He means to fight on ${claimed.map((premise) => IN_WORDS[premise]).join(", and ")}.`.slice(0, 300),
    restsOn: [...claimed],
  };
}

export type Manoeuvre = "storm_camp" | "night_attack" | "provoke" | "lure";

/**
 * What a general does about an enemy who will not come out: a camp he cannot be made to leave. Only where the enemy would refuse
 * (`acceptsBattle`); the bold and strong storm the rampart, the clever and bold go in by night, the clever and careful draw him out,
 * the bold and hard burn the country in sight of his camp. Null where the plain offer of battle will do or nothing suits the man.
 */
export function chooseManoeuvre(
  world: WorldState,
  own: readonly Force[],
  enemy: readonly Force[],
  commander: Character | undefined,
  gameId: string,
): { readonly kind: Manoeuvre; readonly why: string } | null {
  if (own.length === 0 || enemy.length === 0 || !canRefuse(world, enemy)) return null;
  const mine = own.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const theirs = enemy.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  if (acceptsBattle(world, enemy, mine, theirs)) return null;
  const temper = temperOf(commander);
  const fed = own.every((force) => force.provisionStatus === "provisioned");
  const eligible: { kind: Manoeuvre; why: string; weight: number }[] = [];
  if (temper.bold >= 60 && mine >= theirs * 2) eligible.push({ kind: "storm_camp", why: "the camp is to be carried at the rampart: there are twice as many of us", weight: temper.bold });
  if (temper.skill >= 55 && temper.bold >= 50) eligible.push({ kind: "night_attack", why: "the camp is to be fallen on in the night", weight: temper.skill });
  if (temper.skill >= 60 && temper.careful >= 45 && mine >= theirs * 0.6) eligible.push({ kind: "lure", why: "he is to be drawn out of his camp by a feigned retreat", weight: temper.skill - 5 });
  if (temper.bold >= 55 && temper.cruel >= 55 && fed && mine >= theirs) eligible.push({ kind: "provoke", why: "the country is to be burned in sight of his camp until he comes out", weight: temper.cruel });
  if (eligible.length === 0) return null;
  // The man's own bent decides among those that suit him, the same every replay.
  const roll = stableHash([gameId, "manoeuvre", own[0]!.id, String(world.instant.day)]) % 100;
  const total = eligible.reduce((sum, option) => sum + option.weight, 0);
  let at = (roll / 100) * total;
  for (const option of eligible) {
    at -= option.weight;
    if (at <= 0) return option;
  }
  return eligible[0]!;
}
