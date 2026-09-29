import { answerLetter } from "../../../../../../../lib/letter-service";

const REPLIES = new Set(["accepted", "refused", "countered"]);

/** Accepting, refusing or writing back to a letter waiting on the player's answer. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string; messageId: string }> }) {
  const { gameId, messageId } = await params;
  const body = await request.json().catch(() => null) as { reply?: unknown; words?: unknown; agreementKind?: unknown } | null;
  if (typeof body?.reply !== "string" || !REPLIES.has(body.reply) || typeof body.words !== "string" || (body.agreementKind !== undefined && typeof body.agreementKind !== "string")) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const outcome = await answerLetter(gameId, {
    messageId,
    reply: body.reply as "accepted" | "refused" | "countered",
    words: body.words,
    agreementKind: body.agreementKind,
  });
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: outcome.code });
  return Response.json({ status: "sent" });
}
