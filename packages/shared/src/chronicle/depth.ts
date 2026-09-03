import { z } from "zod";

// Chronicle depth tiers (docs/14 Phase 4).
//
// Every Chronicle-producing stream (player directives, reactions, the
// simulator, political procedures, life events, battles) already tags each
// entry with a `playerRelevance` and whether it changed material state.
// Before this, every entry was narrated as exactly one paragraph regardless
// of either signal -- a distant, consequence-free rumor and the player's own
// decisive battle got the same treatment. `deriveChronicleDepth` is the one
// shared policy every stream now goes through, so "how much space does this
// event deserve" has a single, consistent answer independent of which
// director produced it -- the concrete, Chronicle-facing piece of unifying
// the three separate level-of-detail schemes (Simulator scope tiers,
// Reaction Director geographic adjacency, Character Director continuity
// tiers) the redesign calls out; those three internal schemes still decide
// *whether* an event is generated at all, which is a larger follow-on unification.

export const ChronicleDepthSchema = z.enum(["dispatch", "paragraph", "scene"]);
export type ChronicleDepth = z.infer<typeof ChronicleDepthSchema>;

export interface ChronicleDepthInput {
  readonly playerRelevance: "high" | "medium" | "low" | "none" | undefined;
  readonly materialConsequence: boolean;
  readonly isPlayerAction: boolean;
  /** A hint from the caller that this is inherently major regardless of relevance scoring (e.g. a resolved battle). */
  readonly isMajorEvent?: boolean;
}

/**
 * Minor distant event -> compact dispatch. Relevant local event -> a real
 * paragraph. Major player-facing event -> a multi-paragraph scene. Matches
 * the redesign brief's three depth tiers exactly.
 */
export function deriveChronicleDepth(input: ChronicleDepthInput): ChronicleDepth {
  if (input.isPlayerAction || input.isMajorEvent === true || input.playerRelevance === "high") return "scene";
  if (input.playerRelevance === "medium" || (input.materialConsequence && input.playerRelevance !== "none")) return "paragraph";
  return "dispatch";
}

export interface WordBudget {
  readonly min: number;
  readonly max: number;
}

const WORD_BUDGETS: Record<ChronicleDepth, WordBudget> = {
  dispatch: { min: 8, max: 40 },
  paragraph: { min: 50, max: 180 },
  scene: { min: 150, max: 450 },
};

export function chronicleWordBudget(depth: ChronicleDepth): WordBudget {
  return WORD_BUDGETS[depth];
}
