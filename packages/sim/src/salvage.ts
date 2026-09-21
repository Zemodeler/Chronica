/**
 * Keeping the answer, and losing only the part of it the schema named.
 *
 * Both model-facing stages answer a rejected proposal the same way: send the
 * whole prompt again with the complaints appended, and wait for a second
 * full-price answer. That is the right move when the answer was wrong all
 * through. It is a bad one when the answer was twenty-four good acts and a
 * twenty-fifth with a misspelt enum, which is what a live burst actually
 * produced -- `deltas.15.kind: Invalid option`, and the other fifteen deltas
 * discarded with it.
 *
 * So before paying for a second call, drop exactly what Zod complained about
 * and try the answer again. The rule is the same one the output ceilings
 * already follow: the tail of a list is worth less than the list.
 *
 * Two moves, and deliberately only two:
 *
 *  - An unrecognised key is deleted. It is by definition not part of the
 *    contract, so nothing downstream could have read it and nothing is lost by
 *    its going.
 *  - Anything else drops the nearest enclosing *array element* -- the bad
 *    delta, the bad fact, the bad reference -- and never an object property.
 *    Deleting a property would quietly change what an act means, which is a
 *    different and much worse thing than losing it.
 *
 * An issue that sits inside no array at all cannot be salvaged this way, and
 * the model repair still happens. That is the intended division: this handles
 * a good answer with a bad line in it, and the repair handles a bad answer.
 */

/** As much of a Zod issue as this needs, so the schemas themselves stay out of it. */
export interface SchemaComplaint {
  readonly code?: string | undefined;
  readonly path: readonly PropertyKey[];
  readonly keys?: readonly string[] | undefined;
}

export interface Salvaged {
  readonly value: unknown;
  /** What was thrown away, in the schema's own terms, for the record. */
  readonly dropped: readonly string[];
}

/**
 * How much of one answer may be discarded before discarding it stops being a
 * salvage. Past this the answer is not a good one with a bad line in it, and
 * the model should be asked again rather than handed back a shredded version
 * of what it said.
 */
const MAX_REPAIRS = 12;

const show = (path: readonly PropertyKey[]): string => path.map(String).join(".");

function at(root: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[step];
  }
  return node;
}

export function salvageAgainst(value: unknown, complaints: readonly SchemaComplaint[]): Salvaged | null {
  if (typeof value !== "object" || value === null) return null;
  if (complaints.length === 0) return null;

  /** Container path → the indices in it that have to go. */
  const drops = new Map<string, { readonly path: readonly PropertyKey[]; readonly indices: Set<number> }>();
  const strips = new Map<string, { readonly path: readonly PropertyKey[]; readonly keys: Set<string> }>();

  for (const complaint of complaints) {
    if (complaint.code === "unrecognized_keys" && complaint.keys !== undefined && complaint.keys.length > 0) {
      const key = show(complaint.path);
      const existing = strips.get(key) ?? { path: complaint.path, keys: new Set<string>() };
      for (const unrecognized of complaint.keys) existing.keys.add(unrecognized);
      strips.set(key, existing);
      continue;
    }

    // The innermost array this sits in. Innermost on purpose: a bad reference
    // inside a fact should cost the reference, not the fact.
    let cut = -1;
    for (let index = complaint.path.length - 1; index >= 0; index -= 1) {
      if (typeof complaint.path[index] === "number") { cut = index; break; }
    }
    // Nothing here belongs to a list, so there is nothing to lose short of the
    // whole answer. Leave it to the repair.
    if (cut === -1) return null;

    const containerPath = complaint.path.slice(0, cut);
    const key = show(containerPath);
    const existing = drops.get(key) ?? { path: containerPath, indices: new Set<number>() };
    existing.indices.add(complaint.path[cut] as number);
    drops.set(key, existing);
  }

  // What is being removed outright, so a key is not also "stripped" from an
  // entry that is about to go: one bad delta draws several complaints -- a
  // wrong enum, the fields that were therefore missing, the ones left over --
  // and they all name the same line.
  const removed = new Set<string>();
  for (const drop of drops.values()) {
    for (const index of drop.indices) removed.add(show([...drop.path, index]));
  }

  const dropped = [...removed];
  for (const [key, strip] of strips) {
    if (removed.has(key)) continue;
    dropped.push(`${key}: ${[...strip.keys].join(", ")}`);
  }

  // The budget counts what is actually removed, not how loudly the schema
  // objected to it.
  if (dropped.length === 0 || dropped.length > MAX_REPAIRS) return null;

  const copy: unknown = structuredClone(value);

  for (const [key, strip] of strips) {
    if (removed.has(key)) continue;
    const target = at(copy, strip.path);
    if (typeof target !== "object" || target === null || Array.isArray(target)) continue;
    for (const unrecognized of strip.keys) delete (target as Record<string, unknown>)[unrecognized];
  }

  for (const drop of drops.values()) {
    const container = at(copy, drop.path);
    if (!Array.isArray(container)) continue;
    // Highest index first, so removing one does not move the next.
    for (const index of [...drop.indices].sort((a, b) => b - a)) {
      if (index >= 0 && index < container.length) container.splice(index, 1);
    }
  }

  return { value: copy, dropped };
}
