import { getYourStanding } from "../../../../../lib/standing-service";

/**
 * What a person holds: their seats, what those seats permit, and their land.
 *
 * Derived from the same authority index the simulation checks orders against,
 * and rendered without the entity ids the prompt needs and the player has no
 * use for.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const standing = await getYourStanding(gameId);
  if (standing === null) return Response.json({ error: "There is no standing to read yet." }, { status: 404 });
  return Response.json(standing, { headers: { "Cache-Control": "private, no-store" } });
}
