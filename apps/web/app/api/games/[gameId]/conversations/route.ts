import { getContactsView, resolveDialogueContext } from "../../../../../lib/dialogue-service";

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const ctx = await resolveDialogueContext(gameId);
  if (ctx === null) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { db, close, playerId, characterId } = ctx;
  try {
    const contacts = await getContactsView(db, gameId, playerId);
    return Response.json({
      gameId,
      playerCharacterId: characterId,
      contacts,
      activeThread: null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
