import type { z } from "zod";
import { WORLD_SCHEMA_VERSION, WorldStateSchema, type WorldState } from "./world-state";

/**
 * Carrying a stored world forward to the schema the code now reads.
 *
 * `WorldStateSchema` is strict and pins `schemaVersion` to one number, so a
 * save written before a breaking change could not be opened at all: the parse
 * failed, `getWorldView` threw, and the game answered every request with a 500.
 * The schema's own note promised "bump this and teach the reader to upgrade
 * old documents", and there was no reader to teach.
 *
 * This is that reader. A stored world is raw JSON; each step takes the raw
 * document written at one version and returns the raw document the next
 * version expects, and only then is the result held to the strict schema. The
 * steps are pure -- no clock, no ids, nothing but the document -- so upgrading
 * the same save twice gives the same world twice.
 *
 * Adding a breaking change to the world, then, is three things together:
 *
 *   1. bump `WORLD_SCHEMA_VERSION` in `world-state.ts`;
 *   2. add the step from the old number to the new one to `WORLD_UPGRADES`,
 *      written against plain objects, never against the typed world (the old
 *      document is by definition not one);
 *   3. add a case to `world-upgrade.test.ts` that feeds the step a document as
 *      the old code wrote it and parses the result.
 *
 * A new field that is optional or defaulted is not a breaking change and needs
 * no step: the strict parse fills it in.
 */

/** One version's worth of change, on the raw document. */
export interface WorldUpgradeStep {
  readonly from: number;
  readonly to: number;
  /** What the step changes, in a sentence, for the repair log. */
  readonly describe: string;
  readonly upgrade: (document: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Every step from the oldest world still carried to the current one, in order.
 *
 * Empty while 3 is both the oldest carried and the current version: worlds
 * written at 2 were playtests and were recreated (see `WORLD_SCHEMA_VERSION`).
 * The chain still runs on every load, so the first step added here is the
 * first one every old save goes through.
 */
export const WORLD_UPGRADES: readonly WorldUpgradeStep[] = [];

/** The oldest version the chain can carry forward. */
export const OLDEST_CARRIED_WORLD_VERSION = 3;

/** A stored world that cannot be brought to the current schema, with where it went wrong. */
export class WorldDocumentUnreadableError extends Error {
  constructor(
    readonly reason: string,
    /** The schema's complaints, each as `path: message`; empty when the document never reached the parse. */
    readonly issues: readonly string[],
  ) {
    super(issues.length === 0 ? reason : `${reason}: ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ""}`);
    this.name = "WorldDocumentUnreadableError";
  }
}

/** A schema complaint as one line a person can go and find. */
export function issueLine(issue: z.core.$ZodIssue): string {
  return `${issue.path.length === 0 ? "(root)" : issue.path.join(".")}: ${issue.message}`;
}

/**
 * The raw document carried to the current version, and the steps it took.
 *
 * Refuses a document with no version, one older than the chain reaches, one
 * newer than this code (written by a later build -- reading it would silently
 * drop whatever that build added), and a chain with a gap in it.
 */
export function upgradeWorldDocument(
  raw: unknown,
  steps: readonly WorldUpgradeStep[] = WORLD_UPGRADES,
  current: number = WORLD_SCHEMA_VERSION,
  oldest: number = OLDEST_CARRIED_WORLD_VERSION,
): { readonly document: Record<string, unknown>; readonly applied: readonly string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new WorldDocumentUnreadableError("The stored world is not a document", []);
  let document = raw as Record<string, unknown>;
  const version = document.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) throw new WorldDocumentUnreadableError("The stored world carries no schema version", []);
  if (version > current) throw new WorldDocumentUnreadableError(`The stored world was written at schema ${version}, newer than this build's ${current}`, []);
  if (version < oldest) throw new WorldDocumentUnreadableError(`The stored world was written at schema ${version}, older than the oldest this build carries (${oldest})`, []);

  const applied: string[] = [];
  let at = version;
  while (at < current) {
    const step = steps.find((candidate) => candidate.from === at);
    if (step === undefined) throw new WorldDocumentUnreadableError(`No upgrade exists from world schema ${at}`, []);
    if (step.to <= at) throw new WorldDocumentUnreadableError(`The upgrade from schema ${at} does not move forward`, []);
    document = { ...step.upgrade(structuredClone(document)), schemaVersion: step.to };
    applied.push(`${step.from} -> ${step.to}: ${step.describe}`);
    at = step.to;
  }
  return { document, applied };
}

/**
 * A stored world, upgraded and held to the schema. Throws, with every path the
 * schema refused, rather than handing back something that is not a world:
 * swallowing this once reported a three-year campaign as an empty world.
 */
export function readWorldDocument(
  raw: unknown,
  chain: { readonly steps?: readonly WorldUpgradeStep[]; readonly oldest?: number } = {},
): { readonly world: WorldState; readonly applied: readonly string[] } {
  const { document, applied } = upgradeWorldDocument(raw, chain.steps ?? WORLD_UPGRADES, WORLD_SCHEMA_VERSION, chain.oldest ?? OLDEST_CARRIED_WORLD_VERSION);
  const parsed = WorldStateSchema.safeParse(document);
  if (!parsed.success) {
    throw new WorldDocumentUnreadableError(
      applied.length === 0 ? "The stored world does not satisfy the world schema" : `The stored world, upgraded (${applied.length} step(s)), does not satisfy the world schema`,
      parsed.error.issues.map(issueLine),
    );
  }
  return { world: parsed.data, applied };
}
