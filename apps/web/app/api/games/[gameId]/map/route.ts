import { NextResponse } from "next/server";
import { gameRepository } from "../../../../../lib/game-repository";

export async function GET(_: Request, { params }: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId);
  if (world?.mapGeoJson === undefined) return NextResponse.json({ error: "Map not found" }, { status: 404 });
  return NextResponse.json(world.mapGeoJson, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
