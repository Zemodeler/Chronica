import { getTheMuster } from "../../../../../lib/forces-service";

/**
 * The muster, as the man responsible for it can read it.
 *
 * Station-filtered server side by the same `seesForce` the world slice uses:
 * a legate reads his legion, a consul reads the army, a private man reads
 * nothing, and what the player is shown can never drift from what the model
 * is told.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const muster = await getTheMuster(gameId);
  if (muster === null) return Response.json({ error: "There are no forces you may count." }, { status: 404 });
  return Response.json(muster, { headers: { "Cache-Control": "private, no-store" } });
}
