import { WorldStateSchema, type WorldState } from "@chronica/shared";

/**
 * Words that ran past the room a record has for them.
 *
 * A promise's wording was pasted into a grievance's label, which holds two
 * hundred characters: a four-hundred-character instruction made every tick
 * after it write a world that would not load, and each was set aside, and the
 * days went on with nothing ticking. A string too long for its field is cut to
 * fit rather than costing the world its day. Only a string is mended, and only
 * when that is the whole of what is wrong: anything else is left to be refused,
 * loudly.
 */
export function clipOverlong(world: WorldState): { readonly world: WorldState; readonly clipped: readonly string[] } | null {
  let current: unknown = world;
  const clipped: string[] = [];
  let copy = false;
  for (let round = 0; round < 6; round += 1) {
    const parsed = WorldStateSchema.safeParse(current);
    if (parsed.success) return clipped.length === 0 ? null : { world: parsed.data, clipped };
    const tooLong = parsed.error.issues.filter((issue) => issue.code === "too_big" && (issue as { origin?: string }).origin === "string");
    if (tooLong.length !== parsed.error.issues.length) return null;
    if (!copy) { current = structuredClone(current); copy = true; }
    for (const issue of tooLong) {
      const maximum = Number((issue as { maximum?: number | bigint }).maximum);
      let holder = current as Record<string | number, unknown> | null | undefined;
      for (const key of issue.path.slice(0, -1)) holder = holder?.[key as string | number] as Record<string | number, unknown> | null | undefined;
      const last = issue.path[issue.path.length - 1] as string | number | undefined;
      if (holder === undefined || holder === null || last === undefined || typeof holder[last] !== "string" || !Number.isFinite(maximum)) return null;
      const text = holder[last];
      holder[last] = `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`.slice(0, maximum);
      clipped.push(issue.path.map(String).join("."));
    }
  }
  return null;
}
