import "server-only";

import {
  armiesInSight,
  buildStation,
  DynamicMapOverlaySchema,
  factsKnownToStation,
  formatWorldDate,
  type DynamicMapOverlay,
  type Fact,
  type Office,
  type ScenarioClock,
  type ScenarioWarfareRules,
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
  /** The scenario's offices, so a consul's station is a consul's. */
  readonly offices: readonly Office[];
  /** What has happened lately, for the armies reported where nobody can see them. */
  readonly facts: readonly Fact[];
  /** The scenario's troop kinds, so a fleet on the map is counted in ships. */
  readonly warfare?: ScenarioWarfareRules | undefined;
}

const NO_ACCOUNT: AccountView = { id: "no-account", label: "No personal account", balance: 0, recentChanges: [] };

function projectOverlay(world: WorldState, viewerCharacterId: string | null, offices: readonly Office[], facts: readonly Fact[], warfare?: ScenarioWarfareRules): DynamicMapOverlay {
  // A power's own armies are on its rolls; anyone else's is on the map only
  // where the viewer could know of it, at the count their sources give
  // (`armiesInSight`). Nobody in particular sees nobody's.
  const station = viewerCharacterId === null || !world.characters.some((character) => character.id === viewerCharacterId)
    ? null
    : buildStation({ world, characterId: viewerCharacterId, offices });
  const sighted = new Map((station === null ? [] : armiesInSight(world, station, factsKnownToStation(facts, station, world.instant, world), warfare))
    .map((army) => [army.forceId, army]));
  const characterNames = new Map(world.characters.map((character) => [character.id, character.name]));
  // Looked up once per settlement below, so indexed here rather than searched each time.
  const capitalOf = new Map<string, string>();
  for (const polity of world.map.polities) if (polity.capitalSettlementId != null && !capitalOf.has(polity.capitalSettlementId)) capitalOf.set(polity.capitalSettlementId, polity.id);
  const besieged = new Set(world.conflicts.sieges.map((siege) => siege.settlementId));

  return DynamicMapOverlaySchema.parse({
    // The world's own clock is the revision: the map refetches exactly when
    // simulated time has moved, which is the only thing that can change it.
    revision: world.elapsedStep,
    polities: world.map.polities.map((polity) => ({ polityId: polity.id, name: polity.name })),
    // Who follows whom, read from the treaties themselves: a foedus names its
    // leader second, and an alliance of equals is shown as led by its first party.
    politicalRelations: world.polityAgreements
      .filter((agreement) => agreement.status === "active" && agreement.visibility === "public" && (agreement.kind === "foedus" || agreement.kind === "alliance"))
      .map((agreement) => ({
        id: agreement.id,
        kind: "alliance" as const,
        leaderPolityId: agreement.kind === "foedus" ? agreement.otherPolityId : agreement.polityId,
        memberPolityId: agreement.kind === "foedus" ? agreement.polityId : agreement.otherPolityId,
        sourceNote: agreement.terms,
      })),
    provinces: world.map.provinces.map((province) => ({
      provinceId: province.id,
      controllerPolityId: province.controllerPolityId,
      controlFirmnessBps: province.controlFirmnessBps,
      terrainId: province.terrainId,
    })),
    settlements: world.map.provinces.flatMap((province) =>
      province.settlements.map((settlement) => ({
        settlementId: settlement.id,
        provinceId: province.id,
        anchorFeatureId: settlement.id,
        name: settlement.name,
        kind: settlement.kind,
        controllerPolityId: settlement.controllerPolityId,
        capitalPolityId: capitalOf.get(settlement.id) ?? null,
        importance: settlement.size,
        underSiege: besieged.has(settlement.id),
        damaged: false,
      })),
    ),
    forces: world.material.forces.flatMap((force) => {
      const army = sighted.get(force.id);
      return army === undefined ? [] : [{ force, army }];
    }).map(({ force, army }) => ({
      forceId: force.id,
      provinceId: army.provinceId,
      ownerPolityId: force.polityId,
      name: force.name,
      commanderLabel: characterNames.get(force.commanderCharacterId) ?? null,
      strengthLabel: army.strengthLabel,
      relation: "neutral",
      ...(force.standardId === undefined ? {} : { flagAssetId: force.standardId }),
      commandable: viewerCharacterId !== null && (force.commanderCharacterId === viewerCharacterId || force.controllerCharacterId === viewerCharacterId),
      selected: false,
      movement: null,
    })),
    conflicts: world.conflicts,
  });
}

export function projectWorldView(world: WorldState, meta: WorldViewMeta, viewerCharacterId: string): GameWorldView {
  const polityNames = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));
  const viewer = world.characters.find((character) => character.id === viewerCharacterId);
  const mapOverlay = projectOverlay(world, viewer?.id ?? null, meta.offices, meta.facts, meta.warfare);

  // What the map shows standing in each province, and nothing it does not.
  const forcesByProvince = new Map<string, string[]>();
  for (const force of mapOverlay.forces) {
    const names = forcesByProvince.get(force.provinceId);
    if (names) names.push(force.name); else forcesByProvince.set(force.provinceId, [force.name]);
  }
  const provinces: ProvinceView[] = world.map.provinces.map((province) => {
    const controllerLabel = province.controllerPolityId === null
      ? "Uncontrolled"
      : polityNames.get(province.controllerPolityId) ?? province.controllerPolityId;
    const stationed = forcesByProvince.get(province.id) ?? [];
    return {
      id: province.id,
      name: province.name,
      controllerLabel,
      garrisonLabel: stationed.length === 0 ? "No forces present" : `${stationed.join(", ")} present`,
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
    mapOverlay,
    material: { currencyName: world.material.currency.name, personalAccount },
  };
}
