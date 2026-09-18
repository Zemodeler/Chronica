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
