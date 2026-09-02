import { headers } from "next/headers";
import { createDatabase, getWorldView, listPendingNpcCommitments } from "@chronica/db";
import { buildCharacterInspectorView } from "@chronica/shared";
import { resolveAccount } from "../../../../../../lib/account-service";

// Developer/admin-only diagnostics (character-sim phase 2): canonical
// identity, mind, traits, active pressures, directed relationship
// dimensions with their strongest causes, beliefs, commitments, and
// continuity tier for one character. Never linked from ordinary player UI.

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
    const [worldView, pendingCommitments] = await Promise.all([
      getWorldView(db, gameId),
      listPendingNpcCommitments(db, gameId),
    ]);
    if (worldView === undefined) return Response.json({ error: "Game not found." }, { status: 404 });

    const view = buildCharacterInspectorView(worldView.world, characterId, pendingCommitments);
    if (view === undefined) return Response.json({ error: "Character not found." }, { status: 404 });

    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
