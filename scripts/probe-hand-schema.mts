// Read-only probe: asks for an empty answer, never starts or changes a game.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { CognitionOutputSchema, OrchestratorOutputSchema, toProviderSchema, measureSchema } from "@chronica/shared";
import { prepareHandCodex, handCodexEnvironment, handCodexModel } from "../packages/ai/src/adapters/hand-codex";

await prepareHandCodex();
const runtime = path.resolve(process.env.CHRONICA_HAND_RUNTIME_DIR || ".cache/chronica-codex");
const dir = mkdtempSync(path.join(runtime, "probe-"));
try {
  for (const [name, zod, prompt] of [
    ["cognition", CognitionOutputSchema, 'Return {"actors":[]} and nothing else.'],
    ["orchestrate", OrchestratorOutputSchema, 'Return an empty simulation response with no facts, deltas or actors.'],
  ] as const) {
    const schema = toProviderSchema(zod);
    const schemaPath = path.join(dir, "schema.json");
    writeFileSync(schemaPath, JSON.stringify(schema));
    const started = performance.now();
    const result = await new Promise<{code: number | null; errors: string; events: string}>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(runtime, "node_modules/@openai/codex/bin/codex.js"),
        "exec", "--ignore-user-config", "-c", 'forced_login_method="chatgpt"',
        "-c", 'model_reasoning_effort="low"', "-c", 'web_search="disabled"',
        ...["shell_tool", "apps", "plugins", "hooks", "multi_agent", "browser_use", "computer_use", "image_generation", "workspace_dependencies"].flatMap(f => ["--disable", f]),
        "--cd", dir, "--model", handCodexModel(), "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
        "--output-schema", schemaPath, "--json", "-"], {env: handCodexEnvironment(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
      let errors = "", events = "";
      const timer = setTimeout(() => child.kill(), 90_000);
      child.stderr.on("data", chunk => {errors = (errors + chunk).slice(-12_000);});
      child.stdout.on("data", chunk => {events = (events + chunk).slice(-12_000);});
      child.on("error", reject);
      child.on("close", code => {clearTimeout(timer); resolve({code, errors, events});});
      child.stdin.end(prompt);
    });
    console.log(JSON.stringify({name, schema: measureSchema(schema), seconds: (performance.now()-started)/1000, ...result}));
  }
} finally {rmSync(dir, {recursive: true, force: true});}
