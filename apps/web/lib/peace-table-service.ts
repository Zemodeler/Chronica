import "server-only";

import { commitBurst, factRowOf, failBurst, findRunningBurst, getWorldView, instantSortKeyOf, startBurst } from "@chronica/db";
import { PeaceTermSchema, type FactProposalDraft, type PeaceTerm, type WorldDelta, type WorldState } from "@chronica/shared";
import { acceptDemands, applyDeltas, bribeAtTable, createIdFactory, diplomaticAnswererOf, materializeFacts, putTerms, speaksForAtTable } from "@chronica/sim";
import { livenessAt } from "./burst-status";
import { resolveContext } from "./simulation-service";

/**
 * The peace table's acts (docs/plans/a-living-world.md §8): proposing talks,
 * putting terms, taking what the other side would sign, accepting its
 * demands, buying a negotiator, and leaving. None needs a model -- the other
 * side answers by rule (`sim/src/peace-table.ts`) -- so each is applied by
 * the engine and committed as a burst of its own, the way an army is renamed
 * (`force-revision-service.ts`): the world keeps it, the Chronicle records
 * it, and it cannot land between another burst's read and its commit.
 */

export type PeaceTableAction =
  | { readonly action: "open"; readonly enemyId: string }
  | { readonly action: "put"; readonly tableId: string; readonly terms: readonly PeaceTerm[] }
  | { readonly action: "take_offer"; readonly tableId: string }
  | { readonly action: "accept"; readonly tableId: string }
  | { readonly action: "bribe"; readonly tableId: string; readonly targetId: string; readonly amount: number }
  | { readonly action: "leave"; readonly tableId: string };

export type PeaceTableOutcome =
  | { readonly status: "done"; readonly answer: string; readonly words: string }
  | { readonly status: "error"; readonly code: 400 | 401 | 403 | 404 | 409; readonly message: string };

const refuse = (code: 400 | 401 | 403 | 404 | 409, message: string): PeaceTableOutcome => ({ status: "error", code, message });

/** Reads the request body into an action, or says what is wrong with it. */
export function readPeaceTableAction(body: unknown): PeaceTableAction | string {
  if (typeof body !== "object" || body === null) return "Say what is to be done at the table.";
  const record = body as Record<string, unknown>;
  const text = (key: string): string | null => (typeof record[key] === "string" && (record[key] as string).length > 0 ? record[key] as string : null);
  switch (record.action) {
    case "open": return text("enemyId") === null ? "Name the power to talk with." : { action: "open", enemyId: text("enemyId")! };
    case "put": {
      const parsed = PeaceTermSchema.array().max(24).safeParse(record.terms);
      if (text("tableId") === null || !parsed.success) return "Name the table and the terms.";
      return { action: "put", tableId: text("tableId")!, terms: parsed.data };
    }
    case "take_offer": case "accept": case "leave":
      return text("tableId") === null ? "Name the table." : { action: record.action, tableId: text("tableId")! };
    case "bribe": {
      const amount = typeof record.amount === "number" ? Math.round(record.amount) : NaN;
      if (text("tableId") === null || text("targetId") === null || !Number.isFinite(amount) || amount <= 0) return "Name the man and the sum.";
      return { action: "bribe", tableId: text("tableId")!, targetId: text("targetId")!, amount };
    }
    default: return "That is not something done at a peace table.";
  }
}

