/**
 * The one lenient JSON reader every model-facing stage shares.
 *
 * A model that wrapped its answer in prose or a code fence still gave a usable
 * object, and failing the whole burst over a stray "Here you go:" is a bad
 * trade. Three stages needed exactly this and each had grown its own copy.
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in the response");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/**
 * Drops list entries that are not objects, leaving the rest of the list alone.
 *
 * Every one of these lists is a list of records -- deltas, facts, delegations,
 * scheduled events. A model that writes a bare sentence where a record belongs
 * has produced something that could never be applied whatever we do with it,
 * and the schema is strict, so its one stray line took the other twenty acts
 * down with it. Measured over a live burst, this and its sibling below were
 * behind four of ten cognition calls: every round paid for a second full-price
 * call, on a prompt that was never wrong, to be told the same twenty acts a
 * second time.
 *
 * Dropping the entry rather than the answer is the same trade the output caps
 * already make: the model puts the real work first, and losing the malformed
 * line is a far smaller loss than losing the list.
 */
export function dropMalformedEntries(value: unknown, keys: readonly string[]): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  for (const key of keys) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry));
    if (kept.length !== list.length) record[key] = kept;
  }
  return record;
}
