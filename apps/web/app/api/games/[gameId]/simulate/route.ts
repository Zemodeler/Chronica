import { getGameView, submitOrder, type SimulationProgress } from "../../../../../lib/simulation-service";

/**
 * The order box: one natural-language instruction, one simulation burst.
 *
 * The answer is streamed as newline-delimited JSON rather than sent in one
 * piece at the end. The burst is unchanged and still runs inside this request
 * -- what changes is that it stops being silent for the several minutes it
 * takes. Frames are `{kind: "progress"}` while the world moves, then exactly
 * one terminal `{kind: "done"}` or `{kind: "error"}`.
 *
 * The record is not streamed. It is written from the finished burst and
 * committed in one piece, because a report composed from half a burst would
 * split a matter in two and lose anything whose weight only adds up across the
 * whole of it.
 */
type Frame =
  | { readonly kind: "progress"; readonly progress: SimulationProgress }
  | { readonly kind: "done"; readonly result: Awaited<ReturnType<typeof submitOrder>> }
  | { readonly kind: "error"; readonly error: string };

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const orderText = typeof body === "object" && body !== null && "orderText" in body ? String(body.orderText) : "";
  if (orderText.trim().length === 0) return Response.json({ error: "An order is required." }, { status: 400 });
  if (orderText.length > 2_000) return Response.json({ error: "That order is too long." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: Frame): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        } catch {
          // The player closed the tab. The burst finishes and commits anyway:
          // their order was given, and it is not undone by their not watching.
        }
      };
      try {
        const result = await submitOrder(gameId, orderText.trim(), undefined, (progress) => send({ kind: "progress", progress }));
        send({ kind: "done", result });
      } catch (error) {
        send({ kind: "error", error: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      // Nothing between here and the browser may hold the frames back and
      // deliver them together at the end, which is the state this replaces.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const view = await getGameView(gameId);
  if (view === null) return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
