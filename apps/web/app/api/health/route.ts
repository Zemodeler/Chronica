import { sql } from "drizzle-orm";
import { createDatabase } from "@chronica/db";

// Azure Container Apps' liveness/readiness probe target (docs/02-architecture.md,
// ADR-0038). A trivial round trip to Postgres: if the database is unreachable the
// app cannot serve anything real, so there is no value in reporting healthy.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return Response.json({ status: "unhealthy", reason: "DATABASE_URL is not set." }, { status: 503 });

  const { db, close } = createDatabase(databaseUrl);
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "healthy" }, { status: 200 });
  } catch (error) {
    return Response.json({ status: "unhealthy", reason: String(error) }, { status: 503 });
  } finally {
    await close();
  }
}
