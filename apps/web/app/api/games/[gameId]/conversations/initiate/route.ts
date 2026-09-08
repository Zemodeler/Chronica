import { getInitiatedDialogueFromChronicleEntry } from "@chronica/db";
import { openInitiatedDialogue, resolveDialogueContext } from "../../../../../../lib/dialogue-service";

// Opens the conversation a named character flagged, this turn, that they
// want to have with the player ("Initiated Chat" on a Chronicle entry).
//
// The client sends only the Chronicle entry id -- never the character id or
// opening line directly. Those are read back out of the committed entry
// itself (getInitiatedDialogueFromChronicleEntry, scoped to this game), so
// nothing a player could tamper with in the request body ever decides who
// "spoke" or what they said.

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const ctx = await resolveDialogueContext(gameId);
  if (ctx === null) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { db, close, playerId } = ctx;
  try {
    const body = (await request.json().catch(() => null)) as { entryId?: unknown } | null;
    const entryId = body?.entryId;
    if (typeof entryId !== "string" || entryId.trim().length === 0) {
      return Response.json({ error: "entryId is required." }, { status: 400 });
    }

    const flagged = await getInitiatedDialogueFromChronicleEntry(db, gameId, entryId);
    if (flagged === undefined) {
      return Response.json({ error: "No initiated conversation is recorded on that entry." }, { status: 404 });
    }

    const { sessionId } = await openInitiatedDialogue(db, gameId, playerId, flagged.characterId, flagged.openingLine);
    return Response.json({ sessionId, characterId: flagged.characterId, characterName: flagged.characterName });
  } finally {
    await close();
  }
}
