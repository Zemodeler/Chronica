import { getTheState } from "../../../../../lib/state-service";

/**
 * The state the player serves: legitimacy, offices, the business before its
 * councils, factions, treaties. Gated as the world slice gates it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const reading = await getTheState(gameId);
  if (reading === null) return Response.json({ error: "There is no state to read yet." }, { status: 404 });
  return Response.json(reading, { headers: { "Cache-Control": "private, no-store" } });
}
