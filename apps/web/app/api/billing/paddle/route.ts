export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Purchasing is deliberately dormant; no event can grant coins in this release. */
export function POST(): Response {
  return Response.json({ error: "Coin purchasing is not available." }, { status: 410 });
}
