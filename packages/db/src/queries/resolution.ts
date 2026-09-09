import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
  CommittedGameMasterReport,
  Fact,
  NovelActionProposal,
  RecordedCapabilityRequest,
  RuntimeInventedWorkflow,
  WorkflowAuditBlob,
  WorkflowAuditEntry,
  WorldState,
} from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { chronicleEntries, games, turns, worldSnapshots } from "../schema/game";
import { insertNovelActionProposals } from "./workflow-proposals";
import { insertCapabilityRequests } from "./capability-requests";
import { insertInventedWorkflows, recordInventedWorkflowUses, type InventedWorkflowUseInput } from "./invented-workflows";
import { insertWorldEvents, insertWorldFacts, resolveWorldEvent, type NewWorldEvent } from "./events";

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
  /**
   * Day-level Chronicle timing (docs/32, Phase 11). Identical for every
   * entry today (nothing genuinely spans turns yet) -- `occurredAtDay` will
   * diverge from `finalizedAtDay` once a stage that commences on one turn
   * and completes on a later one exists (docs/32, Phase 8/9).
   */
  readonly occurredAtDay?: number;
  readonly finalizedAtDay?: number;
  readonly displayPatch?: unknown;
  readonly playerInvolvement?: unknown;
  // Extended Chronicle fields (all optional for backward compat).
  readonly eventDate?: string | null;
  readonly location?: string | null;
  readonly chainId?: string | null;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
  readonly directConsequences?: Array<{
    kind: string;
    label: string;
    entityId: string | null;
    quantified: boolean;
    /** Present only when derived from the generic entity-state diff -- the entity's resolved name. */
    entityName?: string;
    /** "created" | "deleted" | "updated" -- present alongside entityName. */
    changeKind?: string;
    /** Present only for "updated": every tracked field that actually changed. */
    fields?: Array<{ field: string; from: unknown; to: unknown }>;
  }>;
  /** Ephemeral cast supplied to the narrator and relevance system before the prose is persisted. */
  readonly characterMentions?: readonly { characterId: string; role: string }[];
  /** Ephemeral Chronicle ordering aid. It is deliberately not persisted as world state. */
  readonly simulatedDurationDays?: number;
  readonly causalFactIds?: readonly string[];
  /**
   * Ephemeral: the successful action ids this entry's body is actually drawn
   * from, used only to hold the narrator's rewrite to an outcome lock (e.g. a
   * "declares war" rewrite requires a successful `start_war` among these). Not
   * persisted as world state.
   */
  readonly factActionIds?: readonly string[];
  readonly sourceDirector?: "player" | "game_master" | "character_director" | "reaction_director" | "simulator" | "world_director";
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
  /** How much narrative space this entry earns (docs/14 Phase 4): a compact dispatch, a real paragraph, or a multi-paragraph scene. Defaults to "paragraph" when absent (pre-Phase-4 behavior). */
  readonly depth?: "dispatch" | "paragraph" | "scene";
  /**
   * Structured, deterministic facts about a resolved battle (docs/19 Phase
   * 3's `resolveBattle`), for the narrator to write from directly instead of
   * a pre-flattened summary string. Present only on a battle's own entry.
   */
  readonly battleBrief?: {
    readonly provinceName: string;
    readonly outcome: "attacker_victory" | "defender_victory" | "inconclusive";
    readonly attackerName: string;
    readonly defenderName: string;
    readonly attackerCommanderName: string | null;
    readonly defenderCommanderName: string | null;
    readonly attackerCasualties: number;
    readonly defenderCasualties: number;
    readonly retreated: readonly string[];
  };
  /**
   * Present when a named character flagged this turn that they want to open
   * a conversation with the player (flag_npc_initiated_dialogue). Surfaces an
   * "Initiated Chat" affordance on this entry; opening it seeds the
   * character's own opening line as the first message.
   */
  readonly initiatedDialogue?: {
    readonly characterId: string;
    readonly characterName: string;
    readonly topic: string;
    readonly openingLine: string;
  };
}

