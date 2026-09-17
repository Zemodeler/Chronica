import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { InsufficientCoinsError, callWithCoinGate, createAiAdapter } from "@chronica/ai";
import {
  WorldRevisionConflictError,
  commitBurst,
  createDatabase,
  failBurst,
  getOpenDecision,
  getWorldView,
  listChronicle,
  listPendingEvents,
  listRecentFacts,
  resolveDecision,
  schema,
  startBurst,
  type BurstFactRow,
  type ChronicaDatabase,
} from "@chronica/db";
import { FactSchema, PlayerDecisionSchema, type Fact, type OrderPartyRef } from "@chronica/shared";
import { composeChronicle, runSimulationBurst, whoSeeksThePlayer, type AnsweredDecision, type SimModelPort } from "@chronica/sim";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { requiredDatabaseUrl } from "./database-url";
import { openInitiatedDialogue } from "./dialogue-service";

/**
 * Where the pure simulation meets the application.
 *
 * `@chronica/sim` deliberately knows nothing about databases, sessions or
 * billing -- that is what makes it testable. This module supplies all three:
 * it loads the world, wraps the AI adapter in the coin gate to build the
 * `SimModelPort` the loop asks for, and commits the result in one transaction.
 */

export interface SimulationContext {
  readonly db: ChronicaDatabase;
  readonly close: () => Promise<void>;
  readonly userId: string;
  readonly playerId: string;
  readonly characterId: string;
}

async function resolveContext(gameId: string): Promise<SimulationContext | null> {
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

/** The loop's model port: every call metered and charged like any other. */
function createModelPort(db: ChronicaDatabase, userId: string, gameId: string): SimModelPort {
  const adapter = createAiAdapter();
  return {
    async complete(operation, systemPrompt, userMessage) {
      const result = await callWithCoinGate(db, userId, gameId, operation, adapter, { system: systemPrompt, user: userMessage });
      return result.content;
    },
  };
}

function parseFacts(rows: readonly { fact: unknown }[]): Fact[] {
  return rows.flatMap((row) => {
    const parsed = FactSchema.safeParse(row.fact);
    return parsed.success ? [parsed.data] : [];
  });
}

export type SimulationOutcome =
  | { readonly status: "ok"; readonly outcome: "continue" | "chronicle" | "player_decision"; readonly title: string; readonly body: string; readonly decision: { readonly prompt: string; readonly options: unknown } | null }
  | { readonly status: "error"; readonly message: string };

/** One fact as the row shape `commitBurst` stores, with its author's significance. */
function toFactRow(significanceByFactId: ReadonlyMap<string, number>) {
  return (fact: Fact): BurstFactRow => ({
    id: fact.id,
    instantSortKey: fact.time.day * 1440 + fact.time.minute,
    kind: fact.kind,
    summary: fact.summary,
    visibility: fact.visibility,
    discoveryState: fact.discovery.state,
    knowableAtSortKey:
      fact.discovery.knowableAtInstant === null ? null : fact.discovery.knowableAtInstant.day * 1440 + fact.discovery.knowableAtInstant.minute,
    significance: significanceByFactId.get(fact.id) ?? 0,
    causalDepth: fact.causalDepth,
    fact,
  });
}

export async function submitOrder(
  gameId: string,
  orderText: string,
  answeredDecision?: AnsweredDecision,
): Promise<SimulationOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return { status: "error", message: "You are not playing in this game." };
  const { db, close, userId, playerId, characterId } = context;

  try {
    const view = await getWorldView(db, gameId);
    if (view === undefined) return { status: "error", message: "This world has no state to act on yet." };
    if (view.scenarioClock === undefined) return { status: "error", message: "This scenario declares no clock." };
    if (view.scenarioWarfare === undefined) return { status: "error", message: "This scenario declares no rules of war." };

    // An answer carries its own decision, and is the one order allowed to run
    // while one is open -- it is what closes it.
    if (answeredDecision === undefined) {
      const open = await getOpenDecision(db, gameId);
      if (open !== undefined) return { status: "error", message: "A decision is waiting on you before the world can move on." };
    }

    // Offices are scenario data, not world state, and authority derivation needs them.
    const offices = view.scenarioGovernment?.offices ?? [];

    // The whole pending queue, not just what is due: the burst decides how far
    // to carry the world, and it needs to see what is waiting ahead to do it.
    const [factRows, queueRows] = await Promise.all([
      listRecentFacts(db, gameId),
      listPendingEvents(db, gameId),
    ]);

    const actorRef: OrderPartyRef = { kind: "character", id: characterId };
    const actorPolityId = view.world.characters.find((character) => character.id === characterId)?.polityId ?? null;
    const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText });
    const port = createModelPort(db, userId, gameId);
    const from = view.world.instant;

    let result;
    try {
      result = await runSimulationBurst({
        world: view.world,
        clock: view.scenarioClock,
        offices,
        warfare: view.scenarioWarfare,
        burstId,
        gameId,
        actorRef,
        actorPolityId,
        orderText,
        ...(answeredDecision === undefined ? {} : { answeredDecision }),
        knownFacts: parseFacts(factRows),
        queue: queueRows.map((row) => ({ id: row.id, dueInstantSortKey: row.dueInstantSortKey, kind: row.kind, summary: row.summary })),
        port,
      });
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error));
      if (error instanceof InsufficientCoinsError) return { status: "error", message: "You have run out of coins." };
      throw error;
    }

    const chronicle =
      result.outcome === "continue"
        ? null
        : await composeChronicle({
          port,
          clock: view.scenarioClock,
          observer: actorRef,
          observerPolityId: actorPolityId,
          facts: result.newFacts,
          from,
          to: result.world.instant,
          narrative: result.narrative,
          frictions: result.frictions,
        });

    try {
      await commitBurst(db, {
        gameId,
        expectedRevision: view.revision,
        world: result.world,
        burstId,
        facts: result.newFacts.map(toFactRow(result.significanceByFactId)),
        // Amendments to history already written, not additions to it: a secret
        // that somebody has now found out about.
        rediscoveredFacts: result.rediscoveredFacts.map(toFactRow(result.significanceByFactId)),
        scheduled: result.scheduled,
        firedEventIds: result.firedEventIds,
        burst: {
          iterations: result.iterations,
          modelCalls: result.modelCalls + (chronicle?.calls ?? 0),
          outcome: result.outcome,
          stopReason: result.stopReason,
          accumulatedSignificance: result.accumulatedSignificance,
        },
        ...(chronicle === null
          ? {}
          : { checkpoint: { title: chronicle.title, body: chronicle.body, factIds: chronicle.factIds, fromInstantSortKey: from.day * 1440 + from.minute } }),
        ...(result.playerDecision === null
          ? {}
          : { decision: { prompt: result.playerDecision.prompt, options: result.playerDecision.options } }),
      });
    } catch (error) {
      if (error instanceof WorldRevisionConflictError) {
        await failBurst(db, burstId, error.message);
        return { status: "error", message: "The world moved while your order was being carried out. Try again." };
      }
      throw error;
    }

    // Now that the world has settled, let anyone with real reason to seek the
    // ruler out open a conversation. Free, and outside the burst: this reports
    // on what already happened rather than causing anything.
    try {
      for (const initiation of whoSeeksThePlayer({ world: result.world, playerRef: actorRef })) {
        await openInitiatedDialogue(db, gameId, playerId, initiation.characterId, initiation.openingLine);
      }
    } catch (error) {
      console.warn("[simulation] failed to open an initiated conversation:", error);
    }

    return {
      status: "ok",
      outcome: result.outcome,
      title: chronicle?.title ?? "The world continues",
      body: chronicle?.body ?? result.narrative.join("\n\n"),
      decision: result.playerDecision === null ? null : { prompt: result.playerDecision.prompt, options: result.playerDecision.options },
    };
  } finally {
    await close();
  }
}

