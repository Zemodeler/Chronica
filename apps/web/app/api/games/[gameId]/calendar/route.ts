import { getWhatComesNext } from "../../../../../lib/calendar-service";

/**
 * The next few dated things this player could know of, soonest first. Built
 * from world state through the player's own station, never from the event
 * queue, which holds things they have no business knowing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const next = await getWhatComesNext(gameId);
  return Response.json({ next: next ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