export interface CommitResolutionInput {
  readonly gameId: string;
  readonly turnId: string;
  readonly newWorld: WorldState;
  readonly elapsedStepEnd: number;
  readonly chronicleEntries: readonly ChronicleEntryInput[];
  readonly stopReason: string;
  /**
   * Shadow-mode elastic-scheduler output (docs/32, Phase 7) -- diagnostic
   * only. `elapsedStepEnd`/`stopReason` above remain the sole authoritative
   * values the live pipeline actually committed to; these three are written
   * purely so real shadow-mode comparison data (docs/32 Phase 16) exists
   * before any cutover is considered.
   */
  readonly elapsedDayEnd?: number;
  readonly stoppingFactIds?: readonly string[];
  readonly requestedPlayerDecision?: string | null;
  /** Workflow Manager audit blob; stored as JSONB on the turn row for offline review. */
  readonly workflowAudit?: WorkflowAuditBlob;
  /** Novel action proposals emitted by the Workflow Manager; persisted for developer review. */
  readonly novelActionProposals?: readonly NovelActionProposal[];
  /** Reusable templates that succeeded for the first time during this turn. */
  readonly inventedWorkflows?: readonly RuntimeInventedWorkflow[];
  /** Complete runtime-template use audit for this turn. */
  readonly inventedWorkflowUses?: readonly InventedWorkflowUseInput[];
  /**
   * Non-mutating capability-gap records from this turn (Game Master refactor).
   * Written inside the same transaction as the snapshot so the audit can never
   * disagree with the world about what was attempted.
   */
  readonly capabilityRequests?: readonly RecordedCapabilityRequest[];
  /** Structured Game Master report plus the factual event log the Chronicle was built from. */
  readonly gameMasterReport?: CommittedGameMasterReport;
  /** Per-call audit trail from the current GM tool loop (docs/27) -- distinct from `workflowAudit`. */
  readonly gameMasterAudit?: readonly WorkflowAuditEntry[];
  /**
   * docs/32 corrective pass, requirement 4: every Fact this turn produced --
   * the event queue's own handler-produced facts, world-tool facts
   * (`record_fact`), and every successful state-changing workflow's fact
   * (converted from `FactualEvent` at the call site) -- inserted into the
   * canonical `worldFacts` ledger inside this SAME transaction. No fact may
   * persist if the turn fails to commit; no state-changing success stays
   * Chronicle-only where a later agent cannot inspect it.
   */
  readonly worldFacts?: readonly Fact[];
  /** New/follow-up `WorldEvent`s the event queue staged this turn (never written by the loop itself -- see `EventLoopResult.pendingEventInserts`). */
  readonly pendingWorldEvents?: readonly NewWorldEvent[];
  /** Which claimed `WorldEvent`s this turn resolved, and with which fact ids -- see `EventLoopResult.pendingResolutions`. */
  readonly pendingEventResolutions?: readonly { readonly id: string; readonly atStep: number; readonly factIds: readonly string[] }[];
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
        ...(input.elapsedDayEnd !== undefined ? { elapsedDayEnd: input.elapsedDayEnd } : {}),
        ...(input.stoppingFactIds !== undefined ? { stoppingFactIds: [...input.stoppingFactIds] } : {}),
        ...(input.requestedPlayerDecision !== undefined ? { requestedPlayerDecision: input.requestedPlayerDecision } : {}),
        ...(input.workflowAudit !== undefined ? { workflowAudit: input.workflowAudit } : {}),
        ...(input.gameMasterReport !== undefined ? { gameMasterReport: input.gameMasterReport } : {}),
        ...(input.gameMasterAudit !== undefined ? { gameMasterAudit: input.gameMasterAudit } : {}),
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
            ...(entry.occurredAtDay !== undefined ? { occurredAtDay: entry.occurredAtDay } : {}),
            ...(entry.finalizedAtDay !== undefined ? { finalizedAtDay: entry.finalizedAtDay } : {}),
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
            ...(entry.depth !== undefined ? { depth: entry.depth } : {}),
            ...(entry.battleBrief !== undefined ? { battleBrief: entry.battleBrief } : {}),
            ...(entry.initiatedDialogue !== undefined ? { initiatedDialogue: entry.initiatedDialogue } : {}),
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
    if (input.capabilityRequests && input.capabilityRequests.length > 0) {
      await insertCapabilityRequests(tx as unknown as ChronicaDatabase, input.capabilityRequests, input.gameId, input.turnId);
    }
    if (input.inventedWorkflowUses && input.inventedWorkflowUses.length > 0) {
      await recordInventedWorkflowUses(tx as unknown as ChronicaDatabase, input.inventedWorkflowUses, input.turnId);
    }

    // docs/32 corrective pass, requirement 4: the event queue's staged
    // events/resolutions and every canonical Fact this turn produced commit
    // here, atomically with the snapshot above -- never before, never
    // outside this transaction.
    if (input.pendingWorldEvents && input.pendingWorldEvents.length > 0) {
      await insertWorldEvents(tx as unknown as ChronicaDatabase, input.gameId, input.pendingWorldEvents);
    }
    if (input.pendingEventResolutions && input.pendingEventResolutions.length > 0) {
      for (const resolution of input.pendingEventResolutions) {
        await resolveWorldEvent(tx as unknown as ChronicaDatabase, resolution.id, resolution.atStep, resolution.factIds);
      }
    }
    if (input.worldFacts && input.worldFacts.length > 0) {
      await insertWorldFacts(tx as unknown as ChronicaDatabase, input.gameId, input.turnId, input.worldFacts);
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
