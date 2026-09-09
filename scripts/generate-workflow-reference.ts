import { writeFileSync } from "node:fs";
import { z } from "zod";
import { WORKFLOW_REGISTRY } from "../packages/shared/src/workflows/registry";
import { commandKindOf, type AnyWorkflowDefinition } from "../packages/shared/src/workflows/types";

const destination = new URL("../docs/workflows.md", import.meta.url);

function schemaType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (typeof schema.type === "string") return schema.type;
  if ("$ref" in schema) return "value";
  return "value";
}

function parametersFor(workflow: AnyWorkflowDefinition): string[] {
  const schema = z.toJSONSchema(workflow.parametersSchema as z.ZodTypeAny, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  const names = Object.keys(properties);
  if (names.length === 0) return ["- No parameters."];
  return names.map((name) => {
    const property = properties[name]!;
    const description = typeof property.description === "string" ? ` — ${property.description}` : "";
    return `- \`${name}\` (${schemaType(property)}, ${required.has(name) ? "required" : "optional"})${description}`;
  });
}

function workflowSection(workflow: AnyWorkflowDefinition): string[] {
  const authority = workflow.invokerAuthority?.join(", ") ?? "any AI principal";
  const duration = workflow.duration
    ? `${workflow.duration.minimumDays}–${workflow.duration.maximumDays} days (usually ${workflow.duration.likelyDays})`
    : "uses the registry default estimate";
  return [
    `### \`${workflow.id}\``,
    "",
    workflow.description,
    "",
    `- Category: ${workflow.category}`,
    `- Available to: ${authority}`,
    `- Kind: ${commandKindOf(workflow) === "system_effect" ? "system data operation" : "AI data interaction"}`,
    `- Duration: ${duration}`,
    "",
    "Parameters:",
    "",
    ...parametersFor(workflow),
    "",
  ];
}

const workflows = [...WORKFLOW_REGISTRY.values()];
const categories = [...new Set(workflows.map((workflow) => workflow.category))];
const lines = [
  "# Chronica workflow reference",
  "",
  "> Generated from the workflow registry by `npm exec tsx scripts/generate-workflow-reference.ts`. Do not edit the per-workflow entries by hand.",
  "",
  "## What a workflow is",
  "",
  "A workflow is an MCP-style tool the AI uses to interact with Chronica's world data. It is not a story script or a fixed player verb. A workflow exposes a data capability and its input contract; the AI decides whether calling it is useful in the current situation. The workflow then performs a validated change or calculation.",
  "",
  "Built-in workflows cover common world interactions. If none fits, the AI can use `define_action` to create a named, reusable campaign-local workflow. A defined workflow is a parameterised set of data operations and is checked before use: its parameters must be valid, the actor must be living, protected world fields cannot be changed, and the complete resulting world must pass schema and reference-integrity validation. It is then stored for later turns in that campaign and each use is audited.",
  "",
  "`request_capability` remains for a need that cannot honestly be expressed as a world-data interaction; it records that need without changing the world.",
  "",
  "## Built-in workflows",
  "",
  `There are ${workflows.length} built-in workflows in this reference. Every AI-callable workflow also receives an \`actorId\` identifying the living character making the interaction; that envelope field is not repeated below.`,
  "",
];

for (const category of categories) {
  lines.push(`## ${category[0]!.toUpperCase()}${category.slice(1)} workflows`, "");
  for (const workflow of workflows.filter((entry) => entry.category === category).sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(...workflowSection(workflow));
  }
}

writeFileSync(destination, `${lines.join("\n")}\n`, "utf8");
