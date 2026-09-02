import { NextResponse } from "next/server";
import { gameRepository } from "../../../../../lib/game-repository";

export async function GET(_: Request, { params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId);
  if (world?.mapGeoJson === undefined) return NextResponse.json({ error: "Map not found" }, { status: 404 });
  return NextResponse.json(world.mapGeoJson, {
    // The active scenario can revise its geometry without changing a game's
    // political data, so don't leave an open game viewing a stale map for
    // more than five minutes — but there's no need to force a full re-fetch
    // and re-clone of this multi-megabyte document on every request either.
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
