import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { WorldState, WorkflowAuditBlob, NovelActionProposal, RuntimeInventedWorkflow } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { chronicleEntries, games, turns, worldSnapshots } from "../schema/game";
import { insertNovelActionProposals } from "./workflow-proposals";
import { insertInventedWorkflows, recordInventedWorkflowUses, type InventedWorkflowUseInput } from "./invented-workflows";

// Persistence for the resolution pipeline.
//
// commitResolution() is the single write gate for a resolved turn: snapshot,
// chronicle, turn advancement, and next-turn opening in one transaction. The
// caller owns the world mutation; this file owns the durable commit.

export interface ChronicleEntryInput {
  readonly sequence: number;
  readonly scope: string;
  readonly scopeRef?: string;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly body: string;
  readonly atStep: number;
  readonly materialConsequence: boolean;
  readonly displayPatch?: unknown;
  readonly playerInvolvement?: unknown;
  // Extended Chronicle fields (all optional for backward compat).
  readonly eventDate?: string | null;
  readonly location?: string | null;
  readonly chainId?: string | null;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
  readonly directConsequences?: Array<{ kind: string; label: string; entityId: string | null; quantified: boolean }>;
  /** Ephemeral cast supplied to the narrator and relevance system before the prose is persisted. */
  readonly characterMentions?: readonly { characterId: string; role: string }[];
  /** Ephemeral Chronicle ordering aid. It is deliberately not persisted as world state. */
  readonly simulatedDurationDays?: number;
  readonly causalFactIds?: readonly string[];
  readonly sourceDirector?: "player" | "character_director" | "reaction_director" | "simulator" | "world_director";
  readonly openPressure?: boolean;
  /**
   * Player-visible summary of one resolved political procedure (character-sim
   * phase 4): institution, sponsor, net support/opposition, outcome and
   * public reason. Deliberately carries nothing private -- no per-supporter
   * reasons, no undisclosed positions. See `packages/shared/src/characters/political-inspector.ts`
   * for the admin-only view that does carry those.
   */
  readonly politicalOutcome?: {
    readonly procedureId: string;
    readonly procedureType: string;
    readonly institutionName: string | null;
    readonly sponsorName: string;
    readonly outcome: "passed" | "failed" | "blocked" | "withdrawn";
    readonly publicReason: string;
    readonly netSupportWeight: number;
    readonly netOppositionWeight: number;
  };
  /**
   * Player-visible summary of one life event resolved this turn
   * (character-sim phase 5): death/incapacitation/recovery, and (for a death)
   * the estate outcome and any office vacancy it opened. Deliberately carries
   * nothing private -- no hidden heirs, no secret parentage, no will
   * contents. See `packages/shared/src/characters/life-inspector.ts` for the
   * admin-only view that does carry those.
   */
  readonly lifeEvent?: {
    readonly characterId: string;
    readonly characterName: string;
    readonly kind: "death" | "incapacitation" | "recovery";
    readonly cause: string;
    readonly estateOutcome: string | null;
    readonly vacatedOfficeIds: readonly string[];
  };
  /** Player-visible summary of a force changing commander (character-sim phase 6). */
  readonly commandChange?: {
    readonly forceName: string;
    readonly previousCommanderName: string | null;
    readonly newCommanderName: string | null;
    readonly reason: string;
  };
  /** Player-visible summary of a public/polity-visible marriage, partnership, or guardianship change (character-sim phase 6). */
  readonly familyEvent?: {
    readonly contractId: string;
    readonly type: string;
    readonly partyNames: readonly string[];
    readonly outcome: string;
  };
  // Chronicle-first legibility fields (character-sim phase 6). All additive,
  // stored inside the existing `facts` jsonb blob -- no new DB columns.
  readonly title?: string;
  readonly knowledgeStatus?: "confirmed" | "report" | "rumour" | "suspicion";
  readonly participants?: readonly { readonly name: string; readonly role?: string }[];
  readonly places?: readonly { readonly name: string }[];
  readonly institutions?: readonly { readonly name: string }[];
  readonly playerRelevance?: "high" | "medium" | "low" | "none";
  /** Present only on the one synthetic `scope: "dispatch"` entry per turn (character-sim phase 6). */
  readonly dispatch?: { readonly items: readonly string[]; readonly uncertaintyNote: string | null };
}

