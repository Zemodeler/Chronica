import "server-only";

import {
  DynamicMapOverlaySchema,
  formatWorldDate,
  type DynamicMapOverlay,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";

/**
 * Projects canonical world state into what the pages render.
 *
 * Its predecessor was deleted with the turn system, and is not restored here:
 * that version keyed its knowledge labels to a turn index and carried several
 * hardcoded scenario overlay tables that papered over gaps in the opening
 * state. Both are gone. This reports what `WorldState` actually contains and
 * nothing else -- if the map looks wrong, the world is wrong, which is the
 * failure mode worth having.
 */

export interface ProvinceView {
  readonly id: string;
  readonly name: string;
  readonly controllerLabel: string;
  readonly garrisonLabel: string;
}

export interface MoneyChangeView {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly whenLabel: string;
}

export interface AccountView {
  readonly id: string;
  readonly label: string;
  readonly balance: number;
  readonly recentChanges: readonly MoneyChangeView[];
}

export interface GameWorldView {
  readonly gameId: string;
  readonly gameTitle: string;
  /**
   * The character this player actually holds in the world, or null if they hold
   * only a placeholder. Holding one is what makes the player an actor the
   * simulation can accept orders from.
   */
  readonly viewerCharacterId: string | null;
  /** Which power they belong to. Public by nature, and what furnishes their room. */
  readonly viewerPolityId: string | null;
  /** The world's own date, e.g. "1 March 264 BC". Replaces the old turn counter. */
  readonly dateLabel: string;
  readonly provinces: readonly ProvinceView[];
  readonly mapOverlay: DynamicMapOverlay;
  readonly material: {
    readonly currencyName: string;
    readonly personalAccount: AccountView;
  };
}

export interface WorldViewMeta {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly clock: ScenarioClock | undefined;
}

const NO_ACCOUNT: AccountView = { id: "no-account", label: "No personal account", balance: 0, recentChanges: [] };

function projectOverlay(world: WorldState): DynamicMapOverlay {
  const characterNames = new Map(world.characters.map((character) => [character.id, character.name]));

  return DynamicMapOverlaySchema.parse({
    // The world's own clock is the revision: the map refetches exactly when
    // simulated time has moved, which is the only thing that can change it.
    revision: world.elapsedStep,
    polities: world.map.polities.map((polity) => ({ polityId: polity.id, name: polity.name })),
    politicalRelations: [],
    provinces: world.map.provinces.map((province) => ({
      provinceId: province.id,
      controllerPolityId: province.controllerPolityId,
      controlFirmnessBps: province.controlFirmnessBps,
      terrainId: province.terrainId,
      tier: province.tier,
    })),
    settlements: world.map.provinces.flatMap((province) =>
      province.settlements.map((settlement) => ({
        settlementId: settlement.id,
        provinceId: province.id,
        anchorFeatureId: settlement.id,
        name: settlement.name,
        kind: settlement.kind,
        controllerPolityId: settlement.controllerPolityId,
        capitalPolityId: world.map.polities.find((polity) => polity.capitalSettlementId === settlement.id)?.id ?? null,
        importance: settlement.size,
        underSiege: world.conflicts.sieges.some((siege) => siege.settlementId === settlement.id),
        damaged: false,
      })),
    ),
    forces: world.material.forces.map((force) => ({
      forceId: force.id,
      provinceId: force.locationId,
      ownerPolityId: force.polityId,
      name: force.name,
      commanderLabel: characterNames.get(force.commanderCharacterId) ?? null,
      strengthLabel: `${force.authorizedStrength.toLocaleString()} men`,
      relation: "neutral",
      selected: false,
      movement: null,
    })),
    conflicts: world.conflicts,
  });
}

export function projectWorldView(world: WorldState, meta: WorldViewMeta, viewerCharacterId: string): GameWorldView {
  const polityNames = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));
  const viewer = world.characters.find((character) => character.id === viewerCharacterId);

  const provinces: ProvinceView[] = world.map.provinces.map((province) => {
    const controllerLabel = province.controllerPolityId === null
      ? "Uncontrolled"
      : polityNames.get(province.controllerPolityId) ?? province.controllerPolityId;
    const stationed = world.material.forces.filter((force) => force.locationId === province.id);
    return {
      id: province.id,
      name: province.name,
      controllerLabel,
      garrisonLabel: stationed.length === 0 ? "No forces present" : `${stationed.map((force) => force.name).join(", ")} present`,
    };
  });

  const account = viewer === undefined
    ? undefined
    : world.material.accounts.find((candidate) => candidate.id === viewer.personalAccountId);

  const personalAccount: AccountView = account === undefined
    ? NO_ACCOUNT
    : {
      id: account.id,
      label: `${viewer?.name ?? "Personal"} purse`,
      balance: account.balance,
      recentChanges: world.material.transactions
        .filter((transaction) => transaction.sourceAccountId === account.id || transaction.destinationAccountId === account.id)
        .slice(-6)
        .map((transaction) => ({
          id: transaction.id,
          label: transaction.cause.explanation,
          amount: transaction.destinationAccountId === account.id ? transaction.amount : -transaction.amount,
          whenLabel: meta.clock === undefined ? `day ${transaction.atStep}` : formatWorldDate({ day: transaction.atStep, minute: 0 }, meta.clock),
        })),
    };

  return {
    gameId: meta.gameId,
    gameTitle: meta.gameTitle,
    viewerCharacterId: viewer?.id ?? null,
    viewerPolityId: viewer?.polityId ?? null,
    dateLabel: meta.clock === undefined ? `Day ${world.elapsedStep}` : formatWorldDate(world.instant, meta.clock),
    provinces,
    mapOverlay: projectOverlay(world),
    material: { currencyName: world.material.currency.name, personalAccount },
  };
}
