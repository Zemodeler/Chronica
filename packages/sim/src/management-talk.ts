import type { Ambition, OutlookConcern, WorldState } from "@chronica/shared";
import { stateCrisisLine } from "./kept-by-the-officers";

/**
 * What a person the model plays is not told of the routine government (docs/economy.md, "What the model is left to").
 *
 * The chest, the granary, the tax and the works are kept by the officers, by rule, and so are the posts of the departments that
 * keep them (`appointed-by-rule.ts`). A man the model plays used to be told his state "worried about the treasury" and wanted
 * "to put somebody over the grain", and went and did as he was told. He is told it now only when it has become a quarrel
 * (`stateCrisisLine`), and his own work is the politics: rivals, plots, legitimacy, war, faith, factions.
 */

/** The ambitions a ruler comes to want for his departments (`society.ts`, `wantDepartments`): the officers see to them. */
const MANAGEMENT_WANT = /^(hand-off|treasurer|watch|grain)-/;

export const isManagementWant = (ambition: Pick<Ambition, "id">): boolean => MANAGEMENT_WANT.test(ambition.id);

/** A worry of the books and the granary, as against a worry of men: money, bread, tax, tribute, customs, coin, the works. */
const MANAGEMENT_WORRY = /\b(money|treasur\w*|chest|debts?|indebted|grain|bread|harvests?|food|famine|hunger|tax\w*|tribute|customs|coin\w*|silver|revenues?|income|granar\w*|works|roads?|upkeep|prices?|finances?|solven\w*|funds|arrears|pay of the)\b/i;

export const isManagementWorry = (label: string): boolean => MANAGEMENT_WORRY.test(label);

/**
 * The worries a person is told of his government: the political ones always, the management ones only when his state is in
 * a crisis he must face (the soldiers' pay behind, bread at a famine price, the coin cheated), which `stateCrisisLine` says.
 */
export function worriesToTell<T extends Pick<OutlookConcern, "label">>(world: WorldState, characterId: string, concerns: readonly T[]): T[] {
  const crisis = stateCrisisLine(world, characterId) !== null;
  return concerns.filter((concern) => crisis || !isManagementWorry(concern.label));
}

/** What a government means to do, with the books' errands left out unless the state is in a crisis. */
export function intentionsToTell(world: WorldState, characterId: string, intentions: readonly string[]): string[] {
  const crisis = stateCrisisLine(world, characterId) !== null;
  return intentions.filter((intention) => crisis || !isManagementWorry(intention));
}
