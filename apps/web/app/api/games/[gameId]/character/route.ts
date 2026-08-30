import { getCharacterPanelData } from "../../../../../lib/character-service";

/** Internal player-scoped profile export; no map-screen control links to it. */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const character = await getCharacterPanelData(gameId);
  if (character === null) return Response.json({ error: "Character file not found." }, { status: 404 });
  return Response.json(character, { headers: { "Cache-Control": "private, no-store" } });
}
