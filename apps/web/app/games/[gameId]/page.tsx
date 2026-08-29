import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { gameRepository } from "../../../lib/game-repository";
import { GameShell } from "./components/game-shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId);
  return { title: world?.gameTitle ?? "Game" };
}

export default async function GamePage({
  params,
}: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId);
  if (world === null) notFound();

  return (
    <GameShell
      gameId={world.gameId}
      gameTitle={world.gameTitle}
      phase={world.phase}
      elapsedStepLabel={world.elapsedStepLabel}
      initialGeoJson={world.mapGeoJson}
      initialOverlay={world.mapOverlay}
      baseImageUrl="/maps/natural-earth-ii-blue-oceans.png"
    />
  );
}
