import { and, eq, inArray, or } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { sharedKnowledgebases } from "../schema/shared-knowledgebase";

// ── Row type ─────────────────────────────────────────────────────────────────

export interface SharedEntryRow {
  readonly id: string;
  readonly gameId: string;
  readonly poolType: string;
  readonly poolKey: string;
  readonly body: string;
  readonly sourceNpcCharacterId: string | null;
  readonly sourceSessionId: string | null;
  readonly stepOccurred: number;
  readonly isContradicted: boolean;
  readonly contradictsIds: string[];
  readonly createdAt: Date;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** Insert one entry into a single pool. Call once per pool the NPC belongs to. */
export async function insertSharedEntry(
  db: ChronicaDatabase,
  gameId: string,
  poolType: string,
  poolKey: string,
  body: string,
  sourceNpcCharacterId: string | null,
  sourceSessionId: string | null,
  stepOccurred: number,
): Promise<SharedEntryRow> {
  const [row] = await db
    .insert(sharedKnowledgebases)
    .values({ gameId, poolType, poolKey, body, sourceNpcCharacterId, sourceSessionId, stepOccurred })
    .returning();
  if (row === undefined) throw new Error("Failed to insert shared knowledgebase entry.");
  return row;
}

/** Fetch all entries for a set of pool specs (poolType + poolKey pairs). */
export async function listPoolEntries(
  db: ChronicaDatabase,
  gameId: string,
  poolSpecs: readonly { poolType: string; poolKey: string }[],
): Promise<readonly SharedEntryRow[]> {
  if (poolSpecs.length === 0) return [];
  const conditions = poolSpecs.map((spec) =>
    and(eq(sharedKnowledgebases.poolType, spec.poolType), eq(sharedKnowledgebases.poolKey, spec.poolKey)),
  );
  const rows = await db
    .select()
    .from(sharedKnowledgebases)
    .where(
      and(
        eq(sharedKnowledgebases.gameId, gameId),
        or(...conditions),
      ),
    );
  // De-duplicate by id (an entry can appear in multiple pools; we store one row per pool).
  // No dedup needed here — each pool insertion creates its own row.
  return rows;
}

/** Mark a set of entries as contradicted by a newer entry. */
export async function markEntriesContradicted(
  db: ChronicaDatabase,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(sharedKnowledgebases)
    .set({ isContradicted: true })
    .where(inArray(sharedKnowledgebases.id, ids));
}

// ── Chronicle integration stub ─────────────────────────────────────────────

/**
 * Ingests chronicle entries from a resolved turn into the shared knowledgebase.
 *
 * This is a no-op stub until the chronicle system is implemented.
 * See docs/shared-knowledgebase-chronicle-integration.md for the full contract,
 * including the new metadata fields the chronicle system must provide and the
 * pool routing rules per audience type.
 */
export async function ingestChronicleEntries(
  db: ChronicaDatabase,
  gameId: string,
  entries: readonly {
    body: string;
    atStep: number;
    audience: "all_players" | "knowledge_scoped";
    associatedPolityId?: string;
    associatedProvinceId?: string;
  }[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.audience === "all_players") {
      await insertSharedEntry(db, gameId, "game", gameId, entry.body, null, null, entry.atStep);
      continue;
    }
    if (entry.associatedPolityId) await insertSharedEntry(db, gameId, "polity", entry.associatedPolityId, entry.body, null, null, entry.atStep);
    if (entry.associatedProvinceId) await insertSharedEntry(db, gameId, "province", entry.associatedProvinceId, entry.body, null, null, entry.atStep);
  }
}
