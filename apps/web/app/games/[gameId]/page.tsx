import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { gameRepository } from "../../../lib/game-repository";
import { ageAtScenarioStart, getCharacterPanelData, getScenarioTimelineStartYear } from "../../../lib/character-service";
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
  const isDemoGame = gameId === "DEMO";
  if (!isDemoGame && await gameRepository.needsCharacterDeclaration(gameId)) {
    redirect(`/games/${encodeURIComponent(gameId)}/declare`);
  }

  const [world, knowledgebase, timelineStartYear] = await Promise.all([
    gameRepository.getWorld(gameId),
    getCharacterPanelData(gameId),
    getScenarioTimelineStartYear(gameId),
  ]);

  if (world === null) notFound();

  let characterPanel: CharacterPanelProps | undefined;
  if (knowledgebase !== null && knowledgebase.confirmedByPlayer) {
    const locationLabel = knowledgebase.locationProvinceId === null
      ? "Location not yet established"
      : world.provinces.find((province) => province.id === knowledgebase.locationProvinceId)?.name
        ?? world.mapGeoJson?.features.find((feature) => feature.id === knowledgebase.locationProvinceId && feature.properties.kind === "province")?.properties.name
        ?? knowledgebase.locationProvinceId;
    characterPanel = {
      characterName: knowledgebase.canonicalName,
      role: knowledgebase.role,
      locationLabel,
      culture: knowledgebase.culture,
      relations: knowledgebase.relations,
      origin: knowledgebase.origin,
      moneyLabel: `${world.material.personalAccount.balance.toLocaleString()} ${world.material.currencyName}`,
      moneyBalance: world.material.personalAccount.balance,
      moneyChanges: world.material.personalAccount.recentChanges,
      birthYearApprox: knowledgebase.birthYearApprox,
      ageAtStart: ageAtScenarioStart(knowledgebase.birthYearApprox, timelineStartYear),
      biography: knowledgebase.biography,
      notableEvents: knowledgebase.notableEvents,
      authority: knowledgebase.authority ?? [],
    };
  }

  const playerCharacterId = knowledgebase?.confirmedByPlayer ? knowledgebase.characterId : undefined;

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
      playerCharacterId={playerCharacterId}
    />
  );
}
