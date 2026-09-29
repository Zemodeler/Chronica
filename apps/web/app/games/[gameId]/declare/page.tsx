import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { gameRepository } from "../../../../lib/game-repository";
import { CharacterDeclareClient } from "./character-declare-client";

export const metadata: Metadata = { title: "Choose your character" };

export default async function DeclarePage({
  params,
}: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const [world, people] = await Promise.all([
    gameRepository.getWorld(gameId, true),
    gameRepository.listNotablePeople(gameId),
  ]);
  if (world === null) notFound();

  return <CharacterDeclareClient gameId={gameId} gameTitle={world.gameTitle} dateLabel={world.dateLabel} scenarioId={world.scenarioId} people={people} />;
}
