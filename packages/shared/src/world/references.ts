import type { WorldState } from "./world-state";

// Cross-collection references (GM refactor follow-on).
//
// `WorldStateSchema` validates each collection's own shape, and its
// `superRefine` checks the family/household/contract/legacy graph. It does not
// check that a character's province, polity, purse, or heir actually exist, or
// that a force stands somewhere real under someone real. Those are just id
// strings to Zod.
//
// Until now the only code that checked them was the invented-workflow patch
// applier, which no longer runs. This module makes the check reusable, and
// `executeWorkflow` enforces it as a delta: a workflow may not *introduce* a
// dangling reference. It is deliberately not a schema-level requirement -- a
// snapshot committed before this existed may already carry one, and a hard
// requirement would make those games unloadable rather than repairable. See
// `material/character-accounts.ts`'s `ensureCharacterAccounts` for the repair.

/**
 * Every cross-collection reference in `world` that does not resolve.
 *
 * Returned as stable, human-readable strings so a caller can diff two worlds
 * and report exactly what a mutation broke.
 */
export function findWorldReferenceViolations(world: WorldState): string[] {
  const violations: string[] = [];
  const provinceIds = new Set(world.map.provinces.map((province) => province.id));
  const polityIds = new Set(world.map.polities.map((polity) => polity.id));
  const characterIds = new Set(world.characters.map((character) => character.id));
  const accountIds = new Set(world.material.accounts.map((account) => account.id));

  for (const character of world.characters) {
    if (!provinceIds.has(character.locationProvinceId)) violations.push(`Character ${character.id} references a missing province.`);
    if (character.polityId !== null && !polityIds.has(character.polityId)) violations.push(`Character ${character.id} references a missing polity.`);
    if (!accountIds.has(character.personalAccountId)) violations.push(`Character ${character.id} references a missing account.`);
    if (character.heirCharacterId !== null && !characterIds.has(character.heirCharacterId)) violations.push(`Character ${character.id} references a missing heir.`);
  }
  for (const storyline of world.storylines) {
    if (storyline.provinceId !== null && !provinceIds.has(storyline.provinceId)) violations.push(`Storyline ${storyline.id} references a missing province.`);
    if (storyline.participantIds.some((id) => !characterIds.has(id))) violations.push(`Storyline ${storyline.id} references a missing participant.`);
  }
  for (const force of world.material.forces) {
    if (!provinceIds.has(force.locationId)) violations.push(`Force ${force.id} references a missing province.`);
    if (!characterIds.has(force.commanderCharacterId)) violations.push(`Force ${force.id} references a missing commander.`);
    if (!characterIds.has(force.controllerCharacterId)) violations.push(`Force ${force.id} references a missing controller.`);
  }
  return violations;
}

/**
 * The dangling references `after` has that `before` did not.
 *
 * Empty when a mutation only inherited breakage that was already committed, so
 * an existing game keeps working while a new defect is refused.
 */
export function referenceViolationsIntroduced(before: WorldState, after: WorldState): string[] {
  const introduced = findWorldReferenceViolations(after);
  if (introduced.length === 0) return [];
  const existing = new Set(findWorldReferenceViolations(before));
  return introduced.filter((violation) => !existing.has(violation));
}
