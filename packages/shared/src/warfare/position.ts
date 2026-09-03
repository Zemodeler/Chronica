import type { Province, Position } from "../world/map";

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
