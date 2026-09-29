import { isAilment, type FactProposalDraft, type WorldState } from "@chronica/shared";
import { scarredBy } from "./skill-decline";

/**
 * Ailments written as words pass in their time (`characters/ailments.ts`).
 *
 * One with no time recorded is older than the record, and nothing could ever
 * have ended it: it passes now. Blasio's fever had kept a consul in bed for
 * forty days, and would have kept him there for the rest of his life.
 */
export function lapseAilments(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let changed = false;
  const characters = world.characters.map((character) => {
    if (!character.alive) return character;
    const ailing = character.disqualifyingStatuses.filter(isAilment);
    if (ailing.length === 0 && (character.ailmentsUntil ?? []).length === 0) return character;
    const until = new Map((character.ailmentsUntil ?? []).map((entry) => [entry.status, entry.untilStep]));
    const passed = ailing.filter((status) => (until.get(status) ?? toDay) <= toDay);
    if (passed.length === 0) return character;
    changed = true;
    facts.push({
      localId: `recovered_${character.id}_${toDay}`.slice(0, 60),
      kind: "recovery",
      summary: `${character.name} recovered from ${passed.join(" and ")}, and took up ${character.gender === "female" ? "her" : "his"} affairs again.`,
      affectedRefs: [{ kind: "character", id: character.id }, ...(character.polityId === null ? [] : [{ kind: "polity" as const, id: character.polityId }])],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 30,
    });
    const scarred = passed.reduce((marked, status) => scarredBy(marked, status, toDay), character);
    return {
      ...scarred,
      disqualifyingStatuses: character.disqualifyingStatuses.filter((status) => !passed.includes(status)),
      ailmentsUntil: (character.ailmentsUntil ?? []).filter((entry) => !passed.includes(entry.status)),
    };
  });
  return { world: changed ? { ...world, characters } : world, facts };
}
