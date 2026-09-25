import type { OrderPartyRef, WorldState } from "@chronica/shared";
import { salvageAgainst, type SchemaComplaint } from "./salvage";

/**
 * A reference written as the bare id, put into the shape the schema wants.
 *
 * `{ "kind": "character", "id": "marcus-metellus" }` is what a fact's
 * `affectedRefs` hold; `"marcus-metellus"` is what a model writes about a
 * third of the time. It knows which thing it means, and the engine knows what
 * kind of thing that is. Before this, each one was a schema complaint, a long
 * answer gathered dozens of them, salvage gave up past its limit, and the
 * whole answer was thrown away: in a live run, three orders in seven -- a
 * loan, a ship, a Greek tutor -- came back as nothing at all, over the
 * spelling of references whose meaning was never in doubt.
 *
 * And the other way about: `{ kind, id }` where the schema wanted the id
 * alone is the id.
 *
 * Only where the schema asked for an object and got a string, and only for an
 * id the world (or this answer, by its handle) actually has. Anything else is
 * left for salvage to drop, exactly as before.
 */

export type KindOf = (id: string) => OrderPartyRef["kind"] | null;

/** What each id in the world is, for wrapping. */
export function kindsIn(world: WorldState): KindOf {
  const kinds = new Map<string, OrderPartyRef["kind"]>();
  const add = (kind: OrderPartyRef["kind"], ids: readonly { readonly id: string }[]) => {
    for (const { id } of ids) if (!kinds.has(id)) kinds.set(id, kind);
  };
  add("character", world.characters);
  add("polity", world.map.polities);
  add("province", world.map.provinces);
  add("settlement", world.map.provinces.flatMap((province) => province.settlements));
  add("force", world.material.forces);
  add("account", world.material.accounts);
  add("institution", world.material.institutions);
  add("office", world.offices);
  add("project", world.projects);
  add("storyline", world.storylines);
  return (id) => kinds.get(id) ?? null;
}

/** The kind of thing an act makes, for a handle this answer minted. */
const MADE_BY: Readonly<Record<string, OrderPartyRef["kind"]>> = {
  character_create: "character",
  force_create: "force",
  project_create: "project",
  storyline_open: "storyline",
  political_procedure_open: "procedure",
  polity_create: "polity",
};

/** Handles minted anywhere in this answer, by what minted them. */
function handlesIn(value: unknown, found: Map<string, OrderPartyRef["kind"]> = new Map()): Map<string, OrderPartyRef["kind"]> {
  if (Array.isArray(value)) {
    for (const item of value) handlesIn(item, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const kind = typeof record.op === "string" ? MADE_BY[record.op] : undefined;
    if (kind !== undefined && typeof record.localId === "string") found.set(`local:${record.localId}`, kind);
    for (const child of Object.values(record)) handlesIn(child, found);
  }
  return found;
}

/** Returns the answer with every bare id it could place wrapped, or null if there were none. */
export function wrapBareRefs(value: unknown, complaints: readonly (SchemaComplaint & { readonly expected?: unknown })[], kindOf: KindOf): { readonly value: unknown; readonly wrapped: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const candidates = complaints.filter((complaint) => complaint.code === "invalid_type" && (complaint.expected === "object" || complaint.expected === "string") && complaint.path.length > 0);
  if (candidates.length === 0) return null;
  const handles = handlesIn(value);
  const copy = structuredClone(value) as Record<PropertyKey, unknown>;
  let wrapped = 0;
  for (const complaint of candidates) {
    let parent: unknown = copy;
    for (const step of complaint.path.slice(0, -1)) {
      parent = typeof parent === "object" && parent !== null ? (parent as Record<PropertyKey, unknown>)[step] : undefined;
    }
    if (typeof parent !== "object" || parent === null) continue;
    const key = complaint.path[complaint.path.length - 1]!;
    const written = (parent as Record<PropertyKey, unknown>)[key];
    // The other way about: `{ kind, id }` where only the id was wanted.
    if (complaint.expected === "string") {
      const id = typeof written === "object" && written !== null ? (written as { id?: unknown }).id : undefined;
      if (typeof id === "string" && id.trim().length > 0) {
        (parent as Record<PropertyKey, unknown>)[key] = id.trim();
        wrapped += 1;
      }
      continue;
    }
    if (typeof written !== "string") continue;
    const id = written.trim();
    const kind = handles.get(id) ?? kindOf(id);
    if (kind === null || kind === undefined) continue;
    (parent as Record<PropertyKey, unknown>)[key] = { kind, id };
    wrapped += 1;
  }
  return wrapped === 0 ? null : { value: copy, wrapped };
}

/**
 * Parse an answer, putting right what can be put right and dropping only what
 * cannot, in rounds: dropping one bad element can expose another (a list left
 * empty, a handle to something just dropped), and one pass left a whole
 * answer lost to the second complaint. Three rounds, then the repair call.
 *
 * On failure the *first* complaints are returned, which are the ones worth
 * telling the model about.
 */
export function readLeniently<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly (SchemaComplaint & { readonly message: string; readonly expected?: unknown })[] } } },
  value: unknown,
  kindOf: KindOf,
): { readonly parsed: ReturnType<typeof schema.safeParse>; readonly dropped: readonly string[] } {
  const first = schema.safeParse(value);
  if (first.success) return { parsed: first, dropped: [] };
  let current = value;
  let parsed: ReturnType<typeof schema.safeParse> = first;
  const dropped: string[] = [];
  for (let round = 0; round < 3 && !parsed.success; round += 1) {
    const wrapped = wrapBareRefs(current, parsed.error.issues, kindOf);
    if (wrapped !== null) {
      current = wrapped.value;
      parsed = schema.safeParse(current);
      if (parsed.success) break;
    }
    const rescued = salvageAgainst(current, parsed.error.issues);
    if (rescued === null) break;
    current = rescued.value;
    dropped.push(...rescued.dropped);
    parsed = schema.safeParse(current);
  }
  return parsed.success ? { parsed, dropped } : { parsed: first, dropped: [] };
}
