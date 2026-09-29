import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the suite keeps what it seeded once.
 *
 * Their own module because playwright.config.ts imports STATE_FILE, and a
 * config that imports a file calling test() is refused outright.
 */

export const STATE_FILE = path.join(os.tmpdir(), "chronica-e2e-state.json");
export const WORLDS_FILE = path.join(os.tmpdir(), "chronica-e2e-worlds.json");

export interface SeededWorlds {
  /** A seated consul: an office, an army, a treasury. */
  readonly consul: string;
  /** No office, no command, no land. His room is nearly bare. */
  readonly citizen: string;
  /** A Carthaginian, so the room that furnishes itself for him is not the Roman one. */
  readonly carthaginian: string;
}

export const seededWorlds = (): SeededWorlds =>
  JSON.parse(fs.readFileSync(WORLDS_FILE, "utf8")) as SeededWorlds;
