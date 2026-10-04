import { normalizeName, spelledAlike, type WorldState, type OrderGoal, type WorldDelta } from "@chronica/shared";

const ADJECTIVAL = new Set(["garrison", "army", "council", "fleet", "force", "forces", "men", "troops", "ships", "legion", "levy", "citizens", "militia"]);
/** Words before a name that keep a place rather than go to it: "leaving 1,000 men to hold Messana". */
const STAYING = new Set(["of", "from", "hold", "holds", "holding", "keep", "keeps", "keeping", "guard", "guards", "guarding", "defend", "defends", "defending", "protect", "protecting", "garrison", "garrisoning", "leave", "leaves", "leaving"]);

/** Words before a name that send something there: "to Messana", "against Syracuse". */
const GOING = new Set(["to", "towards", "toward", "into", "against", "on", "reach", "reaches", "reaching", "for"]);

/** Outcomes explicitly requested, independent of whatever substitute acts were proposed. */
export function explicitOrderGoals(world: WorldState, said: string, original: string, actorPolityId: string | null): OrderGoal[] {
  const namedForces = (text: string) => world.material.forces.filter((force) => {
    const name = normalizeName(force.name.split(/\s+of\s+/i)[0]!);
    return name.length > 4 && normalizeName(text).includes(name);
  });
  if (/\bkill\b/i.test(said) && !/\b(?:not|never|without|avoid)\s+(?:\w+\s+){0,2}kill(?:ing)?\b/i.test(said)) {
    const targets = namedForces(said);
    if (targets.length === 1) {
      const target = targets[0]!;
      return [{ kind: "force_killed", forceId: target.id, sinceStep: world.elapsedStep,
        minimumDeaths: Math.max(1, target.personnel.reduce((sum, row) => sum + row.fit + row.unavailable.reduce((n, group) => n + group.count, 0), 0)) }];
    }
  }
  if (actorPolityId !== null && /\b(?:claim|claiming|conquer|seize|capture)\b/i.test(said) && /\b(?:territory|land|provinces)\b/i.test(said)) {
    const targets = namedForces(said).length > 0 ? namedForces(said) : /\b(?:them|their)\b/i.test(said) ? namedForces(original) : [];
    const owners = [...new Set(targets.map((force) => force.polityId))];
    if (owners.length === 1 && owners[0] !== actorPolityId) {
      // Provinces the owner holds whole, and cities it holds in ground that is
      // somebody else's: a power that holds one city has territory too.
      const goals = world.map.provinces.flatMap((province): OrderGoal[] => province.controllerPolityId === owners[0]
        ? [{ kind: "control", provinceId: province.id, settlementId: null, polityId: actorPolityId }]
        : province.settlements.filter((city) => city.controllerPolityId === owners[0])
          .map((city): OrderGoal => ({ kind: "control", provinceId: province.id, settlementId: city.id, polityId: actorPolityId })));
      return goals.slice(0, 4);
    }
  }
  return [];
}

/**
 * Resolve an explicitly named settlement, including a small spelling mistake.
 *
 * `goingOnly` reads a text that is not the part's own -- the rest of the
 * order -- and there a name is a destination only when something is sent to
 * it: "the ships at Syracuse" in another part once sent a field army there.
 */
export function namedDestination(world: WorldState, text: string, goingOnly = false): string | null {
  const normalized = normalizeName(text);
  const words = normalized.split(/\s+/);
  // A name after "of" or "from" says where something is or comes from -- "the
  // garrison of Messana" -- not where it is going; nor does one after "hold"
  // or "leave": the men left to hold Messana are what stays behind.
  const origin = (name: string): boolean => {
    const at = normalized.indexOf(name);
    if (at < 0) return false;
    const before = normalized.slice(0, at).trim().split(/\s+/);
    const after = normalized.slice(at + name.length).trim().split(/\s+/)[0] ?? "";
    // "the Messana garrison" names the men, not a place to go.
    if (goingOnly && !GOING.has(before.at(-1) ?? "")) return true;
    return STAYING.has(before.at(-1) ?? "") || ADJECTIVAL.has(after);
  };
  const matches = world.map.provinces.flatMap((province) => province.settlements.filter((settlement) => {
    const name = normalizeName(settlement.name);
    if (name.length <= 3) return false;
    if (normalized.includes(name)) return !origin(name);
    return name.split(" ").length === 1 && words.some((word, index) => word.length > 3 && spelledAlike(word, name)
      && (goingOnly ? GOING.has(words[index - 1] ?? "") : !STAYING.has(words[index - 1] ?? "")));
  }).map(() => province.id));
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0]! : null;
}

/** The standing destination survives an order that says only "send it with them". */
export function missionDestination(world: WorldState, forceId: string, said: string, original: string, actorId: string): string | null {
  const explicit = namedDestination(world, said);
  if (explicit !== null) return explicit;
  if (!/\b(send|ferry|transport|cross|carry|sail)\b/i.test(said)) return null;
  // The rest of the order only where it sends something somewhere: a name it
  // mentions in passing belongs to another part.
  const inOrder = namedDestination(world, original, true);
  if (inOrder !== null) return inOrder;
  for (const order of [...world.orders].reverse()) {
    if (order.actorCharacterId !== actorId) continue;
    for (const part of order.parts) for (const goal of part.goals) if (goal.kind === "force_at" && goal.forceId === forceId && /ferry|transport|cross|carry|send/i.test(part.said)) return goal.provinceId;
  }
  return null;
}

export function preserveDestination(world: WorldState, delta: WorldDelta, said: string, original: string, actorId: string): WorldDelta {
  const movement = delta.op === "project_create" && delta.completionOutcome?.kind === "force_move" ? delta.completionOutcome : null;
  const forceId = movement?.forceRef ?? (delta.op === "force_modify" ? delta.forceRef : null);
  if (forceId == null) return delta;
  const destination = missionDestination(world, forceId, said, original, actorId);
  if (destination === null) return delta;
  // Explicitly described assembly/staging legs retain their own destination.
  if (/\b(stag|assembl|meet|embark|gather|march to).*\b(for|before|then)\b/i.test(delta.reason ?? "")) return delta;
  if (delta.op === "project_create" && movement !== null) return { ...delta, completionOutcome: { ...movement, provinceId: destination } };
  if (delta.op === "force_modify" && delta.locationId !== undefined) return { ...delta, locationId: destination };
  return delta;
}

export function missionGoals(world: WorldState, delta: WorldDelta, said: string, original: string, actorId: string): OrderGoal[] {
  const ref = delta.op === "project_create" && delta.completionOutcome?.kind === "force_move" ? delta.completionOutcome.forceRef : delta.op === "force_modify" ? delta.forceRef : null;
  if (ref === null || ref.startsWith("local:")) return [];
  const provinceId = missionDestination(world, ref, said, original, actorId);
  return provinceId === null ? [] : [{ kind: "force_at", forceId: ref, provinceId }];
}
