/**
 * The facts a model wrote only for acts the engine refused. "Hanno declared
 * war on Syracuse" stood in every man's history beside the order's own line,
 * "may not make war"; the part says it was refused, and the fact goes with the
 * act. A fact another part also cites, or a part with no act to refuse, stays.
 */
export function factsOfRefusedActs(
  parts: readonly { readonly acts: readonly number[]; readonly factLocalIds: readonly string[] }[],
  refusedActs: ReadonlySet<number>,
): ReadonlySet<string> {
  const refused = (part: (typeof parts)[number]): boolean => part.acts.length > 0 && part.acts.every((at) => refusedActs.has(at));
  const only = new Set(parts.filter(refused).flatMap((part) => part.factLocalIds));
  for (const part of parts) if (!refused(part)) for (const localId of part.factLocalIds) only.delete(localId);
  return only;
}
