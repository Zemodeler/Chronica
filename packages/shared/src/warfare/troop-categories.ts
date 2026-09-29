import type { ScenarioWarfareRules, TroopCategoryDefinition } from "./battle";

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
  if (made.length === 0) return scenarioCategories;
  const authored = new Set(scenarioCategories.map((category) => category.id));
  return [...scenarioCategories, ...made.filter((category) => !authored.has(category.id))];
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
  world: { readonly troopCategories?: readonly TroopCategoryDefinition[] },
  warfare: ScenarioWarfareRules,
): ScenarioWarfareRules {
  const categories = allTroopCategories(world, warfare.troopCategories);
  return categories === warfare.troopCategories ? warfare : { ...warfare, troopCategories: [...categories] };
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
