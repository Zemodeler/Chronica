import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { OrderBatch, ScenarioChronicleRules, ScenarioClock, ScenarioGovernmentRules, ScenarioLifeRules, WorkflowAuditBlob, WorldState } from "@chronica/shared";
import { ScenarioDefinitionSchema, WorldStateSchema, projectChronicleEntry, resolveChronicleVisibility, type ChronicleEntryProjection } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
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
  /** Life stages, mortality/incapacity rates, and inheritance rules (character-sim phase 5). */
  readonly scenarioLife?: ScenarioLifeRules;
  /** Offices and succession rules, so a vacated seat can be matched to its lawful refill route. */
  readonly scenarioGovernment?: ScenarioGovernmentRules;
  /** Opening context, tensions, and terminology — the scenario constitution the Game Master reads. */
  readonly scenarioChronicle?: ScenarioChronicleRules;
  /** 1 = today's single-GM path, 2 = the multi-agent dispatcher (docs/32, Part B.7). */
  readonly agentArchitectureVersion: number;
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
/**
 * Persist pre-turn canonical setup (character confirmation or a discovered
 * person) on the currently open turn.  Unlike an authored scenario this is
 * game-local state, so every normal reader sees the same world immediately.
 * Resolution replaces this pre-turn snapshot with its resolved snapshot.
 */
export async function persistOpeningWorld(db: ChronicaDatabase, gameId: string, world: WorldState): Promise<void> {
  const worldJson = JSON.stringify(WorldStateSchema.parse(world));
  const stateHash = createHash("sha256").update(worldJson).digest("hex");
  await db.transaction(async (tx) => {
    const [turn] = await tx
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.gameId, gameId), inArray(turns.status, [...OPEN_TURN_STATUSES])))
      .orderBy(desc(turns.index))
      .limit(1);
    if (turn === undefined) throw new Error("Cannot materialise a character without an open turn.");
    await tx.insert(worldSnapshots).values({
      turnId: turn.id,
      state: JSON.parse(worldJson) as unknown,
      schemaVersion: world.schemaVersion,
      stateHash,
    }).onConflictDoUpdate({
      target: worldSnapshots.turnId,
      set: { state: JSON.parse(worldJson) as unknown, schemaVersion: world.schemaVersion, stateHash },
    });
  });
}

export async function getWorldView(db: ChronicaDatabase, gameId: string): Promise<WorldViewSource | undefined> {
  const [game] = await db
    .select({
      id: games.id, title: games.title, status: games.status, scenarioId: games.scenarioId, scenarioVersion: games.scenarioVersion,
      agentArchitectureVersion: games.agentArchitectureVersion,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (game === undefined) return undefined;

  // Queries 2, 3, 6, 8 are all independent — run in parallel after game fetch.
  const [snapshotRows, open, totalRow, svRows] = await Promise.all([
    db
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
      .limit(1),
    openTurn(db, gameId),
    db
      .select({ value: count(players.id) })
      .from(players)
      .where(and(eq(players.gameId, gameId), eq(players.status, "active"))),
    db
      .select({ definition: scenarioVersions.definition, initialWorld: scenarioVersions.initialWorld, mapAssetId: scenarioVersions.mapAssetId })
      .from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, game.scenarioId), eq(scenarioVersions.version, game.scenarioVersion)))
      .limit(1),
  ]);
  const [snapshot] = snapshotRows;
  const [svRow] = svRows;
  const totalPlayers = totalRow[0]?.value ?? 0;

  // Conditional queries depend on `open` — batch them together.
  const [latestTurnRows, newsTurnRows, submittedRows] = await Promise.all([
    open === undefined
      ? db.select({ id: turns.id, index: turns.index, status: turns.status }).from(turns).where(eq(turns.gameId, gameId)).orderBy(desc(turns.index)).limit(1)
      : Promise.resolve([] as { id: string; index: number; status: string }[]),
    // If the open turn is collecting but a "news" turn also exists (the previous turn
    // is pending chronicle read), surface "news" so the game shell shows the chronicle.
    open?.status === "collecting"
      ? db.select({ id: turns.id }).from(turns).where(and(eq(turns.gameId, gameId), eq(turns.status, "news"))).limit(1)
      : Promise.resolve([] as { id: string }[]),
    open !== undefined
      ? db.select({ playerId: orders.playerId }).from(orders).where(eq(orders.turnId, open.id))
      : Promise.resolve([] as { playerId: string }[]),
  ]);
  const [latestTurn] = latestTurnRows;
  const hasPendingNews = newsTurnRows[0] !== undefined;
  const submittedPlayers = submittedRows.length;
  let scenarioClock: ScenarioClock | undefined;
  let scenarioLife: ScenarioLifeRules | undefined;
  let scenarioGovernment: ScenarioGovernmentRules | undefined;
  let scenarioChronicle: ScenarioChronicleRules | undefined;
  if (svRow !== undefined) {
    const parsed = ScenarioDefinitionSchema.safeParse(svRow.definition);
    if (parsed.success) {
      scenarioClock = parsed.data.clock;
      scenarioLife = parsed.data.life;
      scenarioGovernment = parsed.data.government;
      scenarioChronicle = parsed.data.chronicle;
    }
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
    turnStatus: game.status === "finished" ? "finished" : hasPendingNews ? "news" : open?.status ?? latestTurn?.status ?? snapshot?.turnStatus ?? "collecting",
    submittedPlayers,
    totalPlayers,
    world: renderedWorld,
    mapAssetId: svRow?.mapAssetId ?? null,
    agentArchitectureVersion: game.agentArchitectureVersion,
    ...(scenarioClock !== undefined ? { scenarioClock } : {}),
    ...(scenarioLife !== undefined ? { scenarioLife } : {}),
    ...(scenarioGovernment !== undefined ? { scenarioGovernment } : {}),
    ...(scenarioChronicle !== undefined ? { scenarioChronicle } : {}),
  };
}

