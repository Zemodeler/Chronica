import "server-only";

import { WorldRevisionConflictError, commitBurst, failBurst, findRunningBurst, getWorldView, instantSortKeyOf, startBurst } from "@chronica/db";
import type { ServiceRecord, WorldDelta } from "@chronica/shared";
import { applyDeltas, createIdFactory } from "@chronica/sim";
import { livenessAt } from "./burst-status";
import { resolveContext } from "./simulation-service";

/**
 * How a man in the ranks means to bear himself in the next battle: in his
 * place, after glory, or keeping his head down (docs/plans/armies-in-detail.md).
 *
 * His own to say, and it needs no model: one `force_membership_set` with
 * `change: "conduct"`, applied by the engine and committed as a burst of its
 * own, exactly as renaming an army is (`force-revision-service.ts`). The
 * battle reads it (`memberRates`), and so does what the battle gives him after
 * (`recordTheFight`): the bold are decorated and die, the timid live and are
 * sometimes punished.
 */

export type Conduct = ServiceRecord["conduct"];

export type ConductOutcome =
  | { readonly status: "set"; readonly conduct: Conduct }
  | { readonly status: "error"; readonly code: 400 | 401 | 404 | 409; readonly message: string };

const refuse = (code: 400 | 401 | 404 | 409, message: string): ConductOutcome => ({ status: "error", code, message });

const WORDS: Readonly<Record<Conduct, { readonly order: string; readonly title: string; readonly body: string }>> = {
  steady: { order: "Keep my place in the line", title: "resolves to keep his place in the line", body: "He means to stand where he is put, and do what the men beside him do." },
  glory: { order: "Win glory in the next battle", title: "resolves to win glory in the next battle", body: "He means to be where the fighting is hardest, and to be seen there. Men who do are decorated, and men who do are killed." },
  cautious: { order: "Keep my head down in the next battle", title: "resolves to keep his head down in the next battle", body: "He means to come home. Men who hang back live longer, and are sometimes seen to hang back." },
};

export async function setConduct(gameId: string, conduct: Conduct): Promise<ConductOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return refuse(401, "Sign in to your game first.");
  const { db, close, userId, characterId } = context;
  try {
    const [view, running] = await Promise.all([getWorldView(db, gameId), findRunningBurst(db, gameId, livenessAt(new Date()))]);
    if (view === undefined) return refuse(404, "This world has no state yet.");
    const person = view.world.characters.find((character) => character.id === characterId);
    const service = person?.service;
    if (person === undefined || service === undefined || service.forceId === null) return refuse(400, "You are not serving in an army.");
    if (service.conduct === conduct) return { status: "set", conduct };
    if (running !== undefined) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");

    const delta: WorldDelta = {
      op: "force_membership_set",
      characterRef: characterId,
      forceRef: service.forceId,
      change: "conduct",
      conduct,
      reason: `${person.name} ${WORDS[conduct].title}.`,
    };
    const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText: WORDS[conduct].order });
    if (burstId === null) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");
    try {
      const result = applyDeltas(view.world, [delta], {
        now: view.world.instant,
        actorRef: { kind: "character", id: characterId },
        offices: view.scenarioGovernment?.offices ?? [],
        warfare: view.scenarioWarfare,
        ids: createIdFactory(burstId),
        gameId,
        playerCharacterId: characterId,
      });
      const [rejection] = result.rejected;
      if (rejection !== undefined) {
        await failBurst(db, burstId, rejection.reason);
        return refuse(400, rejection.reason);
      }
      const at = instantSortKeyOf(result.world);
      await commitBurst(db, {
        gameId,
        expectedRevision: view.revision,
        world: result.world,
        burstId,
        facts: [],
        rediscoveredFacts: [],
        scheduled: [],
        firedEventIds: [],
        burst: { iterations: 0, modelCalls: 0, outcome: "applied", stopReason: "order_applied", accumulatedSignificance: 0 },
        checkpoints: [{
          kind: "recorded",
          title: `${person.name} ${WORDS[conduct].title}`,
          body: WORDS[conduct].body,
          factIds: [],
          subjects: [{ kind: "character", id: characterId }],
          tags: [],
          changes: [],
          quote: null,
          fromInstantSortKey: at,
          toInstantSortKey: at,
        }],
      });
      return { status: "set", conduct };
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error)).catch(() => {});
      if (error instanceof WorldRevisionConflictError) return refuse(409, "The world moved while this was being written. Try again.");
      throw error;
    }
  } finally {
    await close();
  }
}
