import { answerDecision } from "../../../../../../lib/simulation-service";

/** VISION §23 outcome C: the ruler answers, and the world resumes -- as a burst the page then follows. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string; decisionId: string }> }) {
  const { gameId, decisionId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const optionId = typeof body === "object" && body !== null && "optionId" in body ? String(body.optionId) : "";
  if (optionId.trim().length === 0) return Response.json({ error: "Choose one of the options." }, { status: 400 });

  const outcome = await answerDecision(gameId, decisionId, optionId.trim());
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: 400 });
  return Response.json({ burstId: outcome.burstId }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}
