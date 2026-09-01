import { headers } from "next/headers";
import { createDatabase, listInventedWorkflowUses, setInventedWorkflowStatus } from "@chronica/db";
import { resolveAccount } from "../../../../../lib/account-service";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { workflowId } = await params;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try { return Response.json({ uses: await listInventedWorkflowUses(db, workflowId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  finally { await close(); }
}

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  const account = await developer();
  if (!account) return Response.json({ error: "Forbidden." }, { status: 403 });
  const body = await request.json() as { status?: string; note?: string };
  if (body.status !== "active" && body.status !== "disabled") return Response.json({ error: "status must be active or disabled." }, { status: 400 });
  const { workflowId } = await params;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const changed = await setInventedWorkflowStatus(db, workflowId, body.status, account.id, body.note);
    return changed ? Response.json({ ok: true }) : Response.json({ error: "Not found." }, { status: 404 });
  } finally { await close(); }
}
