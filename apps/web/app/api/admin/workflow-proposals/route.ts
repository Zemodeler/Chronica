import { headers } from "next/headers";
import { createDatabase, listPendingWorkflowProposals } from "@chronica/db";
import { resolveAccount } from "../../../../lib/account-service";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/admin/workflow-proposals?status=pending&limit=20&offset=0
// Lists novel action proposals emitted by the Workflow Manager.
// Requires developer or admin role.
export async function GET(request: Request) {
  const account = await resolveAccount(await headers());
  if (!account) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (account.role !== "developer" && account.role !== "admin") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as "pending" | "approved" | "rejected" | undefined ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const proposals = await listPendingWorkflowProposals(db, { status, limit, offset });
    return Response.json({ proposals }, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
