import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { DialogueChannel, OrderBatch, ScenarioClock, WorldState } from "@chronica/shared";
import { ScenarioDefinitionSchema, WorldStateSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { dialogueMessages, dialogueSessions } from "../schema/dialogue";
import {
  characterClaims,
  chronicleEntries,
  games,
  orders,
  players,
  scenarioVersions,
  scenarios,
  turns,
  worldSnapshots,
} from "../schema/game";

// The persistence apps/web needs for a single-player demo match, built on the
// same tables and turn lifecycle apps/worker drives (docs/04). Scoped
// deliberately narrow: one active player per game, so "every active player has
// submitted" never needs the advisory lock apps/worker's TurnStore takes out for
// concurrent multi-party submission (docs/04's cited race). A multi-player
// version of this file belongs with that lock, not without it.

const OPEN_TURN_STATUSES = ["collecting", "queued", "resolving", "news"] as const;

export interface WorldViewSource {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly gameStatus: "lobby" | "active" | "finished" | "abandoned";
  readonly turnId: string;
  readonly turnIndex: number;
  readonly turnStatus: string;
  readonly submittedPlayers: number;
  readonly totalPlayers: number;
  readonly world: WorldState;
  readonly mapAssetId: string | null;
  readonly scenarioClock?: ScenarioClock;
}

/** The scenario row a slug resolves to, so createGame can pin a game to it. */
export async function findScenarioBySlug(
  db: ChronicaDatabase,
  slug: string,
): Promise<{ id: string; currentVersion: number } | undefined> {
  const [scenario] = await db
    .select({ id: scenarios.id, currentVersion: scenarios.currentVersion })
    .from(scenarios)
    .where(eq(scenarios.slug, slug))
    .limit(1);
  return scenario;
}

export interface CreateGameInput {
  readonly title: string;
  readonly scenarioId: string;
  readonly startingSeatCount: number;
  readonly extraPrincipalsPerPlayer: number;
  readonly newsTimeoutSeconds: number;
  readonly hostUserId: string;
  readonly coinBudgetMicroUnits: bigint;
}

/**
 * Creates a game pinned to a public scenario's current version, seats its host,
 * and opens turn 0 in one transaction.
 *
 * Starts `active` with turn 0 already `collecting`, not `lobby`: the fixture this
 * replaces has no separate "start the match" step, and every action.ts caller
 * already assumes the lobby and orders pages work the moment a game exists.
 */
export async function createGame(db: ChronicaDatabase, input: CreateGameInput): Promise<string> {
  return db.transaction(async (tx) => {
    const [scenario] = await tx
      .select({ id: scenarios.id, currentVersion: scenarios.currentVersion })
      .from(scenarios)
      .innerJoin(scenarioVersions, and(
        eq(scenarioVersions.scenarioId, scenarios.id),
        eq(scenarioVersions.version, scenarios.currentVersion),
      ))
      .where(and(
        eq(scenarios.id, input.scenarioId),
        eq(scenarios.visibility, "public"),
        ne(scenarios.authorId, input.hostUserId),
        isNotNull(scenarios.authorId),
        isNotNull(scenarioVersions.validatedAt),
      ))
      .limit(1);
    if (scenario === undefined) throw new Error("That shared world is unavailable.");

    const [version] = await tx
      .select({ initialWorld: scenarioVersions.initialWorld })
      .from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, scenario.id), eq(scenarioVersions.version, scenario.currentVersion)))
      .limit(1);
    if (version === undefined) throw new Error("That shared world has no playable version.");

    const initialWorld = WorldStateSchema.parse(version.initialWorld);

    const [game] = await tx
      .insert(games)
      .values({
        scenarioId: scenario.id,
        title: input.title,
        status: "active",
        newsTimeoutSeconds: input.newsTimeoutSeconds,
        // M1 has no AI calls and no real credit spend yet (docs/06); these pin the
        // rate card and profile a real billing/AI integration will read later.
        aiProfileVersion: 1,
        payerUserId: input.hostUserId,
        creditRateCardVersion: 1,
        creditBudgetMicrocredits: input.coinBudgetMicroUnits,
        scenarioVersion: scenario.currentVersion,
        libraryVersion: 1,
        startingSeatCount: input.startingSeatCount,
        extraPrincipalsPerPlayer: input.extraPrincipalsPerPlayer,
        createdBy: input.hostUserId,
      })
      .returning({ id: games.id });
    if (game === undefined) throw new Error("Failed to create game.");

    await tx.insert(players).values({
      gameId: game.id,
      userId: input.hostUserId,
      characterId: `pending:host:${input.hostUserId}`,
      status: "active",
    });

    const turnId = randomUUID();
    await tx.insert(turns).values({
      id: turnId,
      gameId: game.id,
      index: 0,
      status: "collecting",
      seed: `${game.id}:0`,
      openedAt: new Date(),
      elapsedStepStart: initialWorld.elapsedStep,
    });
    // No world_snapshots row here. The opening state for turn 0 is the
    // scenario's initialWorld (queried via latestWorld's fallback). The first
    // real snapshot is written when turn 0 resolves. Inserting a placeholder
    // with stateHash:"seed" would conflict with commitResolution and cause that
    // real snapshot to be silently dropped (ADR-0040).

    return game.id;
  });
}