/**
 * The workflow audit blob `commitResolution` persists every turn
 * (`packages/db/src/queries/resolution.ts`), for the admin
 * order-operation-inspector's per-battle audit surface (docs/19 Phase 3
 * follow-on: this data was already written but unreachable from any query).
 * Defaults to the game's latest turn; pass `turnIndex` for a specific one.
 */
export async function getWorkflowAudit(db: ChronicaDatabase, gameId: string, turnIndex?: number): Promise<WorkflowAuditBlob | undefined> {
  const [row] = await db
    .select({ workflowAudit: turns.workflowAudit })
    .from(turns)
    .where(turnIndex === undefined ? eq(turns.gameId, gameId) : and(eq(turns.gameId, gameId), eq(turns.index, turnIndex)))
    .orderBy(desc(turns.index))
    .limit(1);
  return row?.workflowAudit ?? undefined;
}

export interface ChronicleView {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly gameStatus: "lobby" | "active" | "finished" | "abandoned";
  /** Presentation metadata from the scenario pinned to this game, never world state. */
  readonly scenarioClock?: ScenarioClock;
  /** Compact, player-safe per-turn header (character-sim phase 6); absent for legacy turns. */
  readonly dispatch?: {
    readonly headline: string;
    readonly items: readonly string[];
    readonly uncertaintyNote: string | null;
  };
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
    // Extended Chronicle fields (all optional — absent on legacy entries).
    readonly eventDate?: string | null;
    readonly location?: string | null;
    readonly chainId?: string | null;
    readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
    readonly directConsequences?: readonly {
      kind: string;
      label: string;
      entityId: string | null;
      quantified: boolean;
      entityName?: string;
      changeKind?: string;
      fields?: readonly { field: string; from: unknown; to: unknown }[];
    }[];
    readonly sourceDirector?: string;
    readonly openPressure?: boolean;
    // Chronicle-first legibility fields (character-sim phase 6, all optional — absent on legacy entries).
    readonly title?: string;
    readonly knowledgeStatus?: "confirmed" | "report" | "rumour" | "suspicion";
    readonly participants?: readonly { readonly name: string; readonly role?: string }[];
    readonly places?: readonly { readonly name: string }[];
    readonly institutions?: readonly { readonly name: string }[];
    readonly playerRelevance?: "high" | "medium" | "low" | "none";
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
    readonly lifeEvent?: {
      readonly characterId: string;
      readonly characterName: string;
      readonly kind: "death" | "incapacitation" | "recovery";
      readonly cause: string;
      readonly estateOutcome: string | null;
      readonly vacatedOfficeIds: readonly string[];
    };
    readonly commandChange?: {
      readonly forceName: string;
      readonly previousCommanderName: string | null;
      readonly newCommanderName: string | null;
      readonly reason: string;
    };
    readonly familyEvent?: {
      readonly contractId: string;
      readonly type: string;
      readonly partyNames: readonly string[];
      readonly outcome: string;
    };
    readonly initiatedDialogue?: {
      readonly characterId: string;
      readonly characterName: string;
      readonly topic: string;
      readonly openingLine: string;
    };
  }[];
}

