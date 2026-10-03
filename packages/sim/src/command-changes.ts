import type { FactProposalDraft, OrderPartyRef, WorldState } from "@chronica/shared";

/**
 * An army or fleet that changed hands, told to the man it was taken from.
 *
 * Legio II, raised on the consul's own order, passed to a praetor plotting
 * against him, and the fleet he moved and paid for to a third man; neither was
 * announced, and he learned of both from soldiers who would not obey him. Who
 * commands a force, and whom it answers to, is the kind of thing a man is told.
 */
export function commandChanges(before: WorldState, after: WorldState, exceptIds: ReadonlySet<string> = new Set()): FactProposalDraft[] {
  if (before.material.forces === after.material.forces) return [];
  const was = new Map(before.material.forces.map((force) => [force.id, force]));
  const name = (id: string | null): string => after.characters.find((character) => character.id === id)?.name ?? before.characters.find((character) => character.id === id)?.name ?? "nobody";
  const facts: FactProposalDraft[] = [];
  for (const force of after.material.forces) {
    const old = was.get(force.id);
    if (old === undefined || old.polityId !== force.polityId) continue;
    const lost = [...new Set([old.commanderCharacterId, old.controllerCharacterId])]
      .filter((id): id is string => id !== null && id !== force.commanderCharacterId && id !== force.controllerCharacterId && !exceptIds.has(id)
        // The dead are not told.
        && after.characters.some((character) => character.id === id && character.alive));
    if (lost.length === 0) continue;
    const now = force.controllerCharacterId === force.commanderCharacterId || force.controllerCharacterId === null
      ? `${name(force.commanderCharacterId)} commands it now`
      : `${name(force.commanderCharacterId)} commands it now, answering to ${name(force.controllerCharacterId)}`;
    const refs: OrderPartyRef[] = [
      { kind: "force", id: force.id },
      ...lost.map((id) => ({ kind: "character" as const, id })),
      ...[force.commanderCharacterId, force.controllerCharacterId].filter((id): id is string => id !== null).map((id) => ({ kind: "character" as const, id })),
    ];
    facts.push({
      localId: `command_${force.id}_${after.elapsedStep}`.slice(0, 60),
      kind: "command_changed",
      summary: `${force.name} is no longer ${lost.map(name).join("'s or ")}'s to give orders to: ${now}.`.slice(0, 600),
      affectedRefs: refs.slice(0, 8),
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      knownToRefs: lost.map((id) => ({ kind: "character" as const, id })),
      significance: 40,
    });
  }
  return facts;
}
