import { getSession, listSessionMessages } from "@chronica/db";
import { resolveDialogueContext } from "../../../../../../lib/dialogue-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string; sessionId: string }> },
) {
  const { gameId, sessionId } = await params;
  const ctx = await resolveDialogueContext(gameId);
  if (ctx === null) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { db, close, playerId } = ctx;
  try {
    const session = await getSession(db, sessionId, playerId);
    if (session === undefined) return Response.json({ error: "Session not found." }, { status: 404 });

    const messages = await listSessionMessages(db, sessionId);
    return Response.json({ session, messages }, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
