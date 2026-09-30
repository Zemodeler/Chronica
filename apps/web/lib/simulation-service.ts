import { headers } from "next/headers";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  createDatabase,
  findRunningBurst,
  getBurst,
  getOpenDecision,
  getWorldView,
  listBurstProgress,
  listChronicle,
  markChronicleRead,
  setThreadFollowed,
  reapStaleBursts,
  schema,
  type ChronicaDatabase,
} from "@chronica/db";
import { formatCoins } from "@chronica/billing";
import { buildStation, formatWorldDate, PlayerDecisionSchema, seesAccount, type OrderPartyRef, type WorldState } from "@chronica/shared";
import { nameOfSubject, whoSeeksThePlayer, type AnsweredDecision } from "@chronica/sim";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { dateLabel, prepareBurst, runBurstToCommit, type BurstJob } from "./burst-runner";
import { ABANDONED_ERROR, livenessAt, toBurstStatus, type BurstStatusView } from "./burst-status";
import { requiredDatabaseUrl } from "./database-url";
import { openInitiatedDialogue } from "./dialogue-service";

/**
 * Where the pure simulation meets the application.
 *
 * `@chronica/sim` deliberately knows nothing about databases, sessions or
 * billing -- that is what makes it testable. This module supplies the session:
 * it says who is asking, prepares the burst, and hands it to `burst-runner.ts`
 * to finish on its own. The request returns as soon as the burst has a row;
 * the page follows it through `getBurstStatus`.
 */


/** How long before its telling a matter must have happened to be dated twice: two days. */
const LATE_NEWS_MINUTES = 2 * 1440;

export interface SimulationContext {
  readonly db: ChronicaDatabase;
  readonly close: () => Promise<void>;
  readonly userId: string;
  readonly playerId: string;
  readonly characterId: string;
}

export async function resolveContext(gameId: string): Promise<SimulationContext | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (userId === undefined) return null;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  const [player] = await db
    .select({ id: schema.players.id, characterId: schema.players.characterId })
    .from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
    .limit(1);

  if (player === undefined || player.characterId === null) {
    await close();
    return null;
  }
  return { db, close, userId, playerId: player.id, characterId: player.characterId };
}

/** How far the player may ask the world to run at once, in days. */
export const TIME_SPANS = [7, 30, 90, 180, 365] as const;

export type StartOutcome =
  | { readonly status: "started"; readonly burstId: string }
  | { readonly status: "error"; readonly message: string };

/**
 * Gives an order, or lets time pass, and returns as soon as the burst exists.
 *
 * The burst itself runs after the response is sent (`after`), in this same
 * process, with its own database pool. It heartbeats while it runs and marks
 * its progress as it makes it; a process that dies mid-turn is found out by
 * its silence, one stuck by its lack of progress (`livenessAt`), and the next
 * order or look at the page reaps the row and the coins it held.
 *
 * There is no durable queue behind this: a burst whose process dies is not
 * resumed, it is failed and the world stays at its last commit. The order is
 * the player's to give again, and with the same `idempotencyKey` a resend
 * that raced the first finds its burst rather than paying twice.
 */
export async function startDetachedBurst(
  gameId: string,
  /** Null to let time pass without giving an order. */
  orderText: string | null,
  options: { readonly spanDays?: number | undefined; readonly idempotencyKey?: string | undefined } = {},
): Promise<StartOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return { status: "error", message: "You are not playing in this game." };
  try {
    return await launch(context, { gameId, orderText, spanDays: options.spanDays, idempotencyKey: options.idempotencyKey });
  } finally {
    await context.close();
  }
}

async function launch(
  context: SimulationContext,
  input: {
    readonly gameId: string;
    readonly orderText: string | null;
    readonly spanDays?: number | undefined;
    readonly answeredDecision?: AnsweredDecision | undefined;
    readonly resolvesDecision?: { readonly id: string; readonly optionId: string } | undefined;
    readonly askedAs?: string | undefined;
    readonly idempotencyKey?: string | undefined;
  },
): Promise<StartOutcome> {
  const { db, userId, playerId, characterId } = context;
  const prepared = await prepareBurst(db, { ...input, userId, playerId, characterId });
  if (prepared.status === "error") return prepared;
  // Sent before, under the same id: follow that burst, pay for nothing new.
  if (prepared.status === "existing") return { status: "started", burstId: prepared.burstId };
  const job = prepared.job;

  after(async () => {
    const detached = createDatabase(requiredDatabaseUrl());
    try {
      await runBurstToCommit(detached.db, job, { afterCommit: openConversations });
    } finally {
      await detached.close();
    }
  });
  return { status: "started", burstId: job.burstId };
}