/**
 * The latest turn's chronicle, whatever the game's status.
 *
 * Deliberately `latestTurn`, not the open turn: once a match is `finished` there
 * is no open turn left, and the closing summary apps/worker appends
 * (writeFinalSummary) lives on the last turn's chronicle, not a turn of its own.
 */
export async function getChronicleForLatestTurn(
  db: ChronicaDatabase,
  gameId: string,
  viewerCharacterId?: string,
): Promise<ChronicleView | undefined> {
  // game and turn are both independent — fetch in parallel.
  const [gameRows, turnRows] = await Promise.all([
    db
      .select({ status: games.status, scenarioId: games.scenarioId, scenarioVersion: games.scenarioVersion })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1),
    db
      .select({ id: turns.id, index: turns.index, elapsedStepEnd: turns.elapsedStepEnd })
      .from(turns)
      .where(and(eq(turns.gameId, gameId), eq(turns.status, "news")))
      .orderBy(desc(turns.index))
      .limit(1),
  ]);
  const [game] = gameRows;
  const [turn] = turnRows;
  if (game === undefined || turn === undefined) return undefined;

  // chronicle entries, scenario version, and this turn's post-resolution world
  // snapshot (needed only for its `characterBeliefs`, to gate knowledge-scoped
  // visibility) are all independent — fetch in parallel.
  const [rows, scenarioVersionRows, snapshotRows] = await Promise.all([
    db
      .select({
        id: chronicleEntries.id,
        sequence: chronicleEntries.sequence,
        scope: chronicleEntries.scope,
        scopeRef: chronicleEntries.scopeRef,
        body: chronicleEntries.body,
        audience: chronicleEntries.audience,
        playerInvolvement: chronicleEntries.playerInvolvement,
        facts: chronicleEntries.facts,
      })
      .from(chronicleEntries)
      .where(eq(chronicleEntries.turnId, turn.id))
      .orderBy(chronicleEntries.sequence),
    db
      .select({ definition: scenarioVersions.definition })
      .from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, game.scenarioId), eq(scenarioVersions.version, game.scenarioVersion)))
      .limit(1),
    db
      .select({ state: worldSnapshots.state })
      .from(worldSnapshots)
      .where(eq(worldSnapshots.turnId, turn.id))
      .limit(1),
  ]);
  const [scenarioVersion] = scenarioVersionRows;
  const parsedScenario = scenarioVersion === undefined ? null : ScenarioDefinitionSchema.safeParse(scenarioVersion.definition);
  const scenarioClock = parsedScenario?.success ? parsedScenario.data.clock : undefined;

  const [snapshot] = snapshotRows;
  const parsedWorld = snapshot === undefined ? null : WorldStateSchema.safeParse(snapshot.state);
  const characterBeliefs = parsedWorld?.success ? parsedWorld.data.characterBeliefs : [];

  type FactsBlob = {
    materialConsequence?: boolean;
    displayPatch?: unknown;
    eventDate?: string | null;
    location?: string | null;
    chainId?: string | null;
    chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
    directConsequences?: Array<{
      kind: string;
      label: string;
      entityId: string | null;
      quantified: boolean;
      entityName?: string;
      changeKind?: string;
      fields?: Array<{ field: string; from: unknown; to: unknown }>;
    }>;
    sourceDirector?: string;
    openPressure?: boolean;
    title?: string;
    knowledgeStatus?: "confirmed" | "report" | "rumour" | "suspicion";
    participants?: readonly { name: string; role?: string }[];
    places?: readonly { name: string }[];
    institutions?: readonly { name: string }[];
    playerRelevance?: "high" | "medium" | "low" | "none";
    politicalOutcome?: ChronicleView["entries"][number]["politicalOutcome"];
    lifeEvent?: ChronicleView["entries"][number]["lifeEvent"];
    commandChange?: ChronicleView["entries"][number]["commandChange"];
    familyEvent?: ChronicleView["entries"][number]["familyEvent"];
    initiatedDialogue?: ChronicleView["entries"][number]["initiatedDialogue"];
    dispatch?: { items?: readonly string[]; uncertaintyNote?: string | null };
  };

  let dispatch: ChronicleView["dispatch"];
  const projected: ChronicleView["entries"][number][] = [];

  for (const row of rows) {
    const factsData = row.facts;
    const isNewFormat =
      factsData !== null &&
      typeof factsData === "object" &&
      !Array.isArray(factsData) &&
      "ids" in factsData;
    const atStep = chronicleAtStep(factsData, turn.elapsedStepEnd ?? 0);
    const f = isNewFormat ? (factsData as FactsBlob) : null;

    if (row.scope === "dispatch") {
      dispatch = { headline: row.body, items: f?.dispatch?.items ?? [], uncertaintyNote: f?.dispatch?.uncertaintyNote ?? null };
      continue;
    }
    // Older turns can contain capability-gap rows created before those
    // internal audit records were excluded at Chronicle construction time.
    // Keep them available to the developer inspector, but never show them to
    // a player or let them block reading the current turn.
    if (row.scope === "unsupported_action") continue;

    const view = projectChronicleEntry(
      {
        id: row.id,
        sequence: row.sequence,
        audience: row.audience as "all_players" | "knowledge_scoped",
        body: row.body,
        ...(row.scopeRef != null ? { scopeRef: row.scopeRef } : {}),
        atStep,
        ...(f?.title !== undefined ? { title: f.title } : {}),
        ...(f?.knowledgeStatus !== undefined ? { knowledgeStatus: f.knowledgeStatus } : {}),
        ...(f !== null ? { materialConsequence: Boolean(f.materialConsequence) } : {}),
        ...(f?.displayPatch !== undefined ? { displayPatch: f.displayPatch } : {}),
        ...(f?.eventDate != null ? { eventDate: f.eventDate } : {}),
        ...(f?.location != null ? { location: f.location } : {}),
        ...(f?.chainId != null ? { chainId: f.chainId } : {}),
        ...(f?.chainPosition != null ? { chainPosition: f.chainPosition } : {}),
        ...(f?.directConsequences !== undefined ? { directConsequences: f.directConsequences } : {}),
        ...(f?.sourceDirector !== undefined ? { sourceDirector: f.sourceDirector } : {}),
        ...(f?.openPressure !== undefined ? { openPressure: f.openPressure } : {}),
        ...(f?.participants !== undefined ? { participants: f.participants } : {}),
        ...(f?.places !== undefined ? { places: f.places } : {}),
        ...(f?.institutions !== undefined ? { institutions: f.institutions } : {}),
        ...(f?.playerRelevance !== undefined ? { playerRelevance: f.playerRelevance } : {}),
        ...(f?.politicalOutcome !== undefined ? { politicalOutcome: f.politicalOutcome } : {}),
        ...(f?.lifeEvent !== undefined ? { lifeEvent: f.lifeEvent } : {}),
        ...(f?.commandChange !== undefined ? { commandChange: f.commandChange } : {}),
        ...(f?.familyEvent !== undefined ? { familyEvent: f.familyEvent } : {}),
        ...(f?.initiatedDialogue !== undefined ? { initiatedDialogue: f.initiatedDialogue } : {}),
      },
      viewerCharacterId ?? null,
      characterBeliefs,
    );
    if (view === null) continue;
    projected.push({ ...view, playerInvolvement: row.playerInvolvement });
  }

  return {
    turnId: turn.id,
    turnIndex: turn.index,
    gameStatus: game.status,
    entries: projected,
    ...(dispatch === undefined ? {} : { dispatch }),
    ...(scenarioClock === undefined ? {} : { scenarioClock }),
  };
}

