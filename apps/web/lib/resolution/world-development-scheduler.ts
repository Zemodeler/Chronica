import "server-only";
import { createHash } from "node:crypto";
import { createPressure, resolvePressure, type FactualEvent, type SelectedCharacter, type WorldState } from "@chronica/shared";

type Development = NonNullable<WorldState["worldDevelopments"]>[number];
type Candidate = Pick<Development, "id" | "kind" | "sourceId" | "actorId" | "provinceId" | "summary"> & { intensity: number; interval: number };
const MAX_REVIEWS = 12;
const PRESSURE_KIND = { scarcity: "political_danger", reconstruction: "political_danger", civic: "political_danger", war_burden: "military_emergency", household: "family_obligation" } as const;

function candidates(world: WorldState): Candidate[] {
  const result: Candidate[] = [];
  const living = world.characters.filter(c => c.alive).sort((a, b) => a.id.localeCompare(b.id));
  const leader = (polityId: string | null) => {
    if (!polityId) return undefined;
    const holders = new Set(world.material.officeSeats.filter(s => s.status === "held").map(s => s.holderCharacterId));
    return living.find(c => c.polityId === polityId && holders.has(c.id)) ?? living.find(c => c.polityId === polityId);
  };
  for (const material of world.material.provinceMaterial) {
    const province = world.map.provinces.find(p => p.id === material.provinceId);
    if (!province) continue;
    const actor = leader(province.controllerPolityId ?? null);
    if (!actor) continue;
    if (material.foodSecurityBps < 4_000) result.push({
      id: `scarcity:${province.id}`, kind: "scarcity", sourceId: province.id, actorId: actor.id, provinceId: province.id,
      summary: `Food insecurity in ${province.name} puts relief and provisioning before ${actor.name}.`,
      intensity: Math.round(40 + (4_000 - material.foodSecurityBps) / 100), interval: 1,
    });
    if (material.warDamageBps >= 1_000 || material.displacedPopulation > 0) result.push({
      id: `reconstruction:${province.id}`, kind: "reconstruction", sourceId: province.id, actorId: actor.id, provinceId: province.id,
      summary: `${province.name} needs reconstruction${material.displacedPopulation > 0 ? ` and resettlement for ${material.displacedPopulation} displaced inhabitants` : ""}; ${actor.name} has an opportunity to organize recovery.`,
      intensity: Math.min(80, 30 + Math.round(material.warDamageBps / 200)), interval: 2,
    });
  }
  for (const institution of world.material.institutions) {
    const actor = leader(institution.polityId);
    if (!actor) continue;
    result.push({ id: `civic:${institution.id}`, kind: "civic", sourceId: institution.id, actorId: actor.id, provinceId: null,
      summary: `${institution.name}'s recurring public business places readiness and administration before ${actor.name}.`, intensity: 35, interval: 4 });
  }
  for (const war of world.conflicts.wars) {
    for (const polityId of [war.polityAId, war.polityBId]) {
      const actor = leader(polityId);
      if (!actor) continue;
      result.push({ id: `war:${[war.polityAId, war.polityBId].sort().join(":")}:${polityId}`, kind: "war_burden", sourceId: polityId, actorId: actor.id, provinceId: null,
        summary: `The continuing war requires ${actor.name} to review supply, defense, and diplomatic options.`, intensity: 55, interval: 2 });
    }
  }
  for (const household of world.households.filter(h => h.active)) {
    const head = living.find(c => c.id === household.headCharacterId);
    const material = world.material.provinceMaterial.find(p => p.provinceId === head?.locationProvinceId);
    if (!head || !material || material.foodSecurityBps >= 4_000) continue;
    result.push({ id: `household:${household.id}`, kind: "household", sourceId: household.id, actorId: head.id, provinceId: material.provinceId,
      summary: `Local food insecurity puts the provisioning of ${household.name} before ${head.name}.`, intensity: 50, interval: 2 });
  }
  return result;
}

