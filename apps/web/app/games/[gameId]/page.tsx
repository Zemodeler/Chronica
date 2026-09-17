import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { gameRepository } from "../../../lib/game-repository";
import { ageAtScenarioStart, getCharacterPanelData, getPlayerAuthoritySummary, getScenarioTimelineStartYear } from "../../../lib/character-service";
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
    const canonicalAuthority = await getPlayerAuthoritySummary(gameId, knowledgebase.characterId);
    const hasCanonicalAuthority = canonicalAuthority.length > 0 && canonicalAuthority[0] !== "No current public office";
    // Legacy free-text authority claims never grant power; once canonical
    // state names any authority, the AI-generated text is downgraded to a
    // background note rather than shown as the primary Authority list.
    const legacyAuthorityNote = !hasCanonicalAuthority && knowledgebase.authority.length > 0
      ? knowledgebase.authority
      : [];
    const locationLabel = knowledgebase.locationProvinceId === null
      ? "Location not yet established"
      : world.provinces.find((province) => province.id === knowledgebase.locationProvinceId)?.name
        ?? world.mapGeoJson?.features.find((feature) => feature.id === knowledgebase.locationProvinceId && feature.properties.kind === "province")?.properties.name
        ?? knowledgebase.locationProvinceId;
    const hasMaterialPersonalAccount = world.material.personalAccount.id !== "no-account";
    // Older JSONB character files predate startingMoney. Keep those saves
    // readable while all newly generated drafts are required to provide it.
    const moneyBalance = hasMaterialPersonalAccount ? world.material.personalAccount.balance : (knowledgebase.startingMoney ?? 0);
    const moneyChanges = hasMaterialPersonalAccount ? world.material.personalAccount.recentChanges : [];
    characterPanel = {
      characterName: knowledgebase.canonicalName,
      role: knowledgebase.role,
      locationLabel,
      culture: knowledgebase.culture,
      relations: knowledgebase.relations,
      origin: knowledgebase.origin,
      moneyLabel: `${moneyBalance.toLocaleString()} ${world.material.currencyName}`,
      moneyBalance,
      moneyChanges,
      birthYearApprox: knowledgebase.birthYearApprox,
      ageAtStart: ageAtScenarioStart(knowledgebase.birthYearApprox, timelineStartYear),
      biography: knowledgebase.biography,
      notableEvents: knowledgebase.notableEvents,
      authority: canonicalAuthority,
      authorityBackgroundNote: legacyAuthorityNote,
    };
  }

  // Chat needs the declared-character knowledgebase to speak in the player's
  // own voice. Giving orders does not: holding a character in the world is the
  // whole qualification, so the council is reachable as soon as one is held.
  const chatCharacterId = knowledgebase?.confirmedByPlayer ? knowledgebase.characterId : undefined;
  const orderingCharacterId = world.viewerCharacterId ?? undefined;

  return (
    <GameShell
      gameId={world.gameId}
      gameTitle={world.gameTitle}
      elapsedStepLabel={world.dateLabel}
      initialGeoJson={world.mapGeoJson}
      initialOverlay={world.mapOverlay}
      baseImageUrl="/maps/natural-earth-ii-blue-oceans.png"
      characterPanel={characterPanel}
      playerCharacterId={chatCharacterId}
      orderingCharacterId={orderingCharacterId}
    />
  );
}