/**
 * The "Initiated Chat" affordance's authoritative source, scoped to the
 * requesting game: reads the flag straight out of the committed Chronicle
 * entry rather than trusting anything a client claims about who said what.
 * `gameId` is enforced via the join to `turns`, so an entry id from a
 * different game never resolves here.
 */
export async function getInitiatedDialogueFromChronicleEntry(
  db: ChronicaDatabase,
  gameId: string,
  entryId: string,
): Promise<{ characterId: string; characterName: string; topic: string; openingLine: string } | undefined> {
  const [row] = await db
    .select({ facts: chronicleEntries.facts })
    .from(chronicleEntries)
    .innerJoin(turns, eq(chronicleEntries.turnId, turns.id))
    .where(and(eq(chronicleEntries.id, entryId), eq(turns.gameId, gameId)))
    .limit(1);
  if (row === undefined) return undefined;
  const facts = row.facts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)) return undefined;
  const initiatedDialogue = (facts as { initiatedDialogue?: unknown }).initiatedDialogue;
  if (initiatedDialogue === null || typeof initiatedDialogue !== "object") return undefined;
  const { characterId, characterName, topic, openingLine } = initiatedDialogue as Record<string, unknown>;
  if (typeof characterId !== "string" || typeof characterName !== "string" || typeof topic !== "string" || typeof openingLine !== "string") return undefined;
  return { characterId, characterName, topic, openingLine };
}

