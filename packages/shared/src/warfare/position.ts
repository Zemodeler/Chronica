import type { Province, Position, PositionType } from "../world/map";

// Intra-province operational positions (docs/19 Phase 3).
//
// A force's `locationId` says which province it is in; it never said
// *where* in that province, so two forces sharing a province could not be
// distinguished for scouting, interception, siege, or rendering. A
// `Position` is that missing, stable place: a settlement, its outskirts, a
// camp, a pass, a river crossing, a coast, a harbour, a siege line, an open
// battlefield, or the unremarkable interior. The schema itself
// (`PositionSchema`) lives in `world/map.ts`, alongside `Province`, to avoid
// a schema import cycle; this module holds the pure assignment logic.
//
// A scenario may author positions that matter (`Province.positions`); any
// province without them still gets a position for every force, generated
// deterministically from its own data (`fallbackPositionsFor`), so
// assignment never depends on iteration order or randomness and a replay
// always lands on the same position.

function fallbackPositionId(provinceId: string, suffix: string): string {
  return `${provinceId}::${suffix}`;
}

/**
 * Deterministic fallback positions for a province with none authored: one
 * `settlement` position per settlement (a garrisoned town is a real,
 * defensible place), a generic `camp` for a force in the open, and an
 * `interior` catch-all. Always the same list for the same province.
 */
export function fallbackPositionsFor(province: Province): Position[] {
  const settlementPositions: Position[] = province.settlements.map((settlement) => ({
    id: fallbackPositionId(province.id, `settlement:${settlement.id}`),
    provinceId: province.id,
    label: settlement.name,
    type: "settlement",
    combatModifierBps: Math.min(2_000, settlement.fortificationLevel * 200),
    capacity: null,
  }));
  return [
    ...settlementPositions,
    {
      id: fallbackPositionId(province.id, "camp"),
      provinceId: province.id,
      label: `${province.name} (encamped)`,
      type: "camp",
      combatModifierBps: 0,
      capacity: null,
    },
    {
      id: fallbackPositionId(province.id, "interior"),
      provinceId: province.id,
      label: province.name,
      type: "interior",
      combatModifierBps: 0,
      capacity: null,
    },
  ];
}

/** Authored positions if the scenario declared any; otherwise the deterministic fallback list. */
export function positionsForProvince(province: Province): Position[] {
  return province.positions && province.positions.length > 0 ? province.positions : fallbackPositionsFor(province);
}

export function findPosition(province: Province, positionId: string): Position | undefined {
  return positionsForProvince(province).find((position) => position.id === positionId);
}

/**
 * The default position a force with no explicit assignment resolves to: its
 * province's first settlement if it has one (a garrison is the ordinary
 * case), else the generic interior position. Deterministic and replay-safe
 * -- it depends only on the province's own data, never on other forces.
 */
export function defaultPositionFor(province: Province): Position {
  const positions = positionsForProvince(province);
  return positions.find((position) => position.type === "settlement") ?? positions[positions.length - 1]!;
}

/** Resolve a force's actual position: its own assignment if still valid, else the province default. */
export function resolveForcePosition(province: Province, positionId: string | null): Position {
  if (positionId) {
    const found = findPosition(province, positionId);
    if (found) return found;
  }
  return defaultPositionFor(province);
}

/**
 * What holding a given sort of ground is worth, in the engine's own figures.
 *
 * A position a scenario never authored can still be named -- "the pass above
 * the camp", "the siege line before Lilybaeum" -- and when it is, the world
 * says which sort of place it is and this table says what that is worth. The
 * numbers are deliberately not the caller's: a commander who could set his own
 * defensive bonus would never fight anywhere else.
 *
 * Bounded by the same +/-2 000 as `PositionSchema` and as a tactical proposal,
 * and aligned with the figures the Punic Wars scenario authored by hand: its
 * Mount Etna is a pass worth 700.
 */
const MINTED_POSITION_MODIFIER_BPS: Record<PositionType, number> = {
  settlement: 800,
  outskirts: 200,
  camp: 0,
  pass: 700,
  road_approach: 100,
  river_crossing: 600,
  coast: -300,
  harbour: 200,
  siege_line: 900,
  battlefield: 0,
  interior: 0,
};

/**
 * A place in a province that the map did not previously record.
 *
 * The map is a drawing of the world, not the whole of it: a player who orders
 * his army to hold a ford is naming real ground whether or not a cartographer
 * wrote it down, and the engine may not refuse the order for want of the row.
 * Deterministic in the id it is given, so a replay lands on the same place.
 */
export function mintPosition(provinceId: string, positionId: string, label: string, type: PositionType): Position {
  return {
    id: positionId,
    provinceId,
    label,
    type,
    combatModifierBps: MINTED_POSITION_MODIFIER_BPS[type],
    capacity: null,
  };
}

/**
 * That province's positions with a newly made one added, keeping whatever it
 * already had.
 *
 * A province with nothing authored falls back to a generated list, so writing
 * a single minted position straight into `positions` would silently delete the
 * settlements and the camp that list contains. Seeding from the fallback keeps
 * everywhere a force could already stand exactly where it was.
 */
export function provinceWithPosition(province: Province, position: Position): Province {
  const existing = positionsForProvince(province);
  if (existing.some((candidate) => candidate.id === position.id)) return province;
  return { ...province, positions: [...existing, position] };
}
