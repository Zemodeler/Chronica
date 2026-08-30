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
  const isDemoGame = gameId === "DEMO";
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
      relations: knowledgebase.relations.slice(0, 6),
      origin: knowledgebase.origin,
      moneyLabel: `${world.material.personalAccount.balance.toLocaleString()} ${world.material.currencyName}`,
      authority: knowledgebase.skills.subSkills.authority ?? 0,
      skills: {
        martial: knowledgebase.skills.martial,
        diplomacy: knowledgebase.skills.diplomacy,
        stewardship: knowledgebase.skills.stewardship,
        intrigue: knowledgebase.skills.intrigue,
      },
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
