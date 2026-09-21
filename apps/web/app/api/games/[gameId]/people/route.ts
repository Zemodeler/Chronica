import { getPeopleYouKnow } from "../../../../../lib/people-service";

/**
 * Everyone the player knows, and what they know of them.
 *
 * Hearsay, not truth. Membership is `knowsAlready` -- a real dealing or a
 * family link -- plus who they have written to, plus anybody they hold a
 * belief about. Never `knowsPerson`, whose station hatch would hand a consul
 * the entire roster.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const people = await getPeopleYouKnow(gameId);
  if (people === null) return Response.json({ error: "There is nobody you may ask after." }, { status: 404 });
  return Response.json(people, { headers: { "Cache-Control": "private, no-store" } });
}
