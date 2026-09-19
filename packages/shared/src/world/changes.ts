import type { WorldState } from "./world-state";

/**
 * What actually changed on the map, by comparing two worlds.
 *
 * The Chronicle used to be prose and nothing else. A passage could say the
 * legions marched north and a reader had no way to learn that two provinces
 * had changed hands, an army of nine thousand had ceased to exist, and a
 * commander was dead -- unless the historian happened to mention it, which is
 * exactly the thing a historian is bad at being reliable about.
 *
 * So the record carries a change list beside the prose. It is derived from the
 * world rather than from the deltas that moved it, for two reasons: there are
 * twenty-nine delta arms and this would otherwise be twenty-nine cases that
 * drift apart, and a change is true whether or not the delta that caused it
 * was the one anybody thought it was.
 *
 * Nothing here decides what the *player* may see. A change reaches an entry
 * only when that entry's own visible facts name the thing that changed, which
 * is `chronicle.ts`'s business -- this function may freely compare the whole
 * world, because its output is filtered before anybody reads it.
 */

export type WorldChangeKind = "province" | "force" | "character" | "polity";

export interface WorldChange {
  readonly kind: WorldChangeKind;
  /** The entity that changed, so an entry can claim it by subject. */
  readonly id: string;
  /** What it is called, as a reader would name it: "Legion II", "Vatluna". */
  readonly label: string;
  /** What happened to it, in a few words: "passed to Rome", "raised in Latium". */
  readonly detail: string;
}

/** Below this many men lost or gained, an army has not visibly changed size. */
const STRENGTH_NOTICE = 250;

const strengthOf = (force: WorldState["material"]["forces"][number]): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

const round = (men: number): string => (men >= 1_000 ? `${Math.round(men / 100) / 10}k` : String(men));

export function diffWorlds(before: WorldState, after: WorldState): WorldChange[] {
  const changes: WorldChange[] = [];

  const polityName = (id: string | null): string => {
    if (id === null) return "no one";
    return after.map.polities.find((polity) => polity.id === id)?.name
      ?? before.map.polities.find((polity) => polity.id === id)?.name
      ?? id;
  };
  const provinceName = (id: string): string =>
    after.map.provinces.find((province) => province.id === id)?.name
    ?? before.map.provinces.find((province) => province.id === id)?.name
    ?? id;

  // ── Provinces changing hands ─────────────────────────────────────────────
  const provincesBefore = new Map(before.map.provinces.map((province) => [province.id, province]));
  for (const province of after.map.provinces) {
    const was = provincesBefore.get(province.id);
    if (was === undefined) {
      changes.push({ kind: "province", id: province.id, label: province.name, detail: `enters the record under ${polityName(province.controllerPolityId)}` });
      continue;
    }
    if (was.controllerPolityId === province.controllerPolityId) continue;
    changes.push({
      kind: "province",
      id: province.id,
      label: province.name,
      detail: was.controllerPolityId === null
        ? `comes under ${polityName(province.controllerPolityId)}`
        : `passes from ${polityName(was.controllerPolityId)} to ${polityName(province.controllerPolityId)}`,
    });
  }

  // ── Armies raised, lost, moved, or bled ──────────────────────────────────
  const forcesBefore = new Map(before.material.forces.map((force) => [force.id, force]));
  const forcesAfter = new Map(after.material.forces.map((force) => [force.id, force]));
  for (const force of after.material.forces) {
    const was = forcesBefore.get(force.id);
    if (was === undefined) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: `raised under ${polityName(force.polityId)} at ${provinceName(force.locationId)}, ${round(strengthOf(force))} men`,
      });
      continue;
    }
    if (was.locationId !== force.locationId) {
      changes.push({ kind: "force", id: force.id, label: force.name, detail: `moves from ${provinceName(was.locationId)} to ${provinceName(force.locationId)}` });
    }
    const lost = strengthOf(was) - strengthOf(force);
    if (Math.abs(lost) >= STRENGTH_NOTICE) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: lost > 0 ? `down ${round(lost)} to ${round(strengthOf(force))} men` : `up ${round(-lost)} to ${round(strengthOf(force))} men`,
      });
    }
    // Reinforcement is an order for more men before it is more men. A garrison
    // strengthened by three hundred moved only its authorized strength, so the
    // entry that announced the reinforcement carried no change at all -- the
    // one row a reader would actually have wanted from it.
    const authorized = force.authorizedStrength - was.authorizedStrength;
    if (Math.abs(authorized) >= STRENGTH_NOTICE) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: authorized > 0
          ? `called up to ${round(force.authorizedStrength)} men, ${round(authorized)} more than before`
          : `cut to ${round(force.authorizedStrength)} men`,
      });
    }
    if (was.polityId !== force.polityId) {
      changes.push({ kind: "force", id: force.id, label: force.name, detail: `now answers to ${polityName(force.polityId)}` });
    }
  }
  for (const force of before.material.forces) {
    if (forcesAfter.has(force.id)) continue;
    changes.push({ kind: "force", id: force.id, label: force.name, detail: `destroyed or dispersed at ${provinceName(force.locationId)}` });
  }

  // ── People who arrived or died ───────────────────────────────────────────
  const charactersBefore = new Map(before.characters.map((character) => [character.id, character]));
  for (const character of after.characters) {
    const was = charactersBefore.get(character.id);
    if (was === undefined) {
      changes.push({ kind: "character", id: character.id, label: character.name, detail: `enters the record under ${polityName(character.polityId)}` });
      continue;
    }
    if (was.alive && !character.alive) changes.push({ kind: "character", id: character.id, label: character.name, detail: "dies" });
    if (was.officeId !== character.officeId && character.officeId !== null) {
      changes.push({ kind: "character", id: character.id, label: character.name, detail: `takes up ${character.officeId}` });
    }
  }

  // ── What the ledger of provinces adds up to, per power ───────────────────
  const held = (world: WorldState, polityId: string): number => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;
  for (const polity of after.map.polities) {
    const gained = held(after, polity.id) - held(before, polity.id);
    if (gained === 0) continue;
    changes.push({
      kind: "polity",
      id: polity.id,
      label: polity.name,
      detail: gained > 0 ? `holds ${gained} province${gained === 1 ? "" : "s"} more` : `holds ${-gained} province${gained === -1 ? "" : "s"} fewer`,
    });
  }

  return changes;
}
