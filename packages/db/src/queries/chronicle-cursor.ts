/**
 * Where an entry sits in the record, as one string that sorts the way the
 * record is read.
 *
 * The Chronicle is paged by keyset, not by offset: an offset shifts under the
 * reader every time a turn commits, so "the next 200" would repeat entries or
 * skip them. The key is the full reading order -- the day the entry entered
 * the record, when it was written (to the microsecond), its place in its
 * report, and its id for the last tie -- zero-padded so that comparing two
 * keys as strings compares them as the database does. The browser merges
 * pages by it, and hands the oldest one back as `before`.
 */

export interface ChroniclePosition {
  readonly toInstantSortKey: number;
  /** `created_at` in whole microseconds since the epoch, as a decimal string. */
  readonly createdMicros: string;
  readonly ordinal: number;
  readonly id: string;
}

/** Day keys may sit before the scenario's epoch; shifted by this they never go negative. */
const DAY_KEY_OFFSET = 1_000_000_000_000_000;
const DAY_KEY_WIDTH = 16;
const MICROS_WIDTH = 17;
const ORDINAL_WIDTH = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chronicleOrderKey(position: ChroniclePosition): string {
  const day = String(position.toInstantSortKey + DAY_KEY_OFFSET).padStart(DAY_KEY_WIDTH, "0");
  const micros = position.createdMicros.padStart(MICROS_WIDTH, "0");
  const ordinal = String(position.ordinal).padStart(ORDINAL_WIDTH, "0");
  return `${day}.${micros}.${ordinal}.${position.id.toLowerCase()}`;
}

/** The position a key names, or null for anything this build did not write. */
export function parseChronicleCursor(key: string): ChroniclePosition | null {
  if (key.length > 128) return null;
  const parts = key.split(".");
  if (parts.length !== 4) return null;
  const [day, micros, ordinal, id] = parts as [string, string, string, string];
  if (!/^\d{16}$/.test(day) || !/^\d{17}$/.test(micros) || !/^\d{6}$/.test(ordinal) || !UUID.test(id)) return null;
  const toInstantSortKey = Number(day) - DAY_KEY_OFFSET;
  if (!Number.isSafeInteger(toInstantSortKey)) return null;
  return { toInstantSortKey, createdMicros: String(BigInt(micros)), ordinal: Number(ordinal), id };
}