export interface CommitResolutionInput {
  readonly gameId: string;
  readonly turnId: string;
  readonly newWorld: WorldState;
  readonly elapsedStepEnd: number;
  readonly chronicleEntries: readonly ChronicleEntryInput[];
  readonly stopReason: string;
  /** Workflow Manager audit blob; stored as JSONB on the turn row for offline review. */
  readonly workflowAudit?: WorkflowAuditBlob;
  /** Novel action proposals emitted by the Workflow Manager; persisted for developer review. */
  readonly novelActionProposals?: readonly NovelActionProposal[];
  /** Reusable templates that succeeded for the first time during this turn. */
  readonly inventedWorkflows?: readonly RuntimeInventedWorkflow[];
  /** Complete runtime-template use audit for this turn. */
  readonly inventedWorkflowUses?: readonly InventedWorkflowUseInput[];
}

export interface CommitResolutionResult {
  readonly nextTurnId: string;
}

/**
 * Atomically commit a resolved turn: write the new world snapshot, write
 * chronicle entries, advance the current turn to "news", and open the next
 * "collecting" turn.
 */
export async function commitResolution(
  db: ChronicaDatabase,
  input: CommitResolutionInput,
): Promise<CommitResolutionResult> {
  const worldJson = JSON.stringify(input.newWorld);
  const stateHash = createHash("sha256").update(worldJson).digest("hex");

  return db.transaction(async (tx) => {
    // Advance current turn to "news"
    await tx
      .update(turns)
      .set({
        status: "news",
        elapsedStepEnd: input.elapsedStepEnd,
        stopReason: input.stopReason,
        resolutionCommittedAt: new Date(),
        ...(input.workflowAudit !== undefined ? { workflowAudit: input.workflowAudit } : {}),
      })
      .where(eq(turns.id, input.turnId));

    // Write world snapshot
    await tx.insert(worldSnapshots).values({
      turnId: input.turnId,
      state: JSON.parse(worldJson) as unknown,
      schemaVersion: input.newWorld.schemaVersion,
      stateHash,
    });

    // Write chronicle entries
    if (input.chronicleEntries.length > 0) {
      await tx.insert(chronicleEntries).values(
        input.chronicleEntries.map((entry) => ({
          turnId: input.turnId,
          sequence: entry.sequence,
          scope: entry.scope,
          scopeRef: entry.scopeRef ?? null,
          audience: entry.audience,
          visibility: "public",
          playerInvolvement: entry.playerInvolvement ?? [],
          body: entry.body,
          facts: {
            ids: [],
            atStep: entry.atStep,
            materialConsequence: entry.materialConsequence,
            ...(entry.displayPatch !== undefined ? { displayPatch: entry.displayPatch } : {}),
            ...(entry.eventDate != null ? { eventDate: entry.eventDate } : {}),
            ...(entry.location != null ? { location: entry.location } : {}),
            ...(entry.chainId != null ? { chainId: entry.chainId } : {}),
            ...(entry.chainPosition != null ? { chainPosition: entry.chainPosition } : {}),
            ...(entry.sourceDirector != null ? { sourceDirector: entry.sourceDirector } : {}),
            ...(entry.openPressure ? { openPressure: true } : {}),
            ...(entry.directConsequences && entry.directConsequences.length > 0
              ? { directConsequences: entry.directConsequences }
              : {}),
            ...(entry.causalFactIds && entry.causalFactIds.length > 0
              ? { causalFactIds: [...entry.causalFactIds] }
              : {}),
            ...(entry.politicalOutcome !== undefined ? { politicalOutcome: entry.politicalOutcome } : {}),
            ...(entry.lifeEvent !== undefined ? { lifeEvent: entry.lifeEvent } : {}),
            ...(entry.commandChange !== undefined ? { commandChange: entry.commandChange } : {}),
            ...(entry.familyEvent !== undefined ? { familyEvent: entry.familyEvent } : {}),
            ...(entry.title !== undefined ? { title: entry.title } : {}),
            ...(entry.knowledgeStatus !== undefined ? { knowledgeStatus: entry.knowledgeStatus } : {}),
            ...(entry.participants && entry.participants.length > 0 ? { participants: entry.participants } : {}),
            ...(entry.places && entry.places.length > 0 ? { places: entry.places } : {}),
            ...(entry.institutions && entry.institutions.length > 0 ? { institutions: entry.institutions } : {}),
            ...(entry.playerRelevance !== undefined ? { playerRelevance: entry.playerRelevance } : {}),
            ...(entry.dispatch !== undefined ? { dispatch: entry.dispatch } : {}),
          },
        })),
      );
    }

    // Persist novel action proposals for developer review
    if (input.novelActionProposals && input.novelActionProposals.length > 0) {
      await insertNovelActionProposals(tx as unknown as ChronicaDatabase, input.novelActionProposals, input.turnId, input.gameId);
    }
    if (input.inventedWorkflows && input.inventedWorkflows.length > 0) {
      await insertInventedWorkflows(tx as unknown as ChronicaDatabase, input.inventedWorkflows, input.turnId);
    }
    if (input.inventedWorkflowUses && input.inventedWorkflowUses.length > 0) {
      await recordInventedWorkflowUses(tx as unknown as ChronicaDatabase, input.inventedWorkflowUses, input.turnId);
    }

    // Look up active players to seed news-readiness rows
    const [currentTurn] = await tx
      .select({ index: turns.index })
      .from(turns)
      .where(eq(turns.id, input.turnId))
      .limit(1);
    const nextIndex = (currentTurn?.index ?? 0) + 1;

    // Open next collecting turn
    const nextTurnId = randomUUID();
    await tx.insert(turns).values({
      id: nextTurnId,
      gameId: input.gameId,
      index: nextIndex,
      status: "collecting",
      seed: `${input.gameId}:${nextIndex}`,
      openedAt: new Date(),
      elapsedStepStart: input.elapsedStepEnd,
    });

    return { nextTurnId };
  });
}

