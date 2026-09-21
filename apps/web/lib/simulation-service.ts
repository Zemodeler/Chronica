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
  subjectsOfRecentReports,
  titlesOfRecentReports,
  resolveDecision,
  schema,
  startBurst,
  type BurstFactRow,
  type ChronicaDatabase,
} from "@chronica/db";
import { FactSchema, PlayerDecisionSchema, buildStation, diffWorlds, formatWorldDate, holdsPolityStanding, type Fact, type Office, type OrderPartyRef, type ScenarioClock, type WorldState } from "@chronica/shared";
import { closeTheBooks, composeChronicle, runSimulationBurst, whoSeeksThePlayer, type AnsweredDecision, type ChronicleEntry, type SimModelPort } from "@chronica/sim";
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
  | {
    readonly status: "ok";
    readonly outcome: "continue" | "chronicle" | "player_decision";
    /** One per thread of events the burst recorded, in reading order. */
    readonly entries: readonly { readonly title: string; readonly body: string }[];
    readonly decision: { readonly prompt: string; readonly options: unknown } | null;
  }
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
        ...(view.scenarioMap === undefined ? {} : { terrains: view.scenarioMap.terrains }),
        // Loaded since the life system was written and read only by an admin
        // route, so nobody in any game has ever aged.
        ...(view.scenarioLife === undefined ? {} : { life: view.scenarioLife }),
        ...(view.scenarioWealth === undefined ? {} : { wealth: view.scenarioWealth }),
        ...(view.scenarioHistoricalPressures === undefined ? {} : { historicalPressures: view.scenarioHistoricalPressures }),
        burstId,
        gameId,
        actorRef,
        actorPolityId,
        orderText,
        ...(answeredDecision === undefined ? {} : { answeredDecision }),
        knownFacts: parseFacts(factRows),
        queue: queueRows.map((row) => ({ id: row.id, dueInstantSortKey: row.dueInstantSortKey, kind: row.kind, summary: row.summary, payload: row.payload })),
        port,
      });
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error));
      if (error instanceof InsufficientCoinsError) return { status: "error", message: "You have run out of coins." };
      throw error;
    }

    // The Chronicle is no longer conditional on the burst having ended in a
    // particular way. A record that exists because an order finished is a
    // receipt; this one is written whenever a matter reached a moment worth
    // recording, the player's own among them, and costs nothing when no matter
    // did. What still gates it is weight, inside `composeChronicle`.
    const chronicle = await composeChronicle({
      port,
      clock: view.scenarioClock,
      observer: actorRef,
      observerPolityId: actorPolityId,
      facts: result.newFacts,
      from,
      to: result.world.instant,
      narrative: result.narrative,
      frictions: result.frictions,
      utterances: result.utterances,
      battleAccounts: result.battleAccounts,
      significanceByFactId: result.significanceByFactId,
      storylines: result.world.storylines,
      polityOfCharacter: (id) => result.world.characters.find((character) => character.id === id)?.polityId ?? null,
      nameOf: (ref) => nameOfSubject(result.world, ref),
      ownEntityIds: ownSideOf(result.world, actorRef.id, actorPolityId),
      personalEntityIds: personallyTouchedBy(result.world, actorRef.id, actorPolityId, offices),
      orderFactIds: new Set(result.orderFactIds),
      changes: diffWorlds(view.world, result.world),
      // What the last reports were already about, so a matter that is merely
      // continuing is not given a fresh headline. Read before this one is
      // written.
      recentSubjects: await subjectsOfRecentReports(db, gameId),
      // And what it actually said, so the historian is not asked to remember.
      recentTitles: await titlesOfRecentReports(db, gameId),
    });

    // And the books close because the calendar turned, not because anybody
    // asked. No model call, no historian, no judgment -- arithmetic.
    const entries: ChronicleEntry[] = [
      ...chronicle.entries,
      ...closeTheBooks({ world: result.world, clock: view.scenarioClock, from, to: result.world.instant, polityId: actorPolityId }),
    ].sort((a, b) => a.toInstantSortKey - b.toInstantSortKey);

    // A model answer the engine could not read is the one failure that leaves
    // no trace anywhere: `orchestrate` retries once and then hands back an
    // inert answer, so the burst commits, the clock advances, and the world
    // simply does nothing. A live game lost a whole season that way and the
    // only sign of it was a silent Chronicle. It costs a line to say so.
    if (result.parseFailures.length > 0) {
      console.warn(`[burst ${burstId}] the model's answer could not be read (${result.parseFailures.length}): ${result.parseFailures.join(" | ")}`);
    }

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
          modelCalls: result.modelCalls + chronicle.calls,
          outcome: result.outcome,
          stopReason: result.stopReason,
          accumulatedSignificance: result.accumulatedSignificance,
        },
        ...(entries.length === 0
          ? {}
          : {
            checkpoints: entries.map((entry) => ({
              kind: entry.kind,
              title: entry.title,
              body: entry.body,
              factIds: entry.factIds,
              subjects: entry.subjects,
              tags: entry.tags,
              changes: entry.changes,
              quote: entry.quote,
              fromInstantSortKey: entry.fromInstantSortKey,
              toInstantSortKey: entry.toInstantSortKey,
            })),
          }),
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
      entries: entries.map((entry) => ({ title: entry.title, body: entry.body })),
      decision: result.playerDecision === null ? null : { prompt: result.playerDecision.prompt, options: result.playerDecision.options },
    };
  } finally {
    await close();
  }
}

