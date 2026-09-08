import { militaryWorkflows } from "./definitions/military";
import { politicalWorkflows } from "./definitions/political";
import { economicWorkflows } from "./definitions/economic";
import { characterWorkflows } from "./definitions/character";
import { narrativeWorkflows } from "./definitions/narrative";
import { mapWorkflows } from "./definitions/map";
import { characterAgencyWorkflows } from "./definitions/character-agency";
import { worldCreationWorkflows } from "./definitions/world-creation";
import { politicalProcedureWorkflows } from "./definitions/political-procedures";
import { familyWorkflows } from "./definitions/family";
import { materialWorkflows } from "./definitions/material";
import { battleResolutionWorkflows } from "./definitions/battle-resolution";
import { diplomacyWorkflows } from "./definitions/diplomacy";
import { npcAgencyWorkflows } from "./definitions/npc-agency";
import { playerMaterializationWorkflows } from "./definitions/player-materialization";
import { z } from "zod";
import type { AnyWorkflowDefinition } from "./types";

// Workflow registry (docs/14, ADR-0032).
//
// Every workflow the AI may invoke must be registered here. The executor
// validates proposals against this registry before any mutation runs.
// Adding a workflow: implement it in the appropriate definitions file,
// then add it to the export list below.

const allWorkflows: AnyWorkflowDefinition[] = [
  ...militaryWorkflows,
  ...politicalWorkflows,
  ...economicWorkflows,
  ...characterWorkflows,
  ...narrativeWorkflows,
  ...mapWorkflows,
  ...characterAgencyWorkflows,
  ...worldCreationWorkflows,
  ...politicalProcedureWorkflows,
  ...familyWorkflows,
  ...materialWorkflows,
  ...battleResolutionWorkflows,
  ...diplomacyWorkflows,
  ...npcAgencyWorkflows,
  ...playerMaterializationWorkflows,
];

/** Immutable registry map: actionId → WorkflowDefinition. */
export const WORKFLOW_REGISTRY: ReadonlyMap<string, AnyWorkflowDefinition> = new Map(
  allWorkflows.map((w) => [w.id, w]),
);

/** All registered workflow IDs, for inclusion in AI system prompts. */
export const WORKFLOW_IDS: readonly string[] = allWorkflows.map((w) => w.id);

/**
 * Legacy durations (docs/32, Phase 5) for a workflow that has not yet
 * declared its own `duration`. This is the single remaining copy of the flat
 * table `pipeline.ts` and `chronicle-from-facts.ts` used to keep as two
 * independent, silently-driftable copies -- new entries belong on the
 * workflow definition itself (`duration` on `WorkflowDefinition`), not here.
 */
const LEGACY_DURATION_DAYS: Record<string, number> = {
  add_gold: 1,
  remove_gold: 1,
  transfer_gold: 1,
  appoint_to_office: 2,
  remove_from_office: 2,
  raise_morale: 2,
  lower_morale: 2,
  move_character: 4,
  create_force: 7,
  move_force: 14,
  start_battle: 14,
  resolve_battle: 14,
  end_battle: 14,
  sign_treaty: 21,
  start_siege: 30,
  end_siege: 30,
  start_war: 45,
  end_war: 45,
  give_territory: 45,
  change_province_control: 45,
};

/** A workflow with no declared duration and no legacy entry defaults to this -- unchanged from both prior flat tables. */
const DEFAULT_DURATION_DAYS = 7;

/**
 * The single duration estimator both the pipeline's Chronicle scheduling and
 * `chronicle-from-facts.ts`'s per-entry duration now share, instead of two
 * independently maintained copies of the same table. Takes the maximum
 * across every named action, since one player order can require several
 * (docs/14's `workflows` array on an order assessment).
 */
export function estimateWorkflowDurationDays(actionIds: readonly string[]): number {
  return Math.max(1, ...actionIds.map((actionId) => WORKFLOW_REGISTRY.get(actionId)?.duration?.likelyDays ?? LEGACY_DURATION_DAYS[actionId] ?? DEFAULT_DURATION_DAYS));
}

/**
 * Compact registry description for injection into AI prompts.
 * Each entry includes authority and scope metadata so the Workflow Manager
 * knows which invokers may use each skill.
 */
export function buildWorkflowCatalog(): string {
  const lines: string[] = [
    "Available workflow skills (invoke by exact id and parameter names shown):",
    "Authority key — [P]=player [W]=world_director [C]=character_director [S]=system",
    "Scope key (world_director only) — near|far|coarse (coarse = any tier)",
  ];
  for (const category of ["military", "political", "economic", "material", "character", "narrative", "map"] as const) {
    lines.push(`\n[${category.toUpperCase()}]`);
    for (const w of allWorkflows.filter((x) => x.category === category)) {
      const shape = w.parametersSchema instanceof z.ZodObject ? w.parametersSchema.shape : undefined;
      const paramKeys = shape ? Object.keys(shape).join(", ") : "";
      const paramHint = paramKeys ? ` | params: ${paramKeys}` : "";
      const authorityMap: Record<string, string> = {
        player: "P",
        world_director: "W",
        character_director: "C",
        system: "S",
      };
      const authHint = w.invokerAuthority
        ? ` | authority: ${w.invokerAuthority.map((a) => authorityMap[a] ?? a).join("")}`
        : "";
      const scopeHint = w.scopeLimit ? ` | scope≤${w.scopeLimit}` : "";
      lines.push(`  ${w.id}: ${w.description}${paramHint}${authHint}${scopeHint}`);
    }
  }
  return lines.join("\n");
}
