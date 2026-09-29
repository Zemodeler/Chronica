import { resolveAccount } from "../../../../lib/account-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await resolveAccount(request.headers);
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("chronica_created_gift="))?.slice("chronica_created_gift=".length);
  if ((account?.role !== "developer" && account?.role !== "admin") || !raw) return Response.redirect(new URL("/account?developer=invalid#developer-status", request.url));
  const code = decodeURIComponent(raw).replace(/[^A-Z0-9_-]/g, "");
  // A bare page on purpose -- the code is shown once, outside the app -- but in
  // the room's colours rather than a browser's white.
  const style = "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15110D;color:#E6D9BE;font:17px/1.6 Palatino,Georgia,serif}main{max-width:32rem;padding:2rem}h1{font-weight:500}strong{display:block;margin:1rem 0;padding:.8rem 1rem;border:1px solid #B98B4A;font:600 1.3rem ui-sans-serif,system-ui;letter-spacing:.08em;user-select:all}a{color:#E6D9BE;text-decoration-color:#B98B4A}";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gift created — Chronica</title><style>${style}</style></head><body><main><h1>Gift created</h1><p>Copy this code now. It will not be shown again.</p><p><strong>${code}</strong></p><p><a href="/account#developer">Return to account</a></p></main></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `chronica_created_gift=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/account${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    },
  });
}
