import { headers } from "next/headers";
import { createDatabase, getWorkflowProposalById, reviewWorkflowProposal } from "@chronica/db";
import { resolveAccount } from "../../../../../lib/account-service";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/admin/workflow-proposals/[proposalId]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const account = await resolveAccount(await headers());
  if (!account) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (account.role !== "developer" && account.role !== "admin") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const proposal = await getWorkflowProposalById(db, proposalId);
    if (!proposal) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ proposal });
  } finally {
    await close();
  }
}

// POST /api/admin/workflow-proposals/[proposalId]
// Body: { decision: "approved" | "rejected", note?: string }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  const account = await resolveAccount(await headers());
  if (!account) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (account.role !== "developer" && account.role !== "admin") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const body = (await request.json()) as { decision?: string; note?: string };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return Response.json({ error: "decision must be 'approved' or 'rejected'." }, { status: 400 });
    }

    const updated = await reviewWorkflowProposal(db, proposalId, account.id, body.decision, body.note);
    if (!updated) return Response.json({ error: "Proposal not found or already reviewed." }, { status: 404 });
    return Response.json({ ok: true });
  } finally {
    await close();
  }
}
