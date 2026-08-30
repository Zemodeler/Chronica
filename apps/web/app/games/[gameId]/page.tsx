import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { gameRepository } from "../../../lib/game-repository";
import { getCharacterPanelData } from "../../../lib/character-service";
import { GameShell } from "./components/game-shell";
import type { CharacterPanelProps } from "./components/character-panel";

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

  // The demo game uses a fixture lobby with pre-defined characters, not AI.
  const isDemoGame = gameId === "demo-game";
  if (!isDemoGame && await gameRepository.needsCharacterDeclaration(gameId)) {
    redirect(`/games/${encodeURIComponent(gameId)}/declare`);
  }

  const [world, knowledgebase] = await Promise.all([
    gameRepository.getWorld(gameId),
    getCharacterPanelData(gameId),
  ]);

  if (world === null) notFound();

  let characterPanel: CharacterPanelProps | undefined;
  if (knowledgebase !== null && knowledgebase.confirmedByPlayer) {
    characterPanel = {
      characterName: knowledgebase.canonicalName,
      role: knowledgebase.role,
      locationLabel: knowledgebase.period,
      culture: knowledgebase.culture,
      relations: knowledgebase.relations.slice(0, 6),
      origin: knowledgebase.origin,
    };
  }

  return (
    <GameShell
      gameId={world.gameId}
      gameTitle={world.gameTitle}
      phase={world.phase}
      elapsedStepLabel={world.elapsedStepLabel}
      initialGeoJson={world.mapGeoJson}
      initialOverlay={world.mapOverlay}
      baseImageUrl="/maps/natural-earth-ii-blue-oceans.png"
      characterPanel={characterPanel}
    />
  );
}
