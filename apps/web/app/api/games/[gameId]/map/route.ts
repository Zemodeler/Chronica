import { NextResponse } from "next/server";
import { gameRepository } from "../../../../../lib/game-repository";

export async function GET(_: Request, { params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId);
  if (world?.mapGeoJson === undefined) return NextResponse.json({ error: "Map not found" }, { status: 404 });
  return NextResponse.json(world.mapGeoJson, {
    // The active scenario can revise its geometry without changing a game's
    // political data, so never leave an open game viewing a five-minute-old map.
    headers: { "Cache-Control": "no-store" },
  });
}