/** Now that the world has settled, let anyone with real reason to seek the ruler out open a conversation. */
async function openConversations(db: ChronicaDatabase, job: BurstJob, world: WorldState): Promise<void> {
  for (const initiation of whoSeeksThePlayer({ world, playerRef: job.actorRef })) {
    await openInitiatedDialogue(db, job.gameId, job.playerId, initiation.characterId, initiation.openingLine);
  }
}

/** Where a burst has got to, for the page polling it. Null when it is not this player's game. */
export async function getBurstStatus(gameId: string, burstId: string, afterId: number): Promise<BurstStatusView | null> {
  const context = await resolveContext(gameId);
  if (context === null) return null;
  const { db, close } = context;
  try {
    const now = new Date();
    await reapStaleBursts(db, gameId, livenessAt(now), ABANDONED_ERROR);
    const [row, rows] = await Promise.all([getBurst(db, gameId, burstId), listBurstProgress(db, burstId, afterId)]);
    if (row === undefined) return null;
    return toBurstStatus(row, rows, afterId, now);
  } finally {
    await close();
  }
}

export async function getGameView(gameId: string) {
  const context = await resolveContext(gameId);
  if (context === null) return null;
  const { db, close, userId, characterId } = context;
  try {
    const [view, chronicle, decision, running, purse] = await Promise.all([
      getWorldView(db, gameId),
      listChronicle(db, gameId),
      getOpenDecision(db, gameId),
      findRunningBurst(db, gameId, livenessAt(new Date())),
      readPurse(db, gameId, userId),
    ]);
    if (view === undefined) return null;
    // A purse's movements belong to whoever may open it. The historian's
    // entry claimed the change by its owner; this checks the reader too.
    const station = buildStation({ world: view.world, characterId, offices: view.scenarioGovernment?.offices ?? [] });
    const readable = (change: { readonly kind?: unknown; readonly id?: unknown }): boolean =>
      change.kind !== "account" || (typeof change.id === "string" && seesAccount(station, change.id));
    return {
      gameTitle: view.gameTitle,
      instant: view.world.instant,
      // The lintel's date. Read with the record, so the date moves in the same
      // breath as the Chronicle that says why.
      dateLabel: formatWorldDate(view.world.instant, view.scenarioClock),
      // What the player has to spend, and what this save has spent against
      // the cap it was given. Turns are billed by the model's tokens, so there
      // is no price to show in advance -- only what was actually spent.
      coins: purse,
      // The whole record, oldest first -- not the last report. A chronicle you
      // cannot turn back through is a notification.
      //
      // Entries still carry the burst that wrote them, because several threads
      // of one span are one report to read together.
      // The report the last committed order wrote: by when it was written, not
      // by where its passages sort in the calendar (R79).
      latestBurstId: [...chronicle].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.burstId ?? null,
      chronicle: chronicle.map((entry) => ({
        id: entry.id,
        burstId: entry.burstId,
        kind: entry.kind === "recorded" ? "recorded" : "narrated",
        // The day the matter entered the record, which is what a chronicle is
        // indexed by. Formatted here because the scenario's calendar lives with
        // the world and has no business being shipped to the browser.
        date: dateLabel(entry.toInstantSortKey, view.scenarioClock),
        // When what it tells happened, where that was days before the court
        // learned of it: a letter's arrival and the battle it reports are two
        // dates, and a late report read as the day of the event (C08).
        happened: entry.toInstantSortKey - entry.fromInstantSortKey > LATE_NEWS_MINUTES ? dateLabel(entry.fromInstantSortKey, view.scenarioClock) : null,
        title: entry.title,
        body: entry.body,
        subjects: entry.subjects,
        // Entries written before tags carried their own label still hold bare
        // refs. Naming them on the way out repairs the old record rather than
        // leaving two rows of engine handles in it forever.
        tags: namedTags(view.world, entry.tags),
        changes: (Array.isArray(entry.changes) ? entry.changes as { kind?: unknown; id?: unknown }[] : []).filter(readable),
        quote: entry.quote,
        storylineIds: Array.isArray(entry.storylineIds) ? (entry.storylineIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
        // read_at has been on the row since the table was written and nothing
        // ever set it, so the badge counted the length of the record and
        // called it unopened.
        unread: entry.readAt === null,
      })),
      decision: decision === undefined ? null : { id: decision.id, prompt: decision.prompt, options: decision.options },
      // A burst still moving the world, so a page opened mid-turn can follow
      // it rather than sit on a stale record.
      running: running === undefined ? null : { burstId: running.id },
    };
  } finally {
    await close();
  }
}

/** The wallet and this save's spending, as coin strings. */
async function readPurse(db: ChronicaDatabase, gameId: string, userId: string) {
  const [[wallet], [game]] = await Promise.all([
    db.select({ available: schema.creditWallets.availableMicrocredits }).from(schema.creditWallets).where(eq(schema.creditWallets.userId, userId)).limit(1),
    db.select({ budget: schema.games.creditBudgetMicrocredits, spent: schema.games.creditSpentMicrocredits }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1),
  ]);
  return {
    available: formatCoins(wallet?.available ?? 0n),
    spent: game === undefined ? null : formatCoins(game.spent),
    cap: game === undefined ? null : formatCoins(game.budget),
  };
}

/**
 * Mark entries of the record read.
 *
 * With ids, the entries the player has actually had in view: the Chronicle
 * marks an entry read once it has sat on the page long enough to be read,
 * so the player can see what is new and what they have already turned
 * through. Without, everything -- "Mark all as read".
 */
export async function markTheRecordRead(gameId: string, entryIds?: readonly string[]): Promise<boolean> {
  const context = await resolveContext(gameId);
  if (context === null) return false;
  const { db, close } = context;
  try {
    await markChronicleRead(db, gameId, new Date(), entryIds);
    return true;
  } finally {
    await close();
  }
}

/**
 * Follow a thread of history, or stop. A thread the player may not know of
 * can be followed by id and still shows nothing (`threadsYouSee`), so this
 * needs no check of its own.
 */
export async function followTheThread(gameId: string, storylineId: string, followed: boolean): Promise<boolean> {
  const context = await resolveContext(gameId);
  if (context === null) return false;
  const { db, close } = context;
  try {
    await setThreadFollowed(db, gameId, storylineId, followed);
    return true;
  } finally {
    await close();
  }
}

/** How `successionDecision` marks an option that names the player's next character. */
const SUCCESSION_OPTION_PREFIX = "succeed-";

/**
 * The ruler answers, and the world resumes (VISION §23 outcome C).
 *
 * The decision is closed only once the world has heard the answer -- in the
 * commit itself. It used to be closed first, so a turn that then failed spent
 * the answer on nothing: the question was gone, the world never learned what
 * was chosen, and nothing could ask it again.
 */
export async function answerDecision(gameId: string, decisionId: string, optionId: string): Promise<StartOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return { status: "error", message: "You are not playing in this game." };
  const { db, close, playerId, characterId: askedAs } = context;
  try {
    const open = await getOpenDecision(db, gameId);
    if (open === undefined || open.id !== decisionId) return { status: "error", message: "That decision is no longer open." };

    // Read one by one, not against the proposal's floor of two. A decision
    // already standing is the one on the player's screen, and a succession
    // with a single heir -- the house otherwise extinct -- was saved with one
    // option and then refused on every answer as "not one of the options",
    // which locked the game for good.
    const options = (Array.isArray(open.options) ? open.options : []).flatMap((raw: unknown) => {
      const option = PlayerDecisionSchema.shape.options.element.safeParse(raw);
      return option.success ? [option.data] : [];
    });
    const chosen = options.find((option) => option.id === optionId);
    if (chosen === undefined) return { status: "error", message: "That is not one of the options." };

    // The one decision that changes who is asking. `successionDecision` mints
    // its option ids as "succeed-<characterId>" precisely so this needs no
    // second table: the answer names the man, and the next order is his.
    let characterId = askedAs;
    if (optionId.startsWith(SUCCESSION_OPTION_PREFIX)) {
      characterId = optionId.slice(SUCCESSION_OPTION_PREFIX.length);
      await db.update(schema.players).set({ characterId }).where(eq(schema.players.id, playerId));
    }
    // Hand the world the question and the answer, not a sentence about them.
    // Round-tripping through prose lost the prompt entirely, so the world
    // resumed a decision without quite knowing what had been asked.
    // The option id, and who was asking, go with it: a succession changes who
    // the world follows, and a plight in the field is ended by the choice.
    const answered: AnsweredDecision = { prompt: open.prompt, label: chosen.label, summary: chosen.summary, optionId: chosen.id, predecessorId: askedAs };
    const outcome = await launch(
      { ...context, characterId },
      { gameId, orderText: `The ruler has answered: ${answered.label}.`, answeredDecision: answered, resolvesDecision: { id: decisionId, optionId }, askedAs: characterId === askedAs ? undefined : askedAs },
    );
    if (outcome.status === "error" && characterId !== askedAs) {
      await db.update(schema.players).set({ characterId: askedAs }).where(eq(schema.players.id, playerId));
    }
    return outcome;
  } finally {
    await close();
  }
}

/** Stored tags, with any missing label filled in from the world. */
function namedTags(world: WorldState, stored: unknown): { kind: string; id: string; label: string }[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((tag) => {
    if (typeof tag !== "object" || tag === null) return [];
    const { kind, id, label } = tag as { kind?: unknown; id?: unknown; label?: unknown };
    if (typeof kind !== "string" || typeof id !== "string") return [];
    if (typeof label === "string" && label.length > 0) return [{ kind, id, label }];
    return [{ kind, id, label: nameOfSubject(world, { kind, id } as OrderPartyRef) ?? id }];
  });
}