/** Finds an existing player for (gameId, externalKey), or seats a new one. */
export async function findOrCreatePlayer(
  db: ChronicaDatabase,
  input: { readonly gameId: string; readonly userId: string; readonly externalKey: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.gameId, input.gameId), eq(players.userId, input.userId)))
      .limit(1);
    if (existing !== undefined) return existing.id;

    const [created] = await tx
      .insert(players)
      .values({
        gameId: input.gameId,
        userId: input.userId,
        // Replaced by the real character id as soon as a claim is made; a player
        // row must exist first because character_claims and orders reference it.
        characterId: `pending:${input.externalKey}`,
        status: "active",
      })
      .returning({ id: players.id });
    if (created === undefined) throw new Error("Failed to seat player.");
    return created.id;
  });
}

/** The open turn for a game -- collecting, queued, resolving or in news. */
/**
 * Narrowed to just `select`, so a transaction (`PgTransaction`, which lacks the
 * postgres-js driver's `$client`) can be passed wherever the top-level database
 * can: every caller here runs this inside its own transaction.
 */
type Queryable = Pick<ChronicaDatabase, "select">;

async function openTurn(
  db: Queryable,
  gameId: string,
): Promise<{ id: string; index: number; status: string; elapsedStepStart: number } | undefined> {
  const [turn] = await db
    .select({ id: turns.id, index: turns.index, status: turns.status, elapsedStepStart: turns.elapsedStepStart })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), inArray(turns.status, [...OPEN_TURN_STATUSES])))
    .orderBy(desc(turns.index))
    .limit(1);
  return turn;
}

/**
 * Submits one player's orders and enqueues the turn if that filled the roster.
 *
 * A row lock on the game (`for("update")`) stands in for apps/worker's advisory
 * lock: correct for exactly the single-active-player games this file supports,
 * where "every active player submitted" can never race with a second submitter.
 */
export async function submitPlayerOrder(
  db: ChronicaDatabase,
  input: {
    readonly gameId: string;
    readonly playerId: string;
    readonly rawText: string;
    readonly batch: OrderBatch;
  },
): Promise<{ accepted: boolean; enqueued: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select({ id: games.id }).from(games).where(eq(games.id, input.gameId)).for("update").limit(1);
    if (game === undefined) return { accepted: false, enqueued: false, reason: "No such game." };

    const [player] = await tx
      .select({ characterId: players.characterId })
      .from(players)
      .where(and(eq(players.id, input.playerId), eq(players.gameId, input.gameId), eq(players.status, "active")))
      .limit(1);
    if (player === undefined || player.characterId.startsWith("pending:")) {
      return { accepted: false, enqueued: false, reason: "Choose and resolve your character before submitting orders." };
    }
    if (player.characterId.startsWith("declared-")) {
      const [resolvedClaim] = await tx
        .select({ id: characterClaims.id })
        .from(characterClaims)
        .where(and(
          eq(characterClaims.gameId, input.gameId),
          eq(characterClaims.playerId, input.playerId),
          eq(characterClaims.characterId, player.characterId),
          isNotNull(characterClaims.resolvedRole),
          isNull(characterClaims.releasedAt),
        ))
        .limit(1);
      if (resolvedClaim === undefined) {
        return { accepted: false, enqueued: false, reason: "Your character is still being resolved. Your draft is safe; submit it when your place in the world is ready." };
      }
    }

    const turn = await openTurn(tx, input.gameId);
    if (turn === undefined || turn.status !== "collecting") {
      return { accepted: false, enqueued: false, reason: "The turn is not collecting orders." };
    }

    // The whole OrderBatch lands in `directives`, matching PostgresTurnStore.putOrder
    // -- `ordersFor` parses this column back into an OrderBatch wholesale, not just
    // the directive array, so a mismatch here would resolve every turn with none.
    await tx
      .insert(orders)
      .values({
        turnId: turn.id,
        playerId: input.playerId,
        rawText: input.rawText,
        directives: input.batch,
        intents: [],
        parseSource: "grammar",
      })
      .onConflictDoUpdate({
        target: [orders.turnId, orders.playerId],
        set: { rawText: input.rawText, directives: input.batch, submittedAt: new Date() },
      });

    const [activeRow] = await tx
      .select({ value: count(players.id) })
      .from(players)
      .where(and(eq(players.gameId, input.gameId), eq(players.status, "active")));
    const submitted = await tx.select({ playerId: orders.playerId }).from(orders).where(eq(orders.turnId, turn.id));

    if (submitted.length < (activeRow?.value ?? 0)) return { accepted: true, enqueued: false };

    await tx.update(turns).set({ status: "queued" }).where(eq(turns.id, turn.id));
    return { accepted: true, enqueued: true };
  });
}

