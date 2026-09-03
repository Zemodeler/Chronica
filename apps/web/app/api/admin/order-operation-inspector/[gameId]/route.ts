import { headers } from "next/headers";
import { createDatabase, getWorldView, getWorkflowAudit } from "@chronica/db";
import { resolveForcePosition } from "@chronica/shared";
import { resolveAccount } from "../../../../../lib/account-service";

// Developer/admin-only diagnostics (docs/23, Phase 6): the universal
// order/operation lifecycle (docs/14 Phase 1), background material state
// (docs/18 Phase 2), and every force's resolved intra-province position
// (docs/19 Phase 3), all read directly from the current world snapshot.
// Never linked from ordinary player UI -- this exposes internal state the
// player has not necessarily earned in-world knowledge of.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { gameId } = await params;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [worldView, workflowAudit] = await Promise.all([
      getWorldView(db, gameId),
      getWorkflowAudit(db, gameId),
    ]);
    if (worldView === undefined) return Response.json({ error: "Game not found." }, { status: 404 });
    const { world } = worldView;

    // Every resolve_battle candidate this turn's Workflow Manager considered
    // -- was it approved, repaired, or denied, and did it execute -- not
    // just the surviving Chronicle-facing summary (docs/19 Phase 3 follow-on:
    // this was persisted every turn already but unreachable from any query).
    const battleAudit = (workflowAudit?.candidates ?? []).filter(
      (candidate) => candidate.requestedInvocation.actionId === "resolve_battle",
    );

    const forcePositions = world.material.forces.map((force) => {
      const province = world.map.provinces.find((p) => p.id === force.locationId);
      const position = province ? resolveForcePosition(province, force.positionId) : null;
      return {
        forceId: force.id,
        forceName: force.name,
        provinceId: force.locationId,
        provinceName: province?.name ?? null,
        assignedPositionId: force.positionId,
        resolvedPosition: position ? { id: position.id, type: position.type, label: position.label, combatModifierBps: position.combatModifierBps } : null,
      };
    });

    return Response.json(
      {
        gameId,
        turnIndex: worldView.turnIndex,
        elapsedStep: world.elapsedStep,
        actions: world.actions,
        operations: world.operations,
        provinceMaterial: world.material.provinceMaterial,
        forcePositions,
        battleAudit,
        // A replay of this exact snapshot through the same audit-derived
        // projection functions is deterministic by construction (docs/14
        // Phase 1, docs/19 Phase 3's seeded battle resolver) -- there is no
        // additional state here that a second read of this endpoint could
        // disagree with.
        replayNote: "This snapshot is the committed result of the turn; every derived field above is a pure function of it.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    await close();
  }
}
