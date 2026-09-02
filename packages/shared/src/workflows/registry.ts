import { militaryWorkflows } from "./definitions/military";
import { politicalWorkflows } from "./definitions/political";
import { economicWorkflows } from "./definitions/economic";
import { characterWorkflows } from "./definitions/character";
import { narrativeWorkflows } from "./definitions/narrative";
import { mapWorkflows } from "./definitions/map";
import { characterAgencyWorkflows } from "./definitions/character-agency";
import { worldCreationWorkflows } from "./definitions/world-creation";
import { z } from "zod";
import type { AnyWorkflowDefinition } from "./types";
import type { RuntimeInventedWorkflow } from "./invented-workflow";

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
];

/** Immutable registry map: actionId → WorkflowDefinition. */
export const WORKFLOW_REGISTRY: ReadonlyMap<string, AnyWorkflowDefinition> = new Map(
  allWorkflows.map((w) => [w.id, w]),
);

/** All registered workflow IDs, for inclusion in AI system prompts. */
export const WORKFLOW_IDS: readonly string[] = allWorkflows.map((w) => w.id);

/**
 * Compact registry description for injection into AI prompts.
 * Each entry includes authority and scope metadata so the Workflow Manager
 * knows which invokers may use each skill.
 */
export function buildWorkflowCatalog(inventedWorkflows: readonly RuntimeInventedWorkflow[] = []): string {
  const lines: string[] = [
    "Available workflow skills (invoke by exact id and parameter names shown):",
    "Authority key — [P]=player [W]=world_director [C]=character_director [S]=system",
    "Scope key (world_director only) — near|far|coarse (coarse = any tier)",
  ];
  for (const category of ["military", "political", "economic", "character", "narrative", "map"] as const) {
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
  if (inventedWorkflows.length > 0) {
    lines.push("\n[INVENTED — game-local]");
    for (const workflow of inventedWorkflows.filter((workflow) => workflow.status === "active")) {
      const parameters = workflow.definition.parameters.map((parameter) => parameter.name).join(", ");
      lines.push(`  ${workflow.definition.actionId}: ${workflow.definition.description} | params: ${parameters} | authority: ${workflow.definition.invokerAuthority.join(",")}`);
    }
  }
  return lines.join("\n");
}
