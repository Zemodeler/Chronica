import { headers } from "next/headers";
import { createDatabase, getWorldView } from "@chronica/db";
import { buildLifeInspectorView } from "@chronica/shared";
import { resolveAccount } from "../../../../../../lib/account-service";

// Developer/admin-only diagnostics (character-sim phase 5): derived age/life
// stage/status, family/household graph, estate/inheritance trace, legacy-cause
// provenance, and canonical successor candidates for one character. Never
// linked from ordinary player UI -- the player-facing account of the same
// events is the Chronicle's public lifeEvent fact, which deliberately omits
// everything private this view exposes.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string; characterId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { gameId, characterId } = await params;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const worldView = await getWorldView(db, gameId);
    if (worldView === undefined) return Response.json({ error: "Game not found." }, { status: 404 });

    const scenario = worldView.scenarioLife ? { lifeStages: worldView.scenarioLife.lifeStages } : undefined;
    const view = buildLifeInspectorView(worldView.world, characterId, scenario);
    if (view === undefined) return Response.json({ error: "Character not found." }, { status: 404 });

    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
