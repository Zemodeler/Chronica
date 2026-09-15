import { timingSafeEqual } from "node:crypto";
import { runWorkerTick } from "../../../../lib/resolution/dispatch";

// Machine-to-machine only (unified action runtime, durable dispatch): the
// standalone poll loop in scripts/turn-worker.mjs is the durable resolver
// runner that replaces relying on the order-submission request's `after()`
// callback surviving. No browser ever calls this, so it authenticates with a
// shared secret instead of a player/admin session.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CHRONICA_WORKER_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Forbidden." }, { status: 403 });
  const result = await runWorkerTick();
  return Response.json(result);
}
