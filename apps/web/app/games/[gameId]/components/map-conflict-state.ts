import type { DynamicMapOverlay } from "@chronica/shared";

export type ForceConflictState = { readonly conflictClass: "combat" | "siege-attacker" | "siege-defender"; readonly statusLabel: string };

export function deriveForceConflictStatuses(overlay: DynamicMapOverlay | null): ReadonlyMap<string, ForceConflictState> {
  const statuses = new Map<string, ForceConflictState>();
  for (const battle of overlay?.conflicts.battles ?? []) for (const forceId of battle.participantForceIds) statuses.set(forceId, { conflictClass: "combat", statusLabel: "In combat" });
  const settlementNames = new Map((overlay?.settlements ?? []).map((settlement) => [settlement.settlementId, settlement.name]));
  for (const siege of overlay?.conflicts.sieges ?? []) {
    const settlementName = settlementNames.get(siege.settlementId) ?? "a settlement";
    for (const forceId of siege.invadingForceIds) if (!statuses.has(forceId)) statuses.set(forceId, { conflictClass: "siege-attacker", statusLabel: `Besieging ${settlementName}` });
    for (const forceId of siege.defendingForceIds) if (!statuses.has(forceId)) statuses.set(forceId, { conflictClass: "siege-defender", statusLabel: `Defending ${settlementName}` });
  }
  return statuses;
}