/** The world a game's latest resolved turn left behind, for rendering. */
export async function getWorldView(db: ChronicaDatabase, gameId: string): Promise<WorldViewSource | undefined> {
  const [game] = await db
    .select({ id: games.id, title: games.title, status: games.status, scenarioId: games.scenarioId, scenarioVersion: games.scenarioVersion })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (game === undefined) return undefined;

  const [snapshot] = await db
    .select({
      turnId: worldSnapshots.turnId,
      state: worldSnapshots.state,
      turnIndex: turns.index,
      turnStatus: turns.status,
    })
    .from(worldSnapshots)
    .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
    .where(eq(turns.gameId, gameId))
    .orderBy(desc(turns.index))
    .limit(1);
  const open = await openTurn(db, gameId);
  const [latestTurn] = open === undefined
    ? await db.select({ id: turns.id, index: turns.index, status: turns.status }).from(turns).where(eq(turns.gameId, gameId)).orderBy(desc(turns.index)).limit(1)
    : [];
  const [totalRow] = await db
    .select({ value: count(players.id) })
    .from(players)
    .where(and(eq(players.gameId, gameId), eq(players.status, "active")));
  const totalPlayers = totalRow?.value ?? 0;

  let submittedPlayers = 0;
  if (open !== undefined) {
    const submitted = await db.select({ playerId: orders.playerId }).from(orders).where(eq(orders.turnId, open.id));
    submittedPlayers = submitted.length;
  }

  const [svRow] = await db
    .select({ definition: scenarioVersions.definition, initialWorld: scenarioVersions.initialWorld, mapAssetId: scenarioVersions.mapAssetId })
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.scenarioId, game.scenarioId), eq(scenarioVersions.version, game.scenarioVersion)))
    .limit(1);
  let scenarioClock: ScenarioClock | undefined;
  if (svRow !== undefined) {
    const parsed = ScenarioDefinitionSchema.safeParse(svRow.definition);
    if (parsed.success) scenarioClock = parsed.data.clock;
  }

  const fallbackWorld = svRow === undefined ? undefined : WorldStateSchema.safeParse(svRow.initialWorld);
  const renderedWorld = snapshot === undefined
    ? (fallbackWorld?.success ? fallbackWorld.data : undefined)
    : WorldStateSchema.parse(snapshot.state);
  if (renderedWorld === undefined) return undefined;
  return {
    gameId: game.id,
    gameTitle: game.title,
    gameStatus: game.status,
    turnId: open?.id ?? latestTurn?.id ?? snapshot?.turnId ?? "initial",
    turnIndex: open?.index ?? latestTurn?.index ?? snapshot?.turnIndex ?? 0,
    turnStatus: game.status === "finished" ? "finished" : open?.status ?? latestTurn?.status ?? snapshot?.turnStatus ?? "collecting",
    submittedPlayers,
    totalPlayers,
    world: renderedWorld,
    mapAssetId: svRow?.mapAssetId ?? null,
    ...(scenarioClock !== undefined ? { scenarioClock } : {}),
  };
}

export interface ChronicleView {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly gameStatus: "lobby" | "active" | "finished" | "abandoned";
  /** Presentation metadata from the scenario pinned to this game, never world state. */
  readonly scenarioClock?: ScenarioClock;
  readonly entries: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly body: string;
    readonly audience: "all_players" | "knowledge_scoped";
    readonly playerInvolvement: unknown;
    /** Parsed from the JSONB `facts` column; absent for legacy entries with no patch data. */
    readonly materialConsequence?: boolean;
    readonly displayPatch?: unknown;
    /** Simulation step of the event; legacy rows fall back to their turn's end step. */
    readonly atStep: number;
  }[];
}

/**
 * The latest turn's chronicle, whatever the game's status.
 *
 * Deliberately `latestTurn`, not the open turn: once a match is `finished` there
 * is no open turn left, and the closing summary apps/worker appends
 * (writeFinalSummary) lives on the last turn's chronicle, not a turn of its own.
 */
export async function getChronicleForLatestTurn(db: ChronicaDatabase, gameId: string): Promise<ChronicleView | undefined> {
  const [game] = await db
    .select({ status: games.status, scenarioId: games.scenarioId, scenarioVersion: games.scenarioVersion })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (game === undefined) return undefined;

  const [turn] = await db
    .select({ id: turns.id, index: turns.index, elapsedStepEnd: turns.elapsedStepEnd })
    .from(turns)
    .where(eq(turns.gameId, gameId))
    .orderBy(desc(turns.index))
    .limit(1);
  if (turn === undefined) return undefined;

  const rows = await db
    .select({
      id: chronicleEntries.id,
      sequence: chronicleEntries.sequence,
      body: chronicleEntries.body,
      audience: chronicleEntries.audience,
      playerInvolvement: chronicleEntries.playerInvolvement,
      facts: chronicleEntries.facts,
    })
    .from(chronicleEntries)
    .where(eq(chronicleEntries.turnId, turn.id))
    .orderBy(chronicleEntries.sequence);

  const [scenarioVersion] = await db
    .select({ definition: scenarioVersions.definition })
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.scenarioId, game.scenarioId), eq(scenarioVersions.version, game.scenarioVersion)))
    .limit(1);
  const parsedScenario = scenarioVersion === undefined ? null : ScenarioDefinitionSchema.safeParse(scenarioVersion.definition);
  const scenarioClock = parsedScenario?.success ? parsedScenario.data.clock : undefined;

  return {
    turnId: turn.id,
    turnIndex: turn.index,
    gameStatus: game.status,
    entries: rows.map((row) => {
      const factsData = row.facts;
      const isNewFormat =
        factsData !== null &&
        typeof factsData === "object" &&
        !Array.isArray(factsData) &&
        "ids" in factsData;
      const atStep = chronicleAtStep(factsData, turn.elapsedStepEnd ?? 0);
      return {
        id: row.id,
        sequence: row.sequence,
        body: row.body,
        audience: row.audience as "all_players" | "knowledge_scoped",
        playerInvolvement: row.playerInvolvement,
        atStep,
        ...(isNewFormat
          ? {
              materialConsequence: Boolean((factsData as { materialConsequence?: boolean }).materialConsequence),
              ...((factsData as unknown as { displayPatch?: unknown }).displayPatch !== undefined
                ? { displayPatch: (factsData as unknown as { displayPatch: unknown }).displayPatch }
                : {}),
            }
          : {}),
      };
    }),
    ...(scenarioClock === undefined ? {} : { scenarioClock }),
  };
}

