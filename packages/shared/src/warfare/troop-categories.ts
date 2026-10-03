import type { ScenarioWarfareRules, TroopCategoryDefinition } from "./battle";
import type { Doctrine, MilitaryEstablishment } from "./establishment";
import type { WarfareRules } from "./formation";

/**
 * Kinds of troops the world has made for itself, beside the ones the scenario
 * opened with.
 *
 * Exactly the shape `allOffices` already has, and for exactly the same reason.
 * A scenario's `troopCategories` was a closed list, so an army could only ever
 * be reinforced with a kind of soldier somebody had authored in advance: the
 * Punic Wars knew infantry, warships and horse, and answered "take the
 * Carthaginian elephants into the legion" with *"war-elephant is not a kind of
 * troops this world has"*. That is the engine refusing an order for want of a
 * row in a table, which is the one thing it may never do -- elephants existed,
 * Rome captured them, and a simulation that cannot say so is not modelling the
 * war it claims to.
 *
 * So the list opens. The world mints the kind of troops it is told about, and
 * from then on it is an ordinary category: the resolver reads its weight, its
 * steadiness and its mobility like any other, and a scenario that authored none
 * of it still fights exactly as it did.
 */
export function allTroopCategories(
  world: { readonly troopCategories?: readonly TroopCategoryDefinition[] },
  scenarioCategories: readonly TroopCategoryDefinition[] = [],
): readonly TroopCategoryDefinition[] {
  const made = world.troopCategories ?? [];
  const opened = withTransports(scenarioCategories);
  if (made.length === 0) return opened;
  const authored = new Set(opened.map((category) => category.id));
  return [...opened, ...made.filter((category) => !authored.has(category.id))];
}

/**
 * The hull that carries and does not fight: a merchantman or horse-transport
 * pressed into service, holding four times the men of a quinquereme and worth
 * almost nothing in a sea fight. Every period with warships had them, and a
 * scenario that wrote only warships ferried its armies at thirty men a hull --
 * which is why a consul with eighteen allied hulls could not cross the strait.
 */
export const TRANSPORT_CATEGORY: TroopCategoryDefinition = {
  id: "transport",
  label: "Transports",
  combatWeightBps: 1_500,
  steadinessBps: 3_000,
  mobilityBps: 6_000,
  naval: true,
  transportPerHead: 120,
};

/** A scenario that has ships at all has transports, whether or not it wrote them down; one without ships has neither. */
function withTransports(categories: readonly TroopCategoryDefinition[]): readonly TroopCategoryDefinition[] {
  if (!categories.some((category) => category.naval) || categories.some((category) => category.id === TRANSPORT_CATEGORY.id)) return categories;
  return [...categories, TRANSPORT_CATEGORY];
}

/**
 * The scenario's warfare rules with the world's own categories folded in.
 *
 * Every reader of a category -- the battle resolver, the sea rules, the
 * reinforcement guard -- takes `ScenarioWarfareRules` and looks the id up
 * there. Rather than teach each of them about world state, the merge happens
 * once, at the point the rules are handed to the engine. A category the world
 * minted is then indistinguishable from an authored one, which is the property
 * that matters: elephants taken into the Thirteenth in March must fight as
 * elephants in April, in a battle resolved by code that never heard of them.
 */
export function warfareWith(
  world: {
    readonly troopCategories?: readonly TroopCategoryDefinition[];
    readonly establishments?: readonly MilitaryEstablishment[];
    readonly doctrines?: readonly Doctrine[];
    readonly elapsedStep?: number;
  },
  warfare: ScenarioWarfareRules,
): WarfareRules {
  const categories = allTroopCategories(world, warfare.troopCategories);
  const merged = categories === warfare.troopCategories ? warfare : { ...warfare, troopCategories: [...categories] };
  // And how each power makes war (`establishment.ts`): read by the battle, the
  // muster and drill alike, so a doctrine brought in by a law in March is
  // fought by in April without any of them being told.
  if ((world.establishments?.length ?? 0) === 0 && (world.doctrines?.length ?? 0) === 0) return merged;
  return {
    ...merged,
    establishments: world.establishments ?? [],
    doctrines: world.doctrines ?? [],
    ...(world.elapsedStep === undefined ? {} : { today: world.elapsedStep }),
  };
}