/** Get orders submitted for a turn, mapped to the player's character id. */
export async function getOrdersForTurn(
  db: ChronicaDatabase,
  turnId: string,
): Promise<readonly { readonly playerId: string; readonly characterId: string; readonly rawText: string; readonly directives: unknown }[]> {
  // Fetch actual orders
  const { orders: ordersTable } = await import("../schema/game");
  const orderRows = await db
    .select({
      playerId: ordersTable.playerId,
      rawText: ordersTable.rawText,
      directives: ordersTable.directives,
    })
    .from(ordersTable)
    .where(eq(ordersTable.turnId, turnId));

  return orderRows.map((row) => ({
    playerId: row.playerId,
    characterId: "unknown",
    rawText: row.rawText,
    directives: row.directives,
  }));
}

/** Advance a turn's status from queued → resolving. */
export async function claimTurnForResolution(
  db: ChronicaDatabase,
  turnId: string,
): Promise<boolean> {
  const rows = await db
    .update(turns)
    .set({ status: "resolving" })
    .where(and(eq(turns.id, turnId), eq(turns.status, "queued")))
    .returning({ id: turns.id });
  return rows.length > 0;
}

/** Write the current pipeline step so the SSE stream can report live progress. */
export async function updateTurnProgressStep(
  db: ChronicaDatabase,
  turnId: string,
  step: string,
): Promise<void> {
  await db.update(turns).set({ progressStep: step }).where(eq(turns.id, turnId));
}

/** Mark a turn as failed with an error reason. */
export async function failTurn(
  db: ChronicaDatabase,
  turnId: string,
  _reason: string,
): Promise<void> {
  await db.update(turns).set({ status: "failed" }).where(eq(turns.id, turnId));
}

/** Get the queued turn for a game, if one exists. */
export async function getQueuedTurn(
  db: ChronicaDatabase,
  gameId: string,
): Promise<{ id: string; index: number; elapsedStepStart: number } | undefined> {
  const [turn] = await db
    .select({ id: turns.id, index: turns.index, elapsedStepStart: turns.elapsedStepStart })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), eq(turns.status, "queued")))
    .orderBy(desc(turns.index))
    .limit(1);
  return turn;
}

/** The account responsible for provider charges incurred while resolving a game. */
export async function getGamePayerUserId(db: ChronicaDatabase, gameId: string): Promise<string | undefined> {
  const [game] = await db.select({ payerUserId: games.payerUserId }).from(games).where(eq(games.id, gameId)).limit(1);
  return game?.payerUserId;
}

/** Mark news as read for this game: advance news turn → resolved and update game. */
export async function markChronicleRead(
  db: ChronicaDatabase,
  gameId: string,
  _playerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [turn] = await tx
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.gameId, gameId), eq(turns.status, "news")))
      .orderBy(desc(turns.index))
      .limit(1);
    if (!turn) return;
    await tx.update(turns).set({ status: "resolved", resolvedAt: new Date() }).where(eq(turns.id, turn.id));
  });
}
