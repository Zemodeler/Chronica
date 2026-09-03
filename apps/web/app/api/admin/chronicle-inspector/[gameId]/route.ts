import { headers } from "next/headers";
import { createDatabase, getChronicleInspectorView, getWorldView } from "@chronica/db";
import { deriveAuthoritySummary } from "@chronica/shared";
import { resolveAccount } from "../../../../../lib/account-service";

// Developer/admin-only diagnostics (character-sim phase 6): raw pre-redaction
// Chronicle rows for the latest news turn, the projection decision and
// output a given `viewerCharacterId` would actually receive, and canonical
// Authority projection provenance. Never linked from ordinary player UI.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { gameId } = await params;
  const viewerCharacterId = new URL(request.url).searchParams.get("viewerCharacterId");

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [chronicleInspector, worldView] = await Promise.all([
      getChronicleInspectorView(db, gameId, viewerCharacterId),
      getWorldView(db, gameId),
    ]);
    if (chronicleInspector === undefined) return Response.json({ error: "No news turn found for this game." }, { status: 404 });

    const authorityProjection = viewerCharacterId !== null && worldView !== undefined
      ? deriveAuthoritySummary(worldView.world, viewerCharacterId, worldView.scenarioGovernment)
      : null;

    return Response.json(
      { ...chronicleInspector, viewerCharacterId, authorityProjection },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    await close();
  }
}
