import "server-only";

import { WorldRevisionConflictError, commitBurst, failBurst, findRunningBurst, getWorldView, instantSortKeyOf, startBurst } from "@chronica/db";
import type { WorldDelta } from "@chronica/shared";
import { applyDeltas, createIdFactory } from "@chronica/sim";
import { standardsForPolity } from "./army-standards";
import { BURST_STALE_MS } from "./burst-status";
import { resolveContext } from "./simulation-service";

/**
 * Renaming an army, or changing the standard it carries, by the hand of the
 * man who commands it.
 *
 * Both used to be something else. A standard was a choice kept in one browser
 * tab: gone on reload, never seen by the world, and open to anybody for any
 * army on the map, an enemy's included. A name could only be changed by
 * giving an order and paying for a turn to carry it.
 *
 * Neither needs a model. It is one `force_modify`, applied by the engine that
 * applies every other one, and committed as a burst of its own so the world
 * keeps it, the Chronicle records it, and it cannot land between another
 * burst's read and its commit.
 */

export interface ForceRevision {
  readonly name?: string | undefined;
  readonly standardId?: string | undefined;
}

export type ForceRevisionOutcome =
  | { readonly status: "revised"; readonly name: string; readonly standardId: string | null }
  | { readonly status: "error"; readonly code: 400 | 401 | 403 | 404 | 409; readonly message: string };

const refuse = (code: 400 | 401 | 403 | 404 | 409, message: string): ForceRevisionOutcome => ({ status: "error", code, message });

export async function reviseForce(gameId: string, forceId: string, revision: ForceRevision): Promise<ForceRevisionOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return refuse(401, "Sign in to your game first.");
  const { db, close, userId, characterId } = context;
  try {
    const [view, running] = await Promise.all([
      getWorldView(db, gameId),
      findRunningBurst(db, gameId, new Date(Date.now() - BURST_STALE_MS)),
    ]);
    if (view === undefined) return refuse(404, "This world has no state yet.");
    if (view.scenarioWarfare === undefined) return refuse(409, "This scenario declares no rules of war.");
    const force = view.world.material.forces.find((candidate) => candidate.id === forceId);
    if (force === undefined) return refuse(404, "There is no such army.");
    // The same test the station uses for "his army": the man who leads it in
    // the field, or the one it answers to. Serving in its ranks is not enough.
    if (force.commanderCharacterId !== characterId && force.controllerCharacterId !== characterId) {
      return refuse(403, `${force.name} is not yours to command.`);
    }

    const name = revision.name?.trim();
    if (name !== undefined && (name.length === 0 || name.length > 120)) return refuse(400, "A name must be between 1 and 120 characters.");
    const standard = revision.standardId === undefined
      ? undefined
      : standardsForPolity(force.polityId).find((candidate) => candidate.id === revision.standardId);
    if (revision.standardId !== undefined && standard === undefined) return refuse(400, `That standard is not one ${force.name} may carry.`);

    const renamed = name !== undefined && name !== force.name;
    const reflagged = standard !== undefined && standard.id !== force.standardId;
    if (!renamed && !reflagged) return { status: "revised", name: force.name, standardId: force.standardId ?? null };
    if (running !== undefined) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");

    const delta: WorldDelta = {
      op: "force_modify",
      forceRef: force.id,
      ...(renamed ? { name } : {}),
      ...(reflagged ? { standardId: standard.id } : {}),
      reason: renamed && reflagged
        ? `Renamed ${name} and given the ${standard.name} by its commander.`
        : renamed ? `Renamed ${name} by its commander.` : `Given the ${standard!.name} by its commander.`,
    };
    const orderText = renamed && reflagged
      ? `Rename ${force.name} to ${name} and give it the ${standard.name}`
      : renamed ? `Rename ${force.name} to ${name}` : `Give ${force.name} the ${standard!.name}`;

    const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText });
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
      const title = renamed && reflagged
        ? `${force.name} becomes ${name}, under the ${standard.name}`
        : renamed ? `${force.name} is renamed ${name}` : `${force.name} takes up the ${standard!.name}`;
      const body = renamed && reflagged
        ? `By its commander's order, ${force.name} is to be called ${name} from now on, and marches under the ${standard.name}.`
        : renamed
          ? `By its commander's order, ${force.name} is to be called ${name} from now on.`
          : `By its commander's order, ${force.name} marches from now on under the ${standard!.name}: ${standard!.description.charAt(0).toLowerCase()}${standard!.description.slice(1)}.`;
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
          title,
          body,
          factIds: [],
          subjects: [{ kind: "force", id: force.id }],
          tags: [],
          changes: [],
          quote: null,
          fromInstantSortKey: at,
          toInstantSortKey: at,
        }],
      });
      const revised = result.world.material.forces.find((candidate) => candidate.id === force.id)!;
      return { status: "revised", name: revised.name, standardId: revised.standardId ?? null };
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error)).catch(() => {});
      if (error instanceof WorldRevisionConflictError) return refuse(409, "The world moved while this was being written. Try again.");
      throw error;
    }
  } finally {
    await close();
  }
}
