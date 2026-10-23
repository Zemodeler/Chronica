// Replays saved prompts without changing a game or provider selection.
// API requests require explicit --api; CLI requests use the existing ChatGPT login.
// node --env-file=apps/web/.env.local --import tsx scripts/benchmark-hand.mts --api
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "../packages/ai/node_modules/openai/index.mjs";
import { ChronicleOutputSchema, CognitionOutputSchema, OrchestratorOutputSchema, restoreDefaults, type AiOperation } from "@chronica/shared";
import { answerWithHandCodex, handCodexInstructions, providerSchemaFor } from "../packages/ai/src/adapters/hand-codex";
import { createOpenAiLocalAdapter } from "../packages/ai/src/adapters/openai-local";

const args = process.argv.slice(2);
const flag = (name: string) => {const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1];};
const dir = path.resolve(process.env.CHRONICA_HAND_DIR || "eval-out/hand-web");
const model = flag("--model") || "gpt-6-luna";
const apiModel = flag("--api-model") || model;
const effort = flag("--effort") || "low";
if (!["low", "medium", "high"].includes(effort)) throw new Error("Effort must be low, medium or high.");
const selected = flag("--stem") || "simulate_orchestrate-55f49a118f29bb5e";
const synthetic = args.includes("--synthetic") || args.includes("--synthetic-cognition");
const operation = args.includes("--synthetic-cognition") ? "simulate_cognition" : synthetic ? "compose_chronicle" : selected.slice(0, selected.lastIndexOf("-")) as AiOperation;
const validator = operation === "compose_chronicle" ? ChronicleOutputSchema : operation === "simulate_orchestrate" ? OrchestratorOutputSchema : operation === "simulate_cognition" ? CognitionOutputSchema : undefined;
if (!validator) throw new Error("Choose an orchestration or cognition prompt.");
const cognitionSystem = "You are two fictional people in ancient Rome, deciding separately from their own knowledge. Return one actors entry per person with actorRef and proposal. Make no immediate world changes; each person makes a short plan of one step. Use only the supplied ids.";
const cognitionAsked = 'Marcus (actorRef={"kind":"character","id":"marcus"}) is a senator who wants to befriend the consul. He knows the consul is organizing a public feast. Julia (actorRef={"kind":"character","id":"julia"}) is a grain merchant who wants to know whether prices are rising. She knows only that a ship of grain arrived yesterday.';
const system = synthetic ? operation === "simulate_cognition" ? cognitionSystem : 'Write one brief chronicle entry numbered 1 describing the supplied event. No dialogue. Return JSON with entries, each having thread, title, body and optional quote.' : readFileSync(path.join(dir, `${selected}.system.txt`), "utf8");
const asked = synthetic ? operation === "simulate_cognition" ? cognitionAsked : "A Roman messenger arrived in Rome, handed a sealed letter to the consul, and departed." : readFileSync(path.join(dir, `${selected}.prompt.txt`), "utf8");
const schema = providerSchemaFor(operation)!;
const out = path.resolve("eval-out/hand-speed");
mkdirSync(out, {recursive: true});
const results: Record<string, unknown>[] = [];
for (const provider of args.includes("--api") ? ["api", "cli"] : ["cli"]) {
  const started = performance.now();
  const requestModel = provider === "api" ? apiModel : model;
  try {
    let value: unknown, usage: unknown, providerModel: string | undefined;
    if (provider === "api" && args.includes("--adapter")) {
      process.env[`CHRONICA_AI_MODEL_${operation.toUpperCase()}`] = requestModel;
      process.env[`CHRONICA_AI_EFFORT_${operation.toUpperCase()}`] = effort;
      const result = await createOpenAiLocalAdapter().call(operation, system, asked);
      value = JSON.parse(result.content);
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cacheReadTokens: result.cacheReadTokens };
      providerModel = result.model;
    } else if (provider === "api") {
      const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 150_000});
      const result = await client.responses.create({model: requestModel, instructions: handCodexInstructions(system, true), input: asked,
        reasoning: {effort: effort as "low"}, max_output_tokens: 8_000,
        text: {format: {type: "json_schema", name: "chronica", strict: true, schema}}});
      value = restoreDefaults(validator, JSON.parse(result.output_text));
      usage = result.usage;
      providerModel = result.model;
    } else {
      value = JSON.parse(await answerWithHandCodex(system, asked, path.join(out, `probe-${Date.now()}.json`), {operation, model, effort: effort as "low"}));
    }
    const valid = validator.safeParse(value);
    const row = {provider, model: requestModel, effort, operation, seconds: +( (performance.now()-started)/1000).toFixed(2), parsed: valid.success,
      ...(valid.success ? {} : {issues: valid.error.issues.slice(0, 3)}), usage, providerModel, synthetic};
    results.push(row);
    writeFileSync(path.join(out, `${provider}-${operation}-${effort}.json`), JSON.stringify(value, null, 2));
    console.log(JSON.stringify(row));
  } catch (error) {
    // Do not serialize SDK errors: they can contain request headers.
    const row = {provider, model: requestModel, effort, operation, seconds: +((performance.now()-started)/1000).toFixed(2), failed: true,
      status: (error as {status?: number}).status, code: (error as {code?: string}).code, kind: (error as Error).name};
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(path.join(out, `timings-${operation}-${effort}-${Date.now()}.json`), JSON.stringify(results, null, 2));