/**
 * What the world says about a kind of troops it has just thought of.
 *
 * Judgment, in bands, exactly as `character_create.standing` bands a person's
 * wealth: the world says elephants are heavy, skittish and no quicker than a
 * marching man, and the engine says what those words are worth. The numbers
 * are never the model's, because a model that sets its own combat weight will
 * set it high -- the same reason it does not author its own casualties.
 */
export interface TroopCategoryBands {
  readonly label: string;
  readonly weightBand: "light" | "standard" | "heavy";
  readonly steadinessBand: "brittle" | "standard" | "stubborn";
  readonly mobilityBand: "slow" | "standard" | "fast";
  readonly naval: boolean;
}

/**
 * The baseline a scenario's own categories are written against: an ordinary
 * foot soldier of the period is 10 000, and nothing minted here may beat him
 * per head. A category that could would be a way to win a battle by naming a
 * unit, which is the model authoring arithmetic through the side door.
 */
const BASELINE_COMBAT_WEIGHT_BPS = 10_000;

const WEIGHT_BPS: Record<TroopCategoryBands["weightBand"], number> = { light: 6_500, standard: 8_500, heavy: 9_500 };
const STEADINESS_BPS: Record<TroopCategoryBands["steadinessBand"], number> = { brittle: 4_000, standard: 7_000, stubborn: 8_500 };
const MOBILITY_BPS: Record<TroopCategoryBands["mobilityBand"], number> = { slow: 3_500, standard: 5_000, fast: 9_000 };

/** Hulls carry men; how many is the engine's figure, not the world's. */
const MINTED_TRANSPORT_PER_HEAD = 20;

/** What an unbanded mint gets: a body of ordinary soldiers, which is what most of them are. */
const STANDARD_BANDS: Omit<TroopCategoryBands, "label"> = {
  weightBand: "standard",
  steadinessBand: "standard",
  mobilityBand: "standard",
  naval: false,
};

/**
 * Turns a name and three words of judgment into a category the resolver can
 * fight. Deterministic, bounded, and never above the baseline.
 */
export function mintTroopCategory(id: string, bands: Partial<TroopCategoryBands> & { readonly label: string }): TroopCategoryDefinition {
  const filled = { ...STANDARD_BANDS, ...bands };
  return {
    id,
    label: filled.label,
    combatWeightBps: Math.min(BASELINE_COMBAT_WEIGHT_BPS, WEIGHT_BPS[filled.weightBand]),
    steadinessBps: STEADINESS_BPS[filled.steadinessBand],
    mobilityBps: MOBILITY_BPS[filled.mobilityBand],
    naval: filled.naval,
    transportPerHead: filled.naval ? MINTED_TRANSPORT_PER_HEAD : 0,
  };
}

/**
 * A readable name for a kind of troops named only by its id.
 *
 * The world is told "war-elephant" and nothing else; the record should not then
 * say `war-elephant`. Nothing here is identity -- the id stays the id.
 */
export function labelFromCategoryId(categoryId: string): string {
  const words = categoryId.split(/[-_:\s]+/u).filter((word) => word.length > 0);
  if (words.length === 0) return categoryId;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * What one head of a hired company costs a month, at least: about what a
 * government already pays to keep its own. Rome paid 190 a month for 7,100
 * legionaries and allies and 40 to victual 18 allied hulls, so a hired foot
 * soldier is put at 0.04 (a little above a citizen's keep) and a hull at 2.5,
 * each scaled by what it is worth in the line. Without a floor, 400 warships
 * were hired for 900 down and nothing a month.
 */
export function hireFloorPerMonth(category: Pick<TroopCategoryDefinition, "naval" | "combatWeightBps">): number {
  const worth = Math.max(0.5, category.combatWeightBps / BASELINE_COMBAT_WEIGHT_BPS);
  return (category.naval === true ? 2.5 : 0.04) * worth;
}