function chronicleAtStep(value: unknown, fallback: number): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const atStep = (value as Record<string, unknown>).atStep;
  return typeof atStep === "number" && Number.isInteger(atStep) && atStep >= 0 ? atStep : fallback;
}

/** Thrown when a non-host attempts to end a game they don't own. */
export class NotGameHostError extends Error {
  constructor(gameId: string) {
    super(`Only the game host may request an end for game ${gameId}.`);
    this.name = "NotGameHostError";
  }
}

/**
 * Ends a match at the current safe boundary.
 *
 * Mirrors apps/worker's requestEnd (lifecycle.ts) for the single-active-player
 * case: a collecting or queued turn is cancelled and the game finishes at once,
 * because there is no in-flight resolution whose news would otherwise be lost.
 * During resolving or news the request is recorded and apps/worker's own
 * closeNewsBarrier finishes the boundary before the game becomes finished.
 */
export async function requestGameEnd(db: ChronicaDatabase, gameId: string, hostUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [game] = await tx.select({ id: games.id, createdBy: games.createdBy, endRequestedAt: games.endRequestedAt }).from(games).where(eq(games.id, gameId)).for("update").limit(1);
    if (game === undefined) return;
    if (game.createdBy !== hostUserId) throw new NotGameHostError(gameId);

    const endRequestedAt = game.endRequestedAt ?? new Date();
    await tx.update(games).set({ endRequestedAt, endRequestedBy: hostUserId }).where(eq(games.id, gameId));

    const turn = await openTurn(tx, gameId);
    if (turn !== undefined && (turn.status === "collecting" || turn.status === "queued")) {
      await tx.update(turns).set({ status: "cancelled" }).where(eq(turns.id, turn.id));
      await tx.update(games).set({ status: "finished", endedAt: new Date() }).where(eq(games.id, gameId));
    }
  });
}

/**
 * Returns a monotonically increasing revision number for a game.
 *
 * Used by the SSE stream to detect any state change — turn advances, phase
 * transitions, submission count changes, *and* completed dialogue replies —
 * without loading the full world snapshot on every poll.
 *
 * The value incorporates the latest turn's lifecycle phase as well as its
 * index. A turn becoming `news` is the moment its Chronicle and map patch are
 * committed; clients must observe that transition even though no new turn has
 * opened yet. Wall-clock time and UUIDs are deliberately excluded so the
 * revision remains stable after a server restart.
 */
export async function getGameRevision(db: ChronicaDatabase, gameId: string): Promise<number> {
  const [turn] = await db
    .select({ turnIndex: turns.index, status: turns.status })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), ne(turns.status, "cancelled")))
    .orderBy(desc(turns.index))
    .limit(1);

  const maxTurnIndex = turn?.turnIndex ?? 0;
  const phaseRank: Record<string, number> = {
    collecting: 0,
    queued: 1,
    resolving: 2,
    news: 3,
    resolved: 4,
    failed: 5,
    cancelled: 6,
  };
  const latestPhase = turn === undefined ? 0 : (phaseRank[turn.status] ?? 0);

  const [msgCount] = await db
    .select({ total: count(dialogueMessages.id) })
    .from(dialogueMessages)
    .innerJoin(dialogueSessions, eq(dialogueSessions.id, dialogueMessages.sessionId))
    .where(eq(dialogueSessions.gameId, gameId));

  const totalMessages = Math.min(msgCount?.total ?? 0, 99_999);
  return maxTurnIndex * 1_000_000 + latestPhase * 100_000 + totalMessages;
}

export interface ContactRow {
  readonly threadId: string;
  readonly npcCharacterId: string | null;
  readonly channel: DialogueChannel;
  readonly status: string;
  /** The original free-text role query; set only for provisional resolving_contact sessions. */
  readonly roleQuery: string | null;
}

/**
 * The player's order row for the currently-collecting turn, if any.
 *
 * "Open" here means specifically `collecting` -- the same status
 * `submitPlayerOrder` requires before it accepts a submission -- not the
 * broader `OPEN_TURN_STATUSES` used elsewhere in this file for "not yet
 * finished." Once a turn moves past `collecting`, there is nothing left to
 * restore into an editable composer.
 */
export async function getPlayerOrderForOpenTurn(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<{ turnIndex: number; batch: OrderBatch } | undefined> {
  const [turn] = await db
    .select({ id: turns.id, index: turns.index })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), eq(turns.status, "collecting")))
    .orderBy(desc(turns.index))
    .limit(1);
  if (turn === undefined) return undefined;

  const [order] = await db
    .select({ directives: orders.directives })
    .from(orders)
    .where(and(eq(orders.turnId, turn.id), eq(orders.playerId, playerId)))
    .limit(1);
  if (order === undefined) return undefined;

  return { turnIndex: turn.index, batch: { directives: order.directives as OrderBatch["directives"] } };
}

