import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { ScenarioDefinitionSchema, WorldStateSchema, formatWorldDate } from "@chronica/shared";
import { getScenarioOpening, type ChronicaDatabase, type PublicScenarioSummary } from "@chronica/db";
import { notablePeople, type NotablePerson } from "./notable-people";

/**
 * What the worlds page says about a scenario, read from the scenario itself.
 *
 * There will be dozens of worlds, so nothing here is written per scenario:
 * the day it opens comes from its clock, the people you might be from its
 * seated offices, the premise from its opening context, and the plate from a
 * file named after its slug (`public/worlds/<slug>.webp`, briefed in
 * docs/scenario-key-art.md). A world without art gets a title plate instead.
 */
export interface WorldEntry {
  readonly summary: PublicScenarioSummary;
  /** "1 March 270 BC", or null when the scenario has no calendar. */
  readonly opensOn: string | null;
  readonly people: readonly NotablePerson[];
  readonly premise: string;
  /** The plate's public path, or null for the title plate. */
  readonly plate: string | null;
}

/** Published versions never change, so what they open on is read once. */
const openings = new Map<string, { readonly opensOn: string | null; readonly people: readonly NotablePerson[] }>();

export async function describeWorld(db: ChronicaDatabase, summary: PublicScenarioSummary): Promise<WorldEntry> {
  const key = `${summary.scenarioId}:${summary.version}`;
  let opening = openings.get(key);
  if (opening === undefined) {
    opening = await readOpening(db, summary);
    openings.set(key, opening);
  }
  return {
    summary,
    ...opening,
    premise: summary.premise.trim().length > 0 ? summary.premise : LEGACY_PREMISES[summary.slug] ?? "",
    plate: plateFor(summary.slug),
  };
}

async function readOpening(db: ChronicaDatabase, summary: PublicScenarioSummary) {
  try {
    const row = await getScenarioOpening(db, summary.scenarioId, summary.version);
    if (row === undefined) return { opensOn: null, people: [] };
    const world = WorldStateSchema.parse(row.initialWorld);
    const definition = ScenarioDefinitionSchema.parse(row.definition);
    return {
      opensOn: formatWorldDate(world.instant, definition.clock),
      // One from each of the leading powers: the range of who you could be.
      people: notablePeople(world, definition.government?.offices ?? [], new Set(), { limit: 4, perPolity: 1 }),
    };
  } catch {
    return { opensOn: null, people: [] };
  }
}

/**
 * Scenarios written before they carried an opening context. New scenarios
 * say it in their own definition; this list only shrinks.
 */
const LEGACY_PREMISES: Readonly<Record<string, string>> = {
  "punic-wars": "Rome has just finished taking Italy. Pyrrhus has gone home and the rebels of Rhegium are dead. Across the strait the Mamertines hold Messana, Hiero is making himself a king at Syracuse, and Carthage keeps the west of Sicily. Nobody has crossed yet.",
};

/** Found plates only: a missing one is looked for again, so new art shows without a restart. */
const plates = new Map<string, string>();

function plateFor(slug: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const known = plates.get(slug);
  if (known !== undefined) return known;
  // The dev server may run from the repository root or from apps/web.
  const file = `${slug}.webp`;
  const found = [path.join(process.cwd(), "public", "worlds", file), path.join(process.cwd(), "apps", "web", "public", "worlds", file)].some((candidate) => existsSync(candidate));
  if (!found) return null;
  plates.set(slug, `/worlds/${file}`);
  return `/worlds/${file}`;
}
