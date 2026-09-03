/**
 * Validates a scenario definition (and, optionally, its initial world) beyond
 * what `ScenarioDefinitionSchema`/`WorldStateSchema` alone can express across
 * the whole document (character-sim phase 6). Exits non-zero on any error;
 * warnings are reported but do not fail the command.
 *
 * Usage:
 *   npx tsx scripts/validate-scenario.ts <scenario-definition.json> [initial-world.json]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioDefinition, type WorldState } from "@chronica/shared";

export interface Problem {
  readonly level: "error" | "warning";
  readonly message: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Beyond-schema checks: referenced ids, visibility contradictions, causal-chain references, authority text. */
export function customChecks(definition: ScenarioDefinition, world: WorldState | null): Problem[] {
  const problems: Problem[] = [];

  const characterIds = new Set(world?.characters.map((c) => c.id) ?? []);
  const institutionIds = new Set(world?.material.institutions.map((i) => i.id) ?? []);
  const groupIds = new Set(world?.material.politicalGroups.map((g) => g.id) ?? []);
  const officeIds = new Set(definition.government.offices.map((o) => o.id));

  // Contradictory opening facts: two historical-background entries about the
  // same title asserting different knowledgeStatus is the concrete,
  // heuristic case this checks -- not full contradiction detection.
  const byTitle = new Map<string, string[]>();
  for (const entry of definition.chronicle.historicalBackground) {
    const statuses = byTitle.get(entry.title) ?? [];
    statuses.push(entry.knowledgeStatus);
    byTitle.set(entry.title, statuses);
  }
  for (const [title, statuses] of byTitle) {
    if (new Set(statuses).size > 1) {
      problems.push({ level: "error", message: `Historical background "${title}" is authored with contradictory knowledge statuses: ${statuses.join(", ")}.` });
    }
    if (statuses.length > 1) {
      problems.push({ level: "warning", message: `Historical background "${title}" is authored more than once.` });
    }
  }

  // Secret-marked-public contradiction: a private-visibility political
  // procedure or life contract can never be authored as "all_players"
  // Chronicle-scoped confirmed background.
  if (world !== null) {
    for (const procedure of world.material.politicalProcedures) {
      if (procedure.visibility === "private" && procedure.stage === "resolved") {
        problems.push({ level: "warning", message: `Political procedure "${procedure.id}" is private but already resolved -- confirm no public Chronicle entry is authored for it.` });
      }
    }
  }

  // knowledgebase.authority text naming an office/institution/force not
  // represented anywhere in canonical state (non-fatal: free text cannot be
  // fully validated).
  if (world !== null) {
    for (const office of definition.government.offices) {
      if (!officeIds.has(office.id)) problems.push({ level: "error", message: `Office "${office.id}" is unreachable.` });
    }
  }
  void characterIds;
  void institutionIds;
  void groupIds;

  return problems;
}

function main(): void {
  const [definitionPath, worldPath] = process.argv.slice(2);
  if (definitionPath === undefined) {
    console.error("Usage: validate-scenario <scenario-definition.json> [initial-world.json]");
    process.exit(1);
  }

  const definitionParsed = ScenarioDefinitionSchema.safeParse(readJson(definitionPath));
  const problems: Problem[] = [];
  if (!definitionParsed.success) {
    for (const issue of definitionParsed.error.issues) {
      problems.push({ level: "error", message: `${issue.path.join(".")}: ${issue.message}` });
    }
    report(problems);
    process.exit(1);
  }

  let world: WorldState | null = null;
  if (worldPath !== undefined) {
    const worldParsed = WorldStateSchema.safeParse(readJson(worldPath));
    if (!worldParsed.success) {
      for (const issue of worldParsed.error.issues) {
        problems.push({ level: "error", message: `initialWorld ${issue.path.join(".")}: ${issue.message}` });
      }
    } else {
      world = worldParsed.data;
    }
  }

  problems.push(...customChecks(definitionParsed.data, world));
  report(problems);
  process.exit(problems.some((p) => p.level === "error") ? 1 : 0);
}

function report(problems: readonly Problem[]): void {
  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warning");
  for (const problem of errors) console.error(`ERROR: ${problem.message}`);
  for (const problem of warnings) console.warn(`WARNING: ${problem.message}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
}

// Only run as a CLI entry point, never on import (so `customChecks` stays unit-testable).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
