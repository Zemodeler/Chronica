import { toNextJsHandler } from "better-auth/next-js";
import { getAuthentication, isAuthenticationConfigured } from "../../../../lib/authentication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  if (!isAuthenticationConfigured()) {
    return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  }
  const handlers = toNextJsHandler(getAuthentication());
  return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
}

export const GET = handle;
export const POST = handle;