/**
 * The changed-region-IDs payload for a game's most recently resolved turn.
 *
 * Same cheapness class as `getGameRevision`: a narrow column read, never the
 * full snapshot, so the events route can decide whether a live update needs
 * a map patch without paying for `getWorldView`.
 */
export async function getLatestTurnEventMeta(
  db: ChronicaDatabase,
  gameId: string,
): Promise<{ changedRegionIds: readonly string[] } | undefined> {
  const [turn] = await db
    .select({ changedRegionIds: turns.changedRegionIds })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), inArray(turns.status, ["news", "resolved"])))
    .orderBy(desc(turns.index))
    .limit(1);
  if (turn === undefined) return undefined;
  return { changedRegionIds: turn.changedRegionIds };
}

/** The dialogue threads a player has open in a game. */
export async function listDialogueThreads(db: ChronicaDatabase, gameId: string, playerId: string): Promise<readonly ContactRow[]> {
  const rows = await db
    .select({
      threadId: dialogueSessions.threadId,
      npcCharacterId: dialogueSessions.npcCharacterId,
      channel: dialogueSessions.channel,
      status: dialogueSessions.status,
      roleQuery: dialogueSessions.roleQuery,
    })
    .from(dialogueSessions)
    .where(and(eq(dialogueSessions.gameId, gameId), eq(dialogueSessions.playerId, playerId), ne(dialogueSessions.status, "discarded")))
    .orderBy(desc(dialogueSessions.createdAt));
  return rows.map((row) => ({ ...row, channel: row.channel as DialogueChannel }));
}

/**
 * Opens a session for a role query, or returns the caller's existing one.
 *
 * Resolves every query to the same seeded contact rather than a role-matched
 * NPC: matching a free-text role to a character deterministically is the same
 * unbuilt resolution claimCharacterForPlayer defers for a declared character
 * (M1 gap), and this is the one substitute that lets a real message still reach
 * the leased reply queue apps/worker already drains.
 */
export async function findOrOpenDialogueThread(
  db: ChronicaDatabase,
  input: {
    readonly gameId: string;
    readonly playerId: string;
    readonly playerCharacterId: string;
    readonly npcCharacterId: string;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const turn = await openTurn(tx, input.gameId);
    if (turn === undefined || turn.status !== "collecting") {
      throw new Error(`Game ${input.gameId} is not collecting dialogue.`);
    }

    const [existing] = await tx
      .select({ threadId: dialogueSessions.threadId })
      .from(dialogueSessions)
      .where(and(
        eq(dialogueSessions.turnId, turn.id),
        eq(dialogueSessions.playerId, input.playerId),
        eq(dialogueSessions.npcCharacterId, input.npcCharacterId),
      ))
      .limit(1);
    if (existing !== undefined) return existing.threadId;

    const sessionId = randomUUID();
    // A thread names the enduring relationship; its sessions are each anchored
    // to one turn-opening snapshot. Reuse the old thread when this contact is
    // reopened in a later turn, rather than leaving the drawer pointing at a
    // thread whose newest session can never be answered.
    const [prior] = await tx
      .select({ threadId: dialogueSessions.threadId })
      .from(dialogueSessions)
      .where(and(
        eq(dialogueSessions.gameId, input.gameId),
        eq(dialogueSessions.playerId, input.playerId),
        eq(dialogueSessions.npcCharacterId, input.npcCharacterId),
      ))
      .orderBy(desc(dialogueSessions.createdAt))
      .limit(1);
    const threadId = prior?.threadId ?? randomUUID();
    const channel = "in_person_private" as const;

    // The baseStateHash grounds this dialogue session to the world state at the
    // start of the current turn. Query the most recently committed snapshot for
    // this game — the snapshot committed when the previous turn resolved.  For
    // turn 0 (no prior resolved snapshot), there is no hash yet; use the empty
    // string as a sentinel the worker can detect and fill from the scenario's
    // initialWorld. The sentinel is never "seed" because "seed" was a magic
    // string that silently disabled hash validation (ADR-0040).
    const [latestSnapshot] = await tx
      .select({ stateHash: worldSnapshots.stateHash })
      .from(worldSnapshots)
      .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
      .where(and(eq(turns.gameId, input.gameId), eq(turns.status, "resolved")))
      .orderBy(desc(turns.index))
      .limit(1);
    const baseStateHash = latestSnapshot?.stateHash ?? "";

    // A minimally valid DialogueOverlay (dialogue.ts), not an empty object: the
    // worker casts `overlaysFor`'s rows straight to DialogueOverlay with no
    // runtime validation, so a shape missing its required fields would compile
    // here and throw only later, inside a resolution the player cannot see.
    const overlay = {
      sessionId,
      threadId,
      playerCharacterId: input.playerCharacterId,
      npcCharacterId: input.npcCharacterId,
      channel,
      baseStateHash,
      disclosedFactIds: [],
      acts: [],
      witnessIds: [],
      visibility: "private" as const,
      encounterCandidate: null,
      openedAtStep: turn.elapsedStepStart,
    };
    await tx.insert(dialogueSessions).values({
      id: sessionId,
      threadId,
      gameId: input.gameId,
      turnId: turn.id,
      playerId: input.playerId,
      npcCharacterId: input.npcCharacterId,
      baseStateHash,
      channel,
      visibility: "private",
      threadContext: {},
      overlay,
      status: "open",
    });
    return threadId;
  });
}

