import { ageAtScenarioStart, getCharacterPanelData, getCharacterReputation, getScenarioTimelineStartYear } from "../../../../../lib/character-service";

/**
 * Player-facing character profile.
 *
 * Raw skill scores must never cross this boundary -- a number invites
 * optimisation and a person does not have one. What does cross, since slice
 * 11, is the *judgment*: "a capable soldier, a poor administrator", which is
 * what a man's contemporaries would say of him, is not arithmetic anybody can
 * play against, and was information the panel had no business withholding.
 * Traits and standing come with it, and both are things other people decide.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const [character, timelineStartYear] = await Promise.all([getCharacterPanelData(gameId), getScenarioTimelineStartYear(gameId)]);
  if (character === null) return Response.json({ error: "Character file not found." }, { status: 404 });
  const reputation = await getCharacterReputation(gameId, character.characterId);
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
    // Words, never scores.
    traits: reputation.traits,
    standing: reputation.standing,
    skills: reputation.skills,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
