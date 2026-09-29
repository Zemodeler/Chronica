import { gameRepository } from "../../../../../lib/game-repository";

/**
 * The map overlay for the poll. With `?since=` (the stamp of the copy the client
 * holds) the answer is nothing when the world has not moved, else the rows that
 * changed; with none, the whole overlay as `mapOverlay`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const update = await gameRepository.getOverlayUpdate(gameId, new URL(request.url).searchParams.get("since"));
  if (update === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(update, { headers: { "Cache-Control": "no-store" } });
}