/**
 * Creates a provisional `resolving_contact` session for a novel role query, or
 * returns the existing session's threadId when one already exists for this
 * (gameId, playerId, roleQuery) in the current collecting turn.
 *
 * The session has no confirmed npcCharacterId yet -- the worker's contact queue
 * fills that in when its AI operation resolves the role (ADR-0058). Until then
 * the session shows as `pending` in the chat drawer.
 */
export async function openProvisionalContactThread(
  db: ChronicaDatabase,
  input: {
    readonly gameId: string;
    readonly playerId: string;
    readonly playerCharacterId: string;
    readonly roleQuery: string;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const turn = await openTurn(tx, input.gameId);
    if (turn === undefined || turn.status !== "collecting") {
      throw new Error(`Game ${input.gameId} is not collecting dialogue.`);
    }

    // Deduplicate by (turnId, playerId, roleQuery): reuse any existing session
    // in this turn for the same role description rather than stacking queries.
    const [existing] = await tx
      .select({ threadId: dialogueSessions.threadId })
      .from(dialogueSessions)
      .where(and(
        eq(dialogueSessions.turnId, turn.id),
        eq(dialogueSessions.playerId, input.playerId),
        eq(dialogueSessions.roleQuery, input.roleQuery),
      ))
      .limit(1);
    if (existing !== undefined) return existing.threadId;

    // Reuse the thread across turns for the same role query, same as
    // findOrOpenDialogueThread does for known npcCharacterIds.
    const [prior] = await tx
      .select({ threadId: dialogueSessions.threadId })
      .from(dialogueSessions)
      .where(and(
        eq(dialogueSessions.gameId, input.gameId),
        eq(dialogueSessions.playerId, input.playerId),
        eq(dialogueSessions.roleQuery, input.roleQuery),
      ))
      .orderBy(desc(dialogueSessions.createdAt))
      .limit(1);
    const threadId = prior?.threadId ?? randomUUID();
    const sessionId = randomUUID();
    const channel = "in_person_private" as const;

    const [latestSnapshot] = await tx
      .select({ stateHash: worldSnapshots.stateHash })
      .from(worldSnapshots)
      .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
      .where(and(eq(turns.gameId, input.gameId), eq(turns.status, "resolved")))
      .orderBy(desc(turns.index))
      .limit(1);
    const baseStateHash = latestSnapshot?.stateHash ?? "";

    // Store playerCharacterId in threadContext so the worker can build a valid
    // overlay when it completes the resolution with a real npcCharacterId.
    const overlay = {
      sessionId,
      threadId,
      playerCharacterId: input.playerCharacterId,
      npcCharacterId: `npc:resolving:${sessionId.replace(/-/g, "").slice(0, 16)}`,
      channel,
      baseStateHash: baseStateHash.length > 0 ? baseStateHash : "resolving",
      disclosedFactIds: [],
      acts: [],
      witnessIds: [],
      visibility: "private" as const,
      encounterCandidate: null,
      openedAtStep: turn.elapsedStepStart,
    };
    await tx.insert(dialogueSessions).values({
      id: sessionId,
      threadId,
      gameId: input.gameId,
      turnId: turn.id,
      playerId: input.playerId,
      npcCharacterId: null,
      roleQuery: input.roleQuery,
      provisional: true,
      baseStateHash: overlay.baseStateHash,
      channel,
      visibility: "private",
      threadContext: { playerCharacterId: input.playerCharacterId },
      overlay,
      status: "resolving_contact",
    });
    return threadId;
  });
}

export interface PendingContactResolution {
  readonly sessionId: string;
  readonly threadId: string;
  readonly gameId: string;
  readonly turnId: string;
  readonly playerId: string;
  readonly playerCharacterId: string;
  readonly roleQuery: string;
  readonly baseStateHash: string;
}

/**
 * Claims one pending `resolving_contact` session for the worker to resolve,
 * mirroring `claimPendingReply`'s lease pattern so a crashed worker releases
 * its session rather than stranding it.
 */
export async function claimPendingContactResolution(
  db: ChronicaDatabase,
  workerId: string,
  now: number,
  leaseMs: number,
): Promise<PendingContactResolution | undefined> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: dialogueSessions.id })
      .from(dialogueSessions)
      .where(
        and(
          eq(dialogueSessions.status, "resolving_contact"),
          or(
            isNull(dialogueSessions.claimedBy),
            lte(dialogueSessions.claimExpiresAt, new Date(now)),
          ),
        ),
      )
      .orderBy(asc(dialogueSessions.createdAt), asc(dialogueSessions.id))
      .limit(1)
      .for("update", { skipLocked: true });

    if (candidate === undefined) return undefined;

    const [claimed] = await tx
      .update(dialogueSessions)
      .set({ claimedBy: workerId, claimExpiresAt: new Date(now + leaseMs) })
      .where(eq(dialogueSessions.id, candidate.id))
      .returning({
        id: dialogueSessions.id,
        threadId: dialogueSessions.threadId,
        gameId: dialogueSessions.gameId,
        turnId: dialogueSessions.turnId,
        playerId: dialogueSessions.playerId,
        roleQuery: dialogueSessions.roleQuery,
        threadContext: dialogueSessions.threadContext,
        baseStateHash: dialogueSessions.baseStateHash,
      });

    if (claimed === undefined || claimed.roleQuery === null) return undefined;

    const ctx = claimed.threadContext as { playerCharacterId?: string } | null;
    const playerCharacterId = ctx?.playerCharacterId ?? "";
    if (playerCharacterId.length === 0) return undefined;

    return {
      sessionId: claimed.id,
      threadId: claimed.threadId,
      gameId: claimed.gameId,
      turnId: claimed.turnId,
      playerId: claimed.playerId,
      playerCharacterId,
      roleQuery: claimed.roleQuery,
      baseStateHash: claimed.baseStateHash,
    };
  });
}

