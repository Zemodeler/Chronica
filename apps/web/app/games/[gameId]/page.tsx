import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { gameRepository } from "../../../lib/game-repository";
import { ageAtScenarioStart, getCharacterPanelData, getScenarioTimelineStartYear } from "../../../lib/character-service";
import { GameShell } from "./components/game-shell";
import { roomStyleFor } from "./components/office-objects";
import type { CharacterPanelProps } from "./components/character-panel";
import { unopenableSave } from "../../../lib/save-errors";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const world = await gameRepository.getWorld(gameId).catch((error: unknown) => {
    if (unopenableSave(error) === null) throw error;
    return null;
  });
  return { title: world?.gameTitle ?? "Game" };
}

/** A save that will not open, said plainly in place of the room (see save-errors.ts). */
function SaveNeedsRepair({ message }: { readonly message: string }) {
  return (
    <div className="lamp-wait" role="alert">
      <div>
        <p className="lamp-wait__kicker">This world</p>
        <h1 className="lamp-wait__name">needs repair</h1>
        <p className="lamp-wait__note">{message}</p>
      </div>
    </div>
  );
}

export default async function GamePage({
  params,
}: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;

  // The demo game uses a fixture lobby with pre-defined characters, not AI.
  const isDemoGame = gameId === "DEMO";
  let loaded;
  try {
    if (!isDemoGame && await gameRepository.needsCharacterDeclaration(gameId)) {
      redirect(`/games/${encodeURIComponent(gameId)}/declare`);
    }
    loaded = await Promise.all([
      gameRepository.getWorld(gameId),
      getCharacterPanelData(gameId),
      getScenarioTimelineStartYear(gameId),
    ]);
  } catch (error) {
    // Not a 500: a stored world or its pinned rules that will not parse.
    // `redirect` throws too, and is not one of these, so it passes through.
    const message = unopenableSave(error);
    if (message === null) throw error;
    console.error(`[game ${gameId}] ${error instanceof Error ? error.message : String(error)}`);
    return <SaveNeedsRepair message={message} />;
  }
  const [world, knowledgebase, timelineStartYear] = loaded;

  if (world === null) notFound();

  // Only what the declaration is the authority on: who he was born, where,
  // and what he was before the game began. Everything that can change --
  // where he is, his money, his office, his reputation, his people -- comes
  // with the room (room-service.ts), read from the world each time time moves.
  let characterPanel: CharacterPanelProps | undefined;
  if (knowledgebase !== null && knowledgebase.confirmedByPlayer) {
    characterPanel = {
      characterName: knowledgebase.canonicalName,
      role: knowledgebase.role,
      culture: knowledgebase.culture,
      origin: knowledgebase.origin,
      birthYearApprox: knowledgebase.birthYearApprox,
      ageAtStart: ageAtScenarioStart(knowledgebase.birthYearApprox, timelineStartYear),
      biography: knowledgebase.biography,
      notableEvents: knowledgebase.notableEvents,
      // Free-text authority claims never grant power; shown as background
      // only while the world names none.
      declaredAuthority: knowledgebase.authority,
    };
  }

  // Chat needs the declared-character knowledgebase to speak in the player's
  // own voice. Giving orders does not: holding a character in the world is the
  // whole qualification, so the council is reachable as soon as one is held.
  const chatCharacterId = knowledgebase?.confirmedByPlayer ? knowledgebase.characterId : undefined;
  const orderingCharacterId = world.viewerCharacterId ?? undefined;

  // Which room the player works in. The knowledgebase's culture is free text
  // ("Roman Patrician"), which is exactly what roomStyleFor is written to read.
  const roomStyle = roomStyleFor(knowledgebase?.culture ?? "", world.viewerPolityId ?? null);

  return (
    <GameShell
      gameId={world.gameId}
      gameTitle={world.gameTitle}
      elapsedStepLabel={world.dateLabel}
      mapVersion={world.mapVersion}
      initialOverlay={world.mapOverlay}
      initialOverlayStamp={String(world.worldRevision)}
      baseImageUrl="/maps/natural-earth-ii-blue-oceans.png"
      reliefUrl="/maps/relief"
      characterPanel={characterPanel}
      playerCharacterId={chatCharacterId}
      orderingCharacterId={orderingCharacterId}
      roomStyle={roomStyle}
    />
  );
}
