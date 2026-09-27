import { promisesOf } from "@chronica/shared";
import { withPlayerWorld } from "../../../../../lib/player-world";

/** What the player has promised, and what has been promised to them, still open. */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const promises = await withPlayerWorld(gameId, ({ world, characterId, view }) => promisesOf(world, characterId, view.scenarioClock));
  return Response.json({ promises: promises ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
