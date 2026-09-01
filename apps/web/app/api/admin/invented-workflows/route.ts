import { headers } from "next/headers";
import { createDatabase, listInventedWorkflows } from "@chronica/db";
import { resolveAccount } from "../../../../lib/account-service";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

/** Usage-ranked, game-local runtime workflow catalog for developers. */
export async function GET(request: Request) {
  const account = await resolveAccount(await headers());
  if (!account) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (account.role !== "developer" && account.role !== "admin") return Response.json({ error: "Forbidden." }, { status: 403 });
  const limit = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    return Response.json({ workflows: await listInventedWorkflows(db, limit) }, { headers: { "Cache-Control": "private, no-store" } });
  } finally { await close(); }
}