/**
 * Transitions a resolved contact session to `open` with its confirmed NPC.
 *
 * Writes the resolved NPC's name and role label into `threadContext` so
 * `buildContactIdentity` can display them without needing the NPC in
 * `world.characters` (provisional contacts are new characters, introduced at
 * the next turn boundary when `applyCharacterIntroductions` runs).
 */
export async function completeContactResolution(
  db: ChronicaDatabase,
  input: {
    readonly sessionId: string;
    readonly npcId: string;
    readonly name: string;
    readonly roleLabel: string;
    readonly channel: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        id: dialogueSessions.id,
        threadId: dialogueSessions.threadId,
        gameId: dialogueSessions.gameId,
        turnId: dialogueSessions.turnId,
        playerId: dialogueSessions.playerId,
        overlay: dialogueSessions.overlay,
        threadContext: dialogueSessions.threadContext,
        baseStateHash: dialogueSessions.baseStateHash,
      })
      .from(dialogueSessions)
      .where(eq(dialogueSessions.id, input.sessionId))
      .limit(1);
    if (session === undefined) return;

    const ctx = session.threadContext as { playerCharacterId?: string } | null;
    const playerCharacterId = ctx?.playerCharacterId ?? "";
    const priorOverlay = session.overlay as Record<string, unknown>;
    const overlay = {
      ...priorOverlay,
      npcCharacterId: input.npcId,
      baseStateHash: session.baseStateHash.length > 0 && session.baseStateHash !== "resolving"
        ? session.baseStateHash
        : "",
      playerCharacterId,
    };
    await tx
      .update(dialogueSessions)
      .set({
        npcCharacterId: input.npcId,
        status: "open",
        channel: input.channel,
        claimedBy: null,
        claimExpiresAt: null,
        threadContext: { playerCharacterId, resolvedNpcName: input.name, resolvedRoleLabel: input.roleLabel },
        overlay,
      })
      .where(eq(dialogueSessions.id, input.sessionId));
  });
}

/** Releases the contact resolution lease so the session is retried by another tick. */
export async function failContactResolution(db: ChronicaDatabase, sessionId: string): Promise<void> {
  await db
    .update(dialogueSessions)
    .set({ claimedBy: null, claimExpiresAt: null })
    .where(eq(dialogueSessions.id, sessionId));
}

export interface MessageRow {
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly speakerCharacterId: string;
  readonly body: string;
  readonly acts: unknown;
  readonly disclosedFactIds: unknown;
  readonly clientRequestId: string | null;
  readonly status: string;
}

/** Every message in a thread's most recent session, in sequence order. */
export async function listThreadMessages(db: ChronicaDatabase, threadId: string): Promise<readonly MessageRow[]> {
  const [session] = await db
    .select({ id: dialogueSessions.id })
    .from(dialogueSessions)
    .where(eq(dialogueSessions.threadId, threadId))
    .orderBy(desc(dialogueSessions.createdAt))
    .limit(1);
  if (session === undefined) return [];

  const rows = await db
    .select({
      id: dialogueMessages.id,
      sessionId: dialogueMessages.sessionId,
      sequence: dialogueMessages.sequence,
      speakerCharacterId: dialogueMessages.speakerCharacterId,
      body: dialogueMessages.body,
      acts: dialogueMessages.acts,
      disclosedFactIds: dialogueMessages.disclosedFactIds,
      clientRequestId: dialogueMessages.clientRequestId,
      status: dialogueMessages.status,
    })
    .from(dialogueMessages)
    .where(eq(dialogueMessages.sessionId, session.id))
    .orderBy(dialogueMessages.sequence);
  return rows;
}

/**
 * Returns the set of fact IDs disclosed by an NPC across all their sessions in
 * a game. Used to ground the continueDialogue prompt with what the NPC actually
 * knows rather than an empty context.
 */
