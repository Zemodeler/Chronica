import type { WorldState } from "./world-state";

export type ScopeTag = "star" | "near" | "far" | "coarse";

export interface ScopeAssignment {
  readonly star: Set<string>;
  readonly near: Set<string>;
  readonly far: Set<string>;
  readonly coarse: Set<string>;
}

/**
 * Compute the dynamic STAR/NEAR/FAR/COARSE theatre scope for the player this turn.
 *
 * STAR: player's immediate theatre (their province, polity, active war provinces, player forces).
 * NEAR: polities sharing borders with STAR, or in treaties/wars with STAR polities.
 * FAR:  polities within 2 graph hops of STAR, or referenced in active simulator storylines.
 * COARSE: everything else.
 *
 * The scope is recomputed fresh each turn from the current world snapshot.
 */
export function inferTheatre(world: WorldState, playerCharacterId: string): ScopeAssignment {
  const player = world.characters.find((c) => c.id === playerCharacterId);
  const playerPolityId = player?.polityId ?? null;

  const star = new Set<string>();
  const near = new Set<string>();
  const far = new Set<string>();
  const coarse = new Set<string>();

  // ── STAR ──────────────────────────────────────────────────────────────────

  if (playerPolityId) star.add(playerPolityId);
  if (player?.locationProvinceId) star.add(player.locationProvinceId);

  // Player-controlled forces
  for (const force of world.material.forces) {
    if (force.commanderCharacterId === playerCharacterId || force.controllerCharacterId === playerCharacterId) {
      if (force.locationId) star.add(force.locationId);
    }
  }

  // Player's office polity
  if (player?.officeId && playerPolityId) {
    // Approximate: if player holds an office, include their polity as STAR
    star.add(playerPolityId);
  }

  // Active wars where player's polity is a belligerent
  for (const war of world.conflicts.wars) {
    if (playerPolityId && (war.polityAId === playerPolityId || war.polityBId === playerPolityId)) {
      star.add(war.polityAId);
      star.add(war.polityBId);
      // Add provinces of warring polities
      for (const p of world.map.provinces) {
        if (p.controllerPolityId === war.polityAId || p.controllerPolityId === war.polityBId) {
          star.add(p.id);
        }
      }
    }
  }

  // Active player-driven storylines
  for (const storyline of world.storylines ?? []) {
    const type = (storyline as Record<string, unknown>)["type"];
    if (type === "player_driven" && storyline.provinceId) {
      star.add(storyline.provinceId);
    }
  }

  // Provinces controlled by player polity
  if (playerPolityId) {
    for (const p of world.map.provinces) {
      if (p.controllerPolityId === playerPolityId) star.add(p.id);
    }
  }

  // ── NEAR ──────────────────────────────────────────────────────────────────

  // Polities sharing a border with any STAR province
  const starProvinceIds = new Set([...star].filter((id) => world.map.provinces.some((p) => p.id === id)));
  for (const edge of world.map.edges) {
    const fromStar = starProvinceIds.has(edge.from);
    const toStar = starProvinceIds.has(edge.to);
    if (fromStar || toStar) {
      const otherProvinceId = fromStar ? edge.to : edge.from;
      const otherProv = world.map.provinces.find((p) => p.id === otherProvinceId);
      if (otherProv?.controllerPolityId && !star.has(otherProv.controllerPolityId)) {
        near.add(otherProv.controllerPolityId);
        near.add(otherProv.id);
      }
    }
  }

  // Polities in active wars involving STAR polities (even non-player belligerent)
  const starPolityIds = new Set([...star].filter((id) => world.map.polities.some((p) => p.id === id)));
  for (const war of world.conflicts.wars) {
    if (starPolityIds.has(war.polityAId) || starPolityIds.has(war.polityBId)) {
      if (!star.has(war.polityAId)) near.add(war.polityAId);
      if (!star.has(war.polityBId)) near.add(war.polityBId);
    }
  }

  // ── FAR ───────────────────────────────────────────────────────────────────

  // Polities within 2 graph hops of STAR provinces
  const nearProvinceIds = new Set([...near].filter((id) => world.map.provinces.some((p) => p.id === id)));
  for (const edge of world.map.edges) {
    const fromNear = nearProvinceIds.has(edge.from);
    const toNear = nearProvinceIds.has(edge.to);
    if (fromNear || toNear) {
      const otherProvinceId = fromNear ? edge.to : edge.from;
      const otherProv = world.map.provinces.find((p) => p.id === otherProvinceId);
      if (otherProv?.controllerPolityId && !star.has(otherProv.controllerPolityId) && !near.has(otherProv.controllerPolityId)) {
        far.add(otherProv.controllerPolityId);
        far.add(otherProv.id);
      }
    }
  }

  // Polities referenced in active simulator storylines
  for (const storyline of world.storylines ?? []) {
    const type = (storyline as Record<string, unknown>)["type"];
    if (type === "simulator" && storyline.provinceId) {
      const prov = world.map.provinces.find((p) => p.id === storyline.provinceId);
      if (prov?.controllerPolityId && !star.has(prov.controllerPolityId) && !near.has(prov.controllerPolityId)) {
        far.add(prov.controllerPolityId);
        far.add(storyline.provinceId);
      }
    }
  }

  // ── COARSE ────────────────────────────────────────────────────────────────

  for (const polity of world.map.polities) {
    if (!star.has(polity.id) && !near.has(polity.id) && !far.has(polity.id)) {
      coarse.add(polity.id);
    }
  }
  for (const prov of world.map.provinces) {
    if (!star.has(prov.id) && !near.has(prov.id) && !far.has(prov.id)) {
      coarse.add(prov.id);
    }
  }

  return { star, near, far, coarse };
}
