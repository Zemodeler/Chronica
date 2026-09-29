import { NextResponse } from "next/server";
import { gameRepository } from "../../../../../lib/game-repository";

/**
 * The map document, downloaded once per version. The page names the version it
 * was made against (`?v=`); a document is immutable at its version, so the
 * browser is told to keep it for good and never asks again. A request for a
 * version the map has since moved past is sent on to the current one.
 */
export async function GET(request: Request, { params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const url = new URL(request.url);
  const wanted = url.searchParams.get("v");
  const document = await gameRepository.getMapDocument(gameId, wanted);
  if (document === undefined) return NextResponse.json({ error: "Map not found" }, { status: 404 });

  if (wanted !== null && wanted !== document.version) {
    url.searchParams.set("v", document.version);
    return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "no-store" } });
  }
  const etag = `"${document.version}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": wanted === null ? "private, no-cache" : "private, max-age=31536000, immutable",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(document.body, { headers: { ...headers, "Content-Type": "application/json" } });
}
