import { reviseForce } from "../../../../../../lib/force-revision-service";

/** Rename an army, change its standard, or set it to drill: only for the man who commands or controls it. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string; forceId: string }> }) {
  const { gameId, forceId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const field = (key: string): string | undefined => {
    if (typeof body !== "object" || body === null || !(key in body)) return undefined;
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  };
  const name = field("name");
  const standardId = field("standardId");
  const drilling = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).drilling === "boolean" ? (body as { drilling: boolean }).drilling : undefined;
  if (name === undefined && standardId === undefined && drilling === undefined) return Response.json({ error: "Give a new name, a standard, or an order to drill." }, { status: 400 });

  const outcome = await reviseForce(gameId, forceId, { name, standardId, drilling });
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: outcome.code });
  return Response.json({ name: outcome.name, standardId: outcome.standardId }, { headers: { "Cache-Control": "private, no-store" } });
}
