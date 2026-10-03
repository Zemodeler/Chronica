import type { OrchestratorOutput, WorldDelta } from "@chronica/shared";

/** A part of the order as the orchestrator read it. */
export type IntentPart = OrchestratorOutput["intent"]["parts"][number];

/** A part taken out of the order, and why. */
export interface RefiledPart {
  readonly part: IntentPart;
  readonly why: string;
}

/** Words every order is made of, which tell nothing about what it is for. */
const FILLER = new Set(["that", "this", "with", "from", "into", "have", "make", "sure", "them", "they", "their", "there", "will", "shall", "would", "could", "should", "about", "which", "when", "then", "than", "only", "does", "tell", "send", "order", "ordered", "world", "own"]);

/** Words to compare by: lower case, five-letter stems, the small words left out. */
function stems(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 4 && !FILLER.has(word)).map((word) => word.slice(0, 5)));
}

/**
 * Whether a part's words are those of a text: two stems in common, or one
 * long word -- the test `partOfAct` places an act in a part by.
 */
export function saysWhatWasSaid(said: string, text: string): boolean {
  const ours = stems(said);
  const shared = [...stems(text)].filter((stem) => ours.has(stem));
  return shared.length >= 2 || (shared.length === 1 && said.toLowerCase().split(/[^\p{L}]+/u).some((word) => word.length >= 6 && word.startsWith(shared[0]!)));
}

/**
 * The parts of an order that are the player's, and the ones that are not.
 *
 * The orchestrator is asked, in the same answer, to carry out the order and to
 * do the world's business -- people the empty countries, make the season's
 * stirrings happen, settle what falls due -- and it wrote some of that
 * business as parts of the order: "Give the Umbrians their own ruler" and
 * "Resolve the world's price movement in Vaspurakan" stood in a legionary's
 * ledger as orders he had given and nothing had come of. The acts were
 * already refiled as the world's (`misfiledWorldActs`); nothing did the same
 * for the parts.
 *
 * A part goes when every act it names is the world's, or when it names no act
 * of the order's own, holds nothing for later, wants nothing the world can be
 * read for and spends nothing -- and either its words are not the order's, or
 * they are the world's business the slice put to the orchestrator.
 *
 * `index` maps a kept part's old place to its new one, for `afterParts` and
 * delegations that name parts by place.
 */
export function theOrdersOwnParts(
  parts: readonly IntentPart[],
  context: {
    readonly orderText: string;
    readonly deltas: readonly WorldDelta[];
    readonly misfiled: ReadonlySet<number>;
    /** What the slice asked the orchestrator to do beside the order: seeds, what falls due. */
    readonly worldBusiness: readonly string[];
    /** The powers the slice listed as holding land with nobody in them. */
    readonly emptyPowers: readonly string[];
  },
): { readonly kept: IntentPart[]; readonly refiled: RefiledPart[]; readonly index: ReadonlyMap<number, number> } {
  const refiled: RefiledPart[] = [];
  const keptAt: number[] = [];
  for (const [at, part] of parts.entries()) {
    const named = part.acts.filter((index) => context.deltas[index] !== undefined);
    const own = named.filter((index) => !context.misfiled.has(index));
    if (named.length > 0 && own.length === 0) {
      refiled.push({ part, why: "every act it named was the world's own business, beside the order" });
      continue;
    }
    // Held for later -- "when a punitive force is raised, send it" -- is the
    // order's own structure, whatever words it was put in.
    const heldForLater = (part.deferredActs ?? []).length > 0 || (part.afterParts ?? []).length > 0 || part.whenForceExists != null;
    const bare = own.length === 0 && !heldForLater && part.goals.length === 0 && part.spend === null;
    if (bare) {
      const ours = stems(part.said);
      const emptyPower = context.emptyPowers.find((name) => [...stems(name)].some((stem) => ours.has(stem)));
      const business = context.worldBusiness.find((text) => saysWhatWasSaid(part.said, text));
      if (emptyPower !== undefined) {
        refiled.push({ part, why: `it gives ${emptyPower} what the world was asked to give it, not anything the order asked for` });
        continue;
      }
      if (business !== undefined && !saysWhatWasSaid(part.said, context.orderText)) {
        refiled.push({ part, why: `it is the world's business ("${business.slice(0, 80)}"), not the order's` });
        continue;
      }
      if (!saysWhatWasSaid(part.said, context.orderText)) {
        refiled.push({ part, why: "it wrote no act of the order's, and its words are not the order's" });
        continue;
      }
    }
    keptAt.push(at);
  }
  const index = new Map(keptAt.map((old, now) => [old, now]));
  const kept = keptAt.map((old) => {
    const part = parts[old]!;
    if (part.afterParts === undefined) return part;
    return { ...part, afterParts: part.afterParts.flatMap((at) => index.has(at) ? [index.get(at)!] : []) };
  });
  return { kept, refiled, index };
}