/** Cheap scheduled reviews run before AI, including in regions the player never visits. */
export function advanceWorldDevelopments(world: WorldState, atStep: number) {
  let next = world;
  const records = new Map((world.worldDevelopments ?? []).map(d => [d.id, d]));
  const sources = candidates(world);
  const sourceIds = new Set(sources.map(c => c.id));
  const events: Omit<FactualEvent, "id">[] = [];
  const pressureId = (d: Pick<Development, "id">) => `development:${createHash("sha256").update(d.id).digest("hex").slice(0, 32)}`;
  const mergePressure = (update: ReturnType<typeof resolvePressure>) => {
    next = { ...next, characters: [...update.characters], characterPressures: [...update.characterPressures] };
  };
  const emit = (d: Development, summary: string) => events.push({ atStep, kind: "action", actionId: "world_development", actorId: d.actorId,
    parameters: { developmentId: d.id, provinceId: d.provinceId, status: d.status, intensity: d.intensity }, summary, materialConsequence: false });

  // Removing the cause resolves its pressure immediately, even if its next review is distant.
  for (const d of records.values()) {
    if (d.status !== "active" || sourceIds.has(d.id)) continue;
    const resolved: Development = { ...d, status: "resolved", intensity: 0, lastReviewedStep: atStep, nextReviewStep: atStep };
    records.set(d.id, resolved);
    mergePressure(resolvePressure(next, pressureId(d)));
    // Household needs stay in personal state rather than the public Chronicle.
    if (d.kind !== "household") emit(resolved, `This concern is no longer active in its previous form: ${d.summary}`);
  }
  const due = sources.filter(c => {
    const old = records.get(c.id);
    return !old || (old.lastReviewedStep < atStep && (old.status === "resolved" || old.nextReviewStep <= atStep || old.actorId !== c.actorId));
  }).sort((a, b) => (records.get(a.id)?.nextReviewStep ?? 0) - (records.get(b.id)?.nextReviewStep ?? 0) || a.id.localeCompare(b.id)).slice(0, MAX_REVIEWS);

  for (const c of due) {
    const old = records.get(c.id);
    const continuing = old?.status === "active";
    const reviews = continuing ? old.reviews + 1 : 1;
    const intensity = Math.min(95, c.intensity + (c.kind === "civic" ? 0 : Math.min(20, (reviews - 1) * 5)));
    const d: Development = { id: c.id, kind: c.kind, sourceId: c.sourceId, actorId: c.actorId, provinceId: c.provinceId,
      summary: c.summary, intensity, reviews, status: "active", createdAtStep: continuing ? old.createdAtStep : atStep,
      lastReviewedStep: atStep, nextReviewStep: atStep + c.interval };
    records.set(c.id, d);
    // Replacing this scheduler-owned pressure keeps ids unique and updates the holder's mind.
    mergePressure(resolvePressure(next, pressureId(d)));
    next = { ...next, characterPressures: next.characterPressures.filter(p => p.id !== pressureId(d)) };
    mergePressure(createPressure(next, { id: pressureId(d), characterId: d.actorId, kind: PRESSURE_KIND[d.kind], intensity,
      label: d.summary.slice(0, 200), atStep, sourceEventId: null, reviewInSteps: c.interval + 1, expiresInSteps: null,
      visibility: d.kind === "household" ? "private" : "public" }));
    if (d.kind !== "household" && (!continuing || old.actorId !== d.actorId || Math.floor(old.intensity / 20) !== Math.floor(intensity / 20))) {
      emit(d, `${continuing ? "The concern persists. " : ""}${d.summary}`);
    }
  }
  // Keep active causes and a bounded recent resolution history.
  const all = [...records.values()];
  next = { ...next, worldDevelopments: [...all.filter(d => d.status === "active"), ...all.filter(d => d.status === "resolved").sort((a, b) => b.lastReviewedStep - a.lastReviewedStep || a.id.localeCompare(b.id)).slice(0, 64)] };
  return { world: next, events };
}

/** Reserved background slots supplement the ordinary relevance selection. */
export function selectDevelopmentActors(world: WorldState, atStep: number, playerId: string): SelectedCharacter[] {
  const ids = new Set<string>();
  const eligible = (world.worldDevelopments ?? []).filter(d => d.status === "active" && d.lastReviewedStep === atStep && d.actorId !== playerId)
    .filter(d => world.characters.some(c => c.id === d.actorId && c.alive))
    .sort((a, b) => a.nextReviewStep - b.nextReviewStep || a.id.localeCompare(b.id))
    .filter(d => { if (ids.has(d.actorId)) return false; ids.add(d.actorId); return true; });
  const offset = eligible.length === 0 ? 0 : (atStep * 3) % eligible.length;
  return [...eligible.slice(offset), ...eligible.slice(0, offset)].slice(0, 3)
    .map(d => ({ characterId: d.actorId, tier: "important", relevanceScore: 600, actionAllowance: 2, reasons: [`Scheduled world concern: ${d.summary}`] }));
}
