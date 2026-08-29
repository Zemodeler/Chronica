import { gameRepository } from "../../../../../lib/game-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId, false, true);
  if (world === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ mapOverlay: world.mapOverlay ?? null });
}
