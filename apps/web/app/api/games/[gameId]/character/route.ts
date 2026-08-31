import { ageAtScenarioStart, getCharacterPanelData, getScenarioTimelineStartYear } from "../../../../../lib/character-service";

/** Player-facing character profile. AI-only skill data must never cross this boundary. */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const [character, timelineStartYear] = await Promise.all([getCharacterPanelData(gameId), getScenarioTimelineStartYear(gameId)]);
  if (character === null) return Response.json({ error: "Character file not found." }, { status: 404 });
  return Response.json({
    canonicalName: character.canonicalName,
    nickname: character.nickname,
    birthYearApprox: character.birthYearApprox,
    ageAtStart: ageAtScenarioStart(character.birthYearApprox, timelineStartYear),
    origin: character.origin,
    period: character.period,
    locationProvinceId: character.locationProvinceId,
    culture: character.culture,
    faith: character.faith,
    biography: character.biography,
    notableEvents: character.notableEvents,
    role: character.role,
    authority: character.authority,
    socioEconomicClass: character.socioEconomicClass,
    startingMoney: character.startingMoney ?? 0,
    relations: character.relations,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
