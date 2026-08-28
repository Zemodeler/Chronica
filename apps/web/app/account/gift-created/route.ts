import { resolveAccount } from "../../../lib/account-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await resolveAccount(request.headers);
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("chronica_created_gift="))?.slice("chronica_created_gift=".length);
  if ((account?.role !== "developer" && account?.role !== "admin") || !raw) return Response.redirect(new URL("/account?developer=invalid#developer-status", request.url));
  const code = decodeURIComponent(raw).replace(/[^A-Z0-9_-]/g, "");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gift created — Chronica</title></head><body><main><h1>Gift created</h1><p>Copy this code now. It will not be shown again.</p><p><strong>${code}</strong></p><p><a href="/account#developer">Return to account</a></p></main></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `chronica_created_gift=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/account${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    },
  });
}