export interface ChronicleInspectorEntry {
  readonly id: string;
  readonly sequence: number;
  readonly scope: string;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly rawBody: string;
  readonly rawFacts: unknown;
  readonly visible: boolean;
  readonly reason: string;
  readonly projected: ChronicleEntryProjection | null;
}

/**
 * Developer/admin-only diagnostics (character-sim phase 6): the latest news
 * turn's raw, pre-redaction Chronicle rows alongside the projection decision
 * and output a given `viewerCharacterId` would actually receive. Never used
 * by any ordinary player-facing route.
 */
export async function getChronicleInspectorView(
  db: ChronicaDatabase,
  gameId: string,
  viewerCharacterId: string | null,
): Promise<{ turnId: string; entries: readonly ChronicleInspectorEntry[] } | undefined> {
  const [turnRows] = await Promise.all([
    db
      .select({ id: turns.id, elapsedStepEnd: turns.elapsedStepEnd })
      .from(turns)
      .where(and(eq(turns.gameId, gameId), eq(turns.status, "news")))
      .orderBy(desc(turns.index))
      .limit(1),
  ]);
  const [turn] = turnRows;
  if (turn === undefined) return undefined;

  const [rows, snapshotRows] = await Promise.all([
    db
      .select({
        id: chronicleEntries.id,
        sequence: chronicleEntries.sequence,
        scope: chronicleEntries.scope,
        scopeRef: chronicleEntries.scopeRef,
        body: chronicleEntries.body,
        audience: chronicleEntries.audience,
        facts: chronicleEntries.facts,
      })
      .from(chronicleEntries)
      .where(eq(chronicleEntries.turnId, turn.id))
      .orderBy(chronicleEntries.sequence),
    db.select({ state: worldSnapshots.state }).from(worldSnapshots).where(eq(worldSnapshots.turnId, turn.id)).limit(1),
  ]);
  const [snapshot] = snapshotRows;
  const parsedWorld = snapshot === undefined ? null : WorldStateSchema.safeParse(snapshot.state);
  const characterBeliefs = parsedWorld?.success ? parsedWorld.data.characterBeliefs : [];

  const entries: ChronicleInspectorEntry[] = rows.map((row) => {
    const atStep = chronicleAtStep(row.facts, turn.elapsedStepEnd ?? 0);
    const record = {
      id: row.id,
      sequence: row.sequence,
      audience: row.audience as "all_players" | "knowledge_scoped",
      body: row.body,
      ...(row.scopeRef != null ? { scopeRef: row.scopeRef } : {}),
      atStep,
    };
    const visible = resolveChronicleVisibility(record, viewerCharacterId, characterBeliefs);
    const projected = projectChronicleEntry(record, viewerCharacterId, characterBeliefs);
    return {
      id: row.id,
      sequence: row.sequence,
      scope: row.scope,
      audience: row.audience as "all_players" | "knowledge_scoped",
      rawBody: row.body,
      rawFacts: row.facts,
      visible,
      reason: visible
        ? "Visible: public entry, or viewer holds a matching belief."
        : "Hidden: knowledge-scoped entry and the viewer holds no matching belief.",
      projected,
    };
  });

  return { turnId: turn.id, entries };
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
 * Used by the SSE stream to detect any state change â€” turn advances, phase
 * transitions, submission count changes, *and* completed dialogue replies â€”
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

  return maxTurnIndex * 1_000_000 + latestPhase * 100_000;
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
