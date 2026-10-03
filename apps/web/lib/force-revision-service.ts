import "server-only";

import { WorldRevisionConflictError, commitBurst, failBurst, findRunningBurst, getWorldView, instantSortKeyOf, startBurst } from "@chronica/db";
import { isNavalForce, type WorldDelta } from "@chronica/shared";
import { applyDeltas, createIdFactory } from "@chronica/sim";
import { standardsForPolity } from "./army-standards";
import { livenessAt } from "./burst-status";
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
  /** Set the men to drill, or stand them down from it (`ranks.ts`). */
  readonly drilling?: boolean | undefined;
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
      findRunningBurst(db, gameId, livenessAt(new Date())),
    ]);
    if (view === undefined) return refuse(404, "This world has no state yet.");
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
      : standardsForPolity(force.polityId, isNavalForce(force, view.scenarioWarfare) ? "navy" : "army").find((candidate) => candidate.id === revision.standardId);
    if (revision.standardId !== undefined && standard === undefined) return refuse(400, `That standard is not one ${force.name} may carry.`);

    const renamed = name !== undefined && name !== force.name;
    const reflagged = standard !== undefined && standard.id !== force.standardId;
    const drill = revision.drilling !== undefined && revision.drilling !== (force.drilling === true) ? revision.drilling : undefined;
    if (!renamed && !reflagged && drill === undefined) return { status: "revised", name: force.name, standardId: force.standardId ?? null };
    if (running !== undefined) return refuse(409, "The world is moving on an earlier order. Wait for it to settle.");

    // Drill said on its own: an order to the men that needs no model either.
    const drillWords = drill === undefined ? null : drill ? `${force.name} is set to drill in camp` : `${force.name} stands down from its drill`;
    const delta: WorldDelta = {
      op: "force_modify",
      forceRef: force.id,
      ...(renamed ? { name } : {}),
      ...(reflagged ? { standardId: standard.id } : {}),
      ...(drill === undefined ? {} : { drilling: drill }),
      reason: renamed && reflagged
        ? `Renamed ${name} and given the ${standard.name} by its commander.`
        : renamed ? `Renamed ${name} by its commander.` : reflagged ? `Given the ${standard!.name} by its commander.` : `${drillWords} by its commander's order.`,
    };
    const orderText = renamed && reflagged
      ? `Rename ${force.name} to ${name} and give it the ${standard.name}`
      : renamed ? `Rename ${force.name} to ${name}` : reflagged ? `Give ${force.name} the ${standard!.name}` : drill ? `Set ${force.name} to drill` : `Stand ${force.name} down from drill`;

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
        : renamed ? `${force.name} is renamed ${name}` : reflagged ? `${force.name} takes up the ${standard!.name}` : drillWords!;
      const body = renamed && reflagged
        ? `By its commander's order, ${force.name} is to be called ${name} from now on, and marches under the ${standard.name}.`
        : renamed
          ? `By its commander's order, ${force.name} is to be called ${name} from now on.`
          : reflagged
            ? `By its commander's order, ${force.name} marches from now on under the ${standard!.name}: ${standard!.description.charAt(0).toLowerCase()}${standard!.description.slice(1)}.`
            : drill
              ? `By its commander's order, ${force.name} drills in camp: while it is paid and fed and not on the march, the men grow better at their work each day.`
              : `By its commander's order, ${force.name} stands down from its drill.`;
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
