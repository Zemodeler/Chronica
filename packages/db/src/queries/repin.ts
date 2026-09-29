import { and, eq } from "drizzle-orm";
import type { WorldState } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, scenarioVersions, scenarios } from "../schema/game";
import { getWorldView, persistRepairedWorld, readScenarioDefinition, readStoredWorld } from "./world";

/**
 * Moving a game onto a newer version of its scenario.
 *
 * A game is pinned to the scenario version it was created under, and the
 * pin is what makes a saved campaign mean the same thing tomorrow: its rules
 * (offices, warfare, the calendar) are read from that version's row, never
 * from whatever the code says today. Repinning is the one deliberate way to
 * give a game running on an old version what a newer one added, and it is
 * done to the save, in the open, rather than by quietly rewriting the old
 * version's row underneath it.
 *
 * What carries over is only what the save cannot have grown for itself: the
 * office seats the newer version's opening world has and this world lacks,
 * and the office a person already in the world holds there when he holds
 * none here. Everything the campaign has made -- wars, money, deaths, letters
 * -- stays as it is. Moved here from `scripts/play-turn.mts --repin`, where
 * it wrote the world last-write-wins and repinned the game in a second,
 * separate statement.
 */

export interface RepinReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly seatsAdded: readonly string[];
  /** People given the office the newer opening seats them in, by id. */
  readonly officesGiven: readonly string[];
}

/** The world carried onto `toVersion`, given that version's opening world. Pure. */
export function repinnedWorld(world: WorldState, opening: WorldState, toVersion: number): { readonly world: WorldState; readonly seatsAdded: readonly string[]; readonly officesGiven: readonly string[] } {
  const known = new Set(world.material.officeSeats.map((seat) => seat.id));
  const seats = opening.material.officeSeats.filter((seat) => !known.has(seat.id));
  const openingOffice = new Map(opening.characters.map((character) => [character.id, character.officeId]));
  const officesGiven: string[] = [];
  const characters = world.characters.map((character) => {
    const office = openingOffice.get(character.id);
    if (character.officeId !== null || office === undefined || office === null) return character;
    officesGiven.push(character.id);
    return { ...character, officeId: office };
  });
  return {
    world: {
      ...world,
      pins: { ...world.pins, scenarioVersion: toVersion },
      material: { ...world.material, officeSeats: [...world.material.officeSeats, ...seats] },
      characters,
    },
    seatsAdded: seats.map((seat) => seat.id),
    officesGiven,
  };
}

/**
 * Repins a game to `toVersion` (its scenario's current version by default).
 *
 * Refuses to move backwards, to a version with no row, to one whose
 * definition this build cannot read, and -- through `persistRepairedWorld` --
 * while a burst is running or if the world moved since it was read. With
 * `dryRun`, reports what it would do and writes nothing.
 */
export async function repinGame(
  db: ChronicaDatabase,
  gameId: string,
  options: { readonly toVersion?: number | undefined; readonly dryRun?: boolean | undefined } = {},
): Promise<RepinReport> {
  const view = await getWorldView(db, gameId);
  if (view === undefined) throw new Error(`No world for game ${gameId}.`);
  const [game] = await db
    .select({ scenarioId: games.scenarioId, scenarioVersion: games.scenarioVersion, currentVersion: scenarios.currentVersion })
    .from(games)
    .innerJoin(scenarios, eq(scenarios.id, games.scenarioId))
    .where(eq(games.id, gameId))
    .limit(1);
  if (game === undefined) throw new Error(`No game ${gameId}.`);
  const toVersion = options.toVersion ?? game.currentVersion;
  if (toVersion <= game.scenarioVersion) {
    throw new Error(`Game ${gameId} is pinned to version ${game.scenarioVersion}; a repin only moves forward (asked for ${toVersion}).`);
  }
  const [target] = await db
    .select({ definition: scenarioVersions.definition, initialWorld: scenarioVersions.initialWorld })
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.scenarioId, game.scenarioId), eq(scenarioVersions.version, toVersion)))
    .limit(1);
  if (target === undefined) throw new Error(`Scenario ${game.scenarioId} has no version ${toVersion} in this database.`);
  // Both halves of the target must be readable before anything is written:
  // a game repinned onto rules that will not parse is a game that will not open.
  readScenarioDefinition(game.scenarioId, toVersion, target.definition);
  const opening = readStoredWorld(`${game.scenarioId}@${toVersion}`, target.initialWorld);

  const carried = repinnedWorld(view.world, opening, toVersion);
  const report: RepinReport = { fromVersion: game.scenarioVersion, toVersion, seatsAdded: carried.seatsAdded, officesGiven: carried.officesGiven };
  if (options.dryRun === true) return report;
  await persistRepairedWorld(db, { gameId, expectedRevision: view.revision, world: carried.world, scenarioVersion: toVersion });
  return report;
}