export async function getKnownFactIdsForNpc(
  db: ChronicaDatabase,
  gameId: string,
  npcCharacterId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ overlay: dialogueSessions.overlay })
    .from(dialogueSessions)
    .where(and(eq(dialogueSessions.gameId, gameId), eq(dialogueSessions.npcCharacterId, npcCharacterId)));

  const ids = new Set<string>();
  for (const row of rows) {
    const overlay = row.overlay as { disclosedFactIds?: unknown };
    if (Array.isArray(overlay?.disclosedFactIds)) {
      for (const id of overlay.disclosedFactIds) {
        if (typeof id === "string") ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Appends the human player's message as `pending`, for apps/worker's leased
 * dialogue queue to answer for real (postgres-dialogue-queue.ts).
 */
export async function sendPlayerDialogueMessage(
  db: ChronicaDatabase,
  input: { readonly threadId: string; readonly playerId: string; readonly speakerCharacterId: string; readonly body: string; readonly requestId?: string },
): Promise<"accepted" | "duplicate"> {
  let outcome: "accepted" | "duplicate" = "accepted";
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        id: dialogueSessions.id,
        gameId: dialogueSessions.gameId,
        turnId: dialogueSessions.turnId,
        playerId: dialogueSessions.playerId,
        npcCharacterId: dialogueSessions.npcCharacterId,
        channel: dialogueSessions.channel,
        visibility: dialogueSessions.visibility,
        threadContext: dialogueSessions.threadContext,
        baseStateHash: dialogueSessions.baseStateHash,
        status: dialogueSessions.status,
      })
      .from(dialogueSessions)
      .where(and(eq(dialogueSessions.threadId, input.threadId), eq(dialogueSessions.playerId, input.playerId)))
      .orderBy(desc(dialogueSessions.createdAt))
      .limit(1);
    if (session === undefined) throw new Error(`No dialogue session for thread ${input.threadId}.`);
    if (session.status !== "open") throw new Error("This conversation is no longer open.");

    // Lock the live turn before accepting a message. The worker's second check
    // remains essential for queued work, but this prevents a known old session
    // from being written as pending in the first place.
    const [turn] = await tx
      .select({ id: turns.id, elapsedStepStart: turns.elapsedStepStart })
      .from(turns)
      .where(and(eq(turns.gameId, session.gameId), eq(turns.status, "collecting")))
      .orderBy(desc(turns.index))
      .limit(1)
      .for("update");
    if (turn === undefined) throw new Error("This turn is no longer accepting conversations.");

    let activeSession = session;
    if (session.turnId !== turn.id) {
      if (session.npcCharacterId === null) throw new Error("This conversation is no longer available.");
      const sessionId = randomUUID();
      const overlay = {
        sessionId,
        threadId: input.threadId,
        playerCharacterId: input.speakerCharacterId,
        npcCharacterId: session.npcCharacterId,
        channel: session.channel as DialogueChannel,
        baseStateHash: session.baseStateHash,
        disclosedFactIds: [],
        acts: [],
        witnessIds: [],
        visibility: "private" as const,
        encounterCandidate: null,
        openedAtStep: turn.elapsedStepStart,
      };
      const [reopened] = await tx
        .insert(dialogueSessions)
        .values({
          id: sessionId,
          threadId: input.threadId,
          gameId: session.gameId,
          turnId: turn.id,
          playerId: input.playerId,
          npcCharacterId: session.npcCharacterId,
          baseStateHash: session.baseStateHash,
          channel: session.channel,
          visibility: session.visibility,
          threadContext: session.threadContext,
          overlay,
          status: "open",
        })
        .returning({
          id: dialogueSessions.id,
          gameId: dialogueSessions.gameId,
          turnId: dialogueSessions.turnId,
          playerId: dialogueSessions.playerId,
          npcCharacterId: dialogueSessions.npcCharacterId,
          channel: dialogueSessions.channel,
          visibility: dialogueSessions.visibility,
          threadContext: dialogueSessions.threadContext,
          baseStateHash: dialogueSessions.baseStateHash,
          status: dialogueSessions.status,
        });
      if (reopened === undefined) throw new Error("Unable to reopen this conversation for the current turn.");
      activeSession = reopened;
    }

    if (input.requestId !== undefined) {
      const [duplicate] = await tx
        .select({ id: dialogueMessages.id })
        .from(dialogueMessages)
        .where(and(eq(dialogueMessages.sessionId, activeSession.id), eq(dialogueMessages.clientRequestId, input.requestId)))
        .limit(1);
      if (duplicate !== undefined) {
        outcome = "duplicate";
        return;
      }
    }

    // Locking the session serialises two rapid sends from the same player. A
    // pending or claimed player message means there is exactly one reply in
    // flight; append-only history remains intact, but another prompt cannot
    // overtake it in the worker queue.
    await tx.select({ id: dialogueSessions.id }).from(dialogueSessions).where(eq(dialogueSessions.id, activeSession.id)).for("update");
    const existing = await tx
      .select({ sequence: dialogueMessages.sequence, status: dialogueMessages.status, speakerCharacterId: dialogueMessages.speakerCharacterId })
      .from(dialogueMessages)
      .where(eq(dialogueMessages.sessionId, activeSession.id));
    if (existing.some((message) => message.speakerCharacterId === input.speakerCharacterId && (message.status === "pending" || message.status === "claimed"))) {
      throw new Error("A reply to your previous message is still pending.");
    }
    const nextSequence = existing.reduce((max, row) => Math.max(max, row.sequence), -1) + 1;

    await tx.insert(dialogueMessages).values({
      sessionId: activeSession.id,
      sequence: nextSequence,
      speakerCharacterId: input.speakerCharacterId,
      body: input.body,
      acts: [],
      disclosedFactIds: [],
      clientRequestId: input.requestId ?? null,
      status: "pending",
    });
  });
  return outcome;
}