export async function getGameView(gameId: string) {
  const context = await resolveContext(gameId);
  if (context === null) return null;
  const { db, close } = context;
  try {
    const [view, chronicle, decision] = await Promise.all([
      getWorldView(db, gameId),
      listChronicle(db, gameId),
      getOpenDecision(db, gameId),
    ]);
    if (view === undefined) return null;
    return {
      gameTitle: view.gameTitle,
      instant: view.world.instant,
      chronicle: chronicle.map((entry) => ({ id: entry.id, title: entry.title, body: entry.body })),
      decision: decision === undefined ? null : { id: decision.id, prompt: decision.prompt, options: decision.options },
    };
  } finally {
    await close();
  }
}

export async function answerDecision(gameId: string, decisionId: string, optionId: string): Promise<SimulationOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return { status: "error", message: "You are not playing in this game." };
  const { db, close } = context;
  let answered: AnsweredDecision;
  try {
    const open = await getOpenDecision(db, gameId);
    if (open === undefined || open.id !== decisionId) return { status: "error", message: "That decision is no longer open." };

    const options = PlayerDecisionSchema.shape.options.safeParse(open.options);
    const chosen = options.success ? options.data.find((option) => option.id === optionId) : undefined;
    if (chosen === undefined) return { status: "error", message: "That is not one of the options." };

    await resolveDecision(db, decisionId, optionId);
    // Hand the world the question and the answer, not a sentence about them.
    // Round-tripping through prose lost the prompt entirely, so the world
    // resumed a decision without quite knowing what had been asked.
    answered = { prompt: open.prompt, label: chosen.label, summary: chosen.summary };
  } finally {
    await close();
  }

  return submitOrder(gameId, `The ruler has answered: ${answered.label}.`, answered);
}
