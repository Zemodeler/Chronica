import { getLettersDirectory } from "../../../../../lib/directory-service";

/**
 * The letter tray's people -- everyone the player knows of, and the sitting
 * officeholders anyone would -- grouped, with whether each can be reached;
 * and the letters from other powers waiting on the player's answer.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const directory = await getLettersDirectory(gameId);
  return Response.json(directory ?? { groups: [], letters: [] }, { headers: { "Cache-Control": "private, no-store" } });
}
