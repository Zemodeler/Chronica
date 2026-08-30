import { militaryWorkflows } from "./definitions/military";
import { politicalWorkflows } from "./definitions/political";
import { economicWorkflows } from "./definitions/economic";
import { characterWorkflows } from "./definitions/character";
import { narrativeWorkflows } from "./definitions/narrative";
import { mapWorkflows } from "./definitions/map";
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
];

/** Immutable registry map: actionId → WorkflowDefinition. */
export const WORKFLOW_REGISTRY: ReadonlyMap<string, AnyWorkflowDefinition> = new Map(
  allWorkflows.map((w) => [w.id, w]),
);

/** All registered workflow IDs, for inclusion in AI system prompts. */
export const WORKFLOW_IDS: readonly string[] = allWorkflows.map((w) => w.id);

/** Compact registry description for injection into AI prompts. */
export function buildWorkflowCatalog(): string {
  const lines: string[] = ["Available workflow actions (use the exact id in your proposal):"];
  for (const category of ["military", "political", "economic", "character", "narrative", "map"] as const) {
    lines.push(`\n[${category.toUpperCase()}]`);
    for (const w of allWorkflows.filter((x) => x.category === category)) {
      lines.push(`  ${w.id}: ${w.description}`);
    }
  }
  return lines.join("\n");
}
