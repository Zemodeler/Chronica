import { writeLetter } from "../../../../../lib/letter-service";

/**
 * A letter to somebody out of the player's region. It goes out now, and is
 * answered when the world next moves.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null) as { toCharacterId?: unknown; subject?: unknown; body?: unknown } | null;
  if (typeof body?.toCharacterId !== "string" || typeof body.body !== "string" || (body.subject !== undefined && typeof body.subject !== "string")) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const outcome = await writeLetter(gameId, { toCharacterId: body.toCharacterId, body: body.body, subject: body.subject });
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: outcome.code });
  return Response.json({ status: "sent" });
}
