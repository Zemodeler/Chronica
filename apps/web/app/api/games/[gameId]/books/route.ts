import { getTheBooks } from "../../../../../lib/books-service";

/**
 * The treasury, as the person holding it can read it (VISION §7).
 *
 * Station-filtered server side by the same `seesAccount` the world slice uses:
 * a consul reads the government's books, a merchant reads his own, and what
 * the player is shown can never drift from what the model is told.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const books = await getTheBooks(gameId);
  if (books === null) return Response.json({ error: "There are no books to read yet." }, { status: 404 });
  return Response.json(books, { headers: { "Cache-Control": "private, no-store" } });
}