export async function actAtPeaceTable(gameId: string, request: PeaceTableAction): Promise<PeaceTableOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return refuse(401, "Sign in to your game first.");
  const { db, close, userId, characterId } = context;
  try {
    const [view, running] = await Promise.all([getWorldView(db, gameId), findRunningBurst(db, gameId, livenessAt(new Date()))]);
    if (view === undefined) return refuse(404, "This world has no state yet.");
    if (running !== undefined) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");
    const world = view.world;
    const me = world.characters.find((character) => character.id === characterId);
    const ours = me?.polityId ?? null;
    if (me === undefined || ours === null) return refuse(403, "You speak for no power.");
    const offices = view.scenarioGovernment?.offices ?? [];
    const speaks = speaksForAtTable(world, characterId, offices);
    if (request.action !== "bribe" && !speaks) return refuse(403, "You do not speak for your power at the table. Your purse may still speak for you.");
    const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

    const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText: describe(request, nameOf) });
    if (burstId === null) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");
    const ids = createIdFactory(burstId);
    const applyContext = { now: world.instant, offices, warfare: view.scenarioWarfare, ids, gameId, playerCharacterId: characterId };
    try {
      let next: WorldState = world;
      let facts: FactProposalDraft[] = [];
      let answer = "done";
      let words = "";
      if (request.action === "open") {
        const reader = diplomaticAnswererOf(world, request.enemyId, offices);
        const send: WorldDelta = {
          op: "diplomatic_message_send", localId: "peace_talks", kind: "peace_talks", fromPolityId: ours, fromCharacterRef: characterId,
          toPolityId: request.enemyId, toCharacterRef: reader, subject: `${nameOf(ours)} proposes to discuss peace`,
          terms: `Let our envoys meet and talk of an end to the war between ${nameOf(ours)} and ${nameOf(request.enemyId)}.`,
          replyWithinDays: 45, visibility: "public", reason: "Talks proposed from the peace table.",
        } as WorldDelta;
        const result = applyDeltas(world, [send], { ...applyContext, actorRef: { kind: "character", id: characterId } });
        if (result.rejected[0] !== undefined) { await failBurst(db, burstId, result.rejected[0].reason); return refuse(400, result.rejected[0].reason); }
        next = result.world;
        facts = [...result.factProposals];
        answer = "sent";
        words = `The letter is on its way to ${nameOf(request.enemyId)}.`;
      } else if (request.action === "bribe") {
        const bribe = bribeAtTable(world, request.tableId, characterId, request.targetId, request.amount);
        if (bribe.refusal !== null) { await failBurst(db, burstId, bribe.refusal); return refuse(400, bribe.refusal); }
        next = bribe.world;
        facts = bribe.facts;
        answer = bribe.outcome;
        words = bribe.outcome === "taken" ? "The money was taken, quietly." : bribe.outcome === "found_out" ? "The money was taken, and it is known." : "He would not take it, and he has said so.";
      } else if (request.action === "leave") {
        next = { ...world, peaceTables: world.peaceTables.map((table) => (table.id === request.tableId && table.status === "open" ? { ...table, status: "walked_out" as const, closedAtStep: world.instant.day } : table)) };
        answer = "left";
        words = "Our envoys have come home.";
      } else {
        const table = world.peaceTables.find((candidate) => candidate.id === request.tableId);
        if (table === undefined || !table.sides.includes(ours)) { await failBurst(db, burstId, "No such table."); return refuse(404, "There is no such peace table."); }
        const turn = request.action === "accept"
          ? acceptDemands(world, request.tableId, ours, applyContext, offices, characterId)
          : putTerms(world, request.tableId, ours, request.action === "put" ? request.terms
            : [...table.sessions].reverse().find((session) => session.byPolityId === ours)?.counterTerms ?? [], applyContext, offices, characterId);
        if (turn.refusal !== null && turn.answer === "refused" && turn.world === world) { await failBurst(db, burstId, turn.refusal); return refuse(400, turn.refusal); }
        next = turn.world;
        facts = turn.facts;
        answer = turn.answer;
        words = turn.words;
      }

      const at = instantSortKeyOf(next);
      const materialized = materializeFacts({ proposals: facts, now: next.instant, atStep: next.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      await commitBurst(db, {
        gameId,
        expectedRevision: view.revision,
        world: next,
        burstId,
        facts: materialized.facts.map((fact) => factRowOf(fact, materialized.significanceByFactId.get(fact.id) ?? 0)),
        rediscoveredFacts: [],
        scheduled: [],
        firedEventIds: [],
        burst: { iterations: 0, modelCalls: 0, outcome: "applied", stopReason: "order_applied", accumulatedSignificance: 0 },
        checkpoints: [{
          kind: "recorded",
          title: describe(request, nameOf),
          body: words,
          factIds: materialized.facts.map((fact) => fact.id),
          subjects: [{ kind: "polity", id: ours }],
          tags: [],
          changes: [],
          quote: null,
          fromInstantSortKey: at,
          toInstantSortKey: at,
        }],
      });
      return { status: "done", answer, words };
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : "The table could not sit.");
      throw error;
    }
  } finally {
    await close();
  }
}

function describe(request: PeaceTableAction, nameOf: (id: string) => string): string {
  switch (request.action) {
    case "open": return `Peace talks proposed to ${nameOf(request.enemyId)}`;
    case "put": return "Terms put at the peace table";
    case "take_offer": return "Their offer taken at the peace table";
    case "accept": return "Their terms accepted at the peace table";
    case "bribe": return "Money passed at the peace table";
    case "leave": return "Our envoys leave the peace table";
  }
}
