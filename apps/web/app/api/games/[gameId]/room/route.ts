import { getRoomContents } from "../../../../../lib/room-service";
import { orSaveNeedsRepair } from "../../../../../lib/save-errors";

/**
 * What is in the player's room.
 *
 * Which objects are drawn at all -- whether this person commands anyone,
 * holds anything, or has books. Only the server can say, and the alternative
 * was guessing from "holds a character", which is true of everybody.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return orSaveNeedsRepair(gameId, async () => {
    const contents = await getRoomContents(gameId);
    if (contents === null) return Response.json({ error: "There is no room you may enter." }, { status: 404 });
    return Response.json(contents, { headers: { "Cache-Control": "private, no-store" } });
  });
}