/**
 * Everything the player's own side answers for.
 *
 * The Chronicle's middle tier turns on it: a secret touching any of this stays
 * dark, because a plot against the ruler is not colour, while a secret touching
 * none of it may reach them as distant news. Read from the world after the
 * burst, so a province taken this very span counts as theirs.
 */
/**
 * What a subject is called, so a tag reads "Roman Senate" rather than
 * "institution-62af32f4-4cf3-417e-9b0f-f67345bbce84".
 *
 * The Chronicle works in refs because refs are what facts carry and what the
 * record is searched by. Names live in the world, which the composer has no
 * business holding, so the lookup comes in from here.
 */
function nameOfSubject(world: WorldState, ref: OrderPartyRef): string | null {
  switch (ref.kind) {
    case "polity": return world.map.polities.find((polity) => polity.id === ref.id)?.name ?? null;
    case "province": return world.map.provinces.find((province) => province.id === ref.id)?.name ?? null;
    case "character": return world.characters.find((character) => character.id === ref.id)?.name ?? null;
    case "force": return world.material.forces.find((force) => force.id === ref.id)?.name ?? null;
    case "institution": return world.material.institutions.find((institution) => institution.id === ref.id)?.name ?? null;
    default: return null;
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

/**
 * What the reader personally touches, as against what their government does.
 *
 * A consul's realm and a consul's business are the same thing, so somebody with
 * standing over their whole power gets the polity-wide set unchanged and their
 * record reads exactly as it did. For everybody else it is their money, their
 * people, their ground and the matters they are party to -- their country's
 * doings still reach them, as news competing on weight like anything else.
 */
function personallyTouchedBy(world: WorldState, characterId: string, polityId: string | null, offices: readonly Office[]): Set<string> {
  const station = buildStation({ world, characterId, offices });
  if (holdsPolityStanding(station)) return ownSideOf(world, characterId, polityId);
  return new Set<string>([
    characterId,
    ...station.accountIds,
    ...station.forceIds,
    ...station.provinceIds,
    ...station.institutionIds,
    ...station.procedureIds,
    ...station.holdingIds,
    ...station.knownCharacterIds,
    ...station.storylineIds,
  ]);
}

function ownSideOf(world: WorldState, characterId: string, polityId: string | null): Set<string> {
  const own = new Set<string>([characterId]);
  if (polityId === null) return own;
  own.add(polityId);
  for (const character of world.characters) if (character.polityId === polityId) own.add(character.id);
  for (const province of world.map.provinces) if (province.controllerPolityId === polityId) own.add(province.id);
  for (const force of world.material.forces) if (force.polityId === polityId) own.add(force.id);
  return own;
}

/** A stored sort key, as the date a reader sees at the head of an entry. */
function dateLabel(sortKey: number, clock: ScenarioClock | undefined): string | null {
  if (clock === undefined) return null;
  return formatWorldDate({ day: Math.floor(sortKey / 1440), minute: sortKey % 1440 }, clock);
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
      // The whole record, oldest first -- not the last report. A chronicle you
      // cannot turn back through is a notification.
      //
      // Entries still carry the burst that wrote them, because several threads
      // of one span are one report to read together.
      chronicle: chronicle.map((entry) => ({
        id: entry.id,
        burstId: entry.burstId,
        kind: entry.kind === "recorded" ? "recorded" : "narrated",
        // The day the matter entered the record, which is what a chronicle is
        // indexed by. Formatted here because the scenario's calendar lives with
        // the world and has no business being shipped to the browser.
        date: dateLabel(entry.toInstantSortKey, view.scenarioClock),
        title: entry.title,
        body: entry.body,
        subjects: entry.subjects,
        // Entries written before tags carried their own label still hold bare
        // refs. Naming them on the way out repairs the old record rather than
        // leaving two rows of engine handles in it forever.
        tags: namedTags(view.world, entry.tags),
        changes: entry.changes,
        quote: entry.quote,
      })),
      decision: decision === undefined ? null : { id: decision.id, prompt: decision.prompt, options: decision.options },
    };
  } finally {
    await close();
  }
}

/** How `successionDecision` marks an option that names the player's next character. */
const SUCCESSION_OPTION_PREFIX = "succeed-";

export async function answerDecision(gameId: string, decisionId: string, optionId: string): Promise<SimulationOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return { status: "error", message: "You are not playing in this game." };
  const { db, close, playerId } = context;
  let answered: AnsweredDecision;
  try {
    const open = await getOpenDecision(db, gameId);
    if (open === undefined || open.id !== decisionId) return { status: "error", message: "That decision is no longer open." };

    const options = PlayerDecisionSchema.shape.options.safeParse(open.options);
    const chosen = options.success ? options.data.find((option) => option.id === optionId) : undefined;
    if (chosen === undefined) return { status: "error", message: "That is not one of the options." };

    await resolveDecision(db, decisionId, optionId);

    // The one decision that changes who is asking. `successionDecision` mints
    // its option ids as "succeed-<characterId>" precisely so this needs no
    // second table: the answer names the man, and the next order is his.
    if (optionId.startsWith(SUCCESSION_OPTION_PREFIX)) {
      const successorId = optionId.slice(SUCCESSION_OPTION_PREFIX.length);
      await db.update(schema.players).set({ characterId: successorId }).where(eq(schema.players.id, playerId));
    }
    // Hand the world the question and the answer, not a sentence about them.
    // Round-tripping through prose lost the prompt entirely, so the world
    // resumed a decision without quite knowing what had been asked.
    answered = { prompt: open.prompt, label: chosen.label, summary: chosen.summary };
  } finally {
    await close();
  }

  return submitOrder(gameId, `The ruler has answered: ${answered.label}.`, answered);
}
