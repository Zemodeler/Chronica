import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { AiTimeoutError, type AiOperation } from "@chronica/shared";
import { getSelectedLocalAiModel, type LocalAiEffort } from "../local-key-selection";
import { answerGameRequest, gameEffortFor, gameInstructions, gameSchemaFor, readNearlyJson } from "../game-request";
export { readNearlyJson } from "../game-request";

const CLI_VERSION = "0.160.0";
const DEFAULT_TIMEOUT_MS = 600_000;
const inFlight = new Map<string, Promise<string>>();
let preparing: Promise<void> | undefined;
let selectedAuthHome: string | undefined;

export function handCodexModel(): string {
  return getSelectedLocalAiModel("codex") || process.env.CHRONICA_HAND_MODEL?.trim() || "gpt-6-luna";
}

/**
 * The effort one call is asked at: `CHRONICA_AI_EFFORT_<OPERATION>` for that
 * operation, else the account screen's choice, else `CHRONICA_HAND_EFFORT`,
 * else low.
 */
export function handCodexEffort(operation?: AiOperation): LocalAiEffort {
  return gameEffortFor(operation);
}

export const providerSchemaFor = gameSchemaFor;

/** Part of the answer cache's key: a change of model, effort or answer format is a different answer. */
export function handCodexCacheNamespace(operation: AiOperation, model = handCodexModel()): string {
  return `codex-v4:${model}:${handCodexEffort(operation)}:${providerSchemaFor(operation) === undefined ? "json" : "schema"}`;
}

export const handCodexInstructions = gameInstructions;

function runtimeDir(): string {
  return path.resolve(process.env.CHRONICA_HAND_RUNTIME_DIR || ".cache/chronica-codex");
}

function timeoutMs(): number {
  const configured = Number(process.env.CHRONICA_HAND_CODEX_TIMEOUT_MS ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

/** Force subscription authentication even when reusing an existing CLI login. */
export function handCodexEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: selectedAuthHome ?? path.join(runtimeDir(), "auth") };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "CODEX_ACCESS_TOKEN"]) delete env[key];
  return env;
}

function cliPath(): string {
  return path.join(runtimeDir(), "node_modules/@openai/codex/bin/codex.js");
}

class CodexTimedOut extends Error {}

function run(command: string, args: string[], options: { input?: string; interactive?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? handCodexEnvironment(),
      cwd: runtimeDir(),
      stdio: options.interactive ? "inherit" : ["pipe", "pipe", "pipe"],
      windowsHide: !options.interactive,
    });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16_000); };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.stdin?.on("error", () => { /* A failed process can close stdin before the prompt is sent. */ });
    child.stdin?.end(options.input ?? "");
    const timer = setTimeout(() => {
      child.kill();
      reject(new CodexTimedOut("Codex hand responder timed out. Check your connection and subscription allowance, then retry."));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

async function prepare(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Automatic hand mode is available only on a local development server.");
  mkdirSync(runtimeDir(), { recursive: true });
  mkdirSync(path.join(runtimeDir(), "auth"), { recursive: true, mode: 0o700 });
  const version = existsSync(cliPath()) ? await run(process.execPath, [cliPath(), "--version"]) : undefined;
  const installed = version?.code === 0 && version.output.split(/\r?\n/).some((line) => line.trim() === `codex-cli ${CLI_VERSION}`);
  if (!installed) {
    console.log(`[hand] Installing Codex CLI ${CLI_VERSION} automatically…`);
    // npm supplies this path to workspace scripts on Windows as well as Unix.
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    const installation = await run(process.platform === "win32" || process.env.npm_execpath ? process.execPath : "npm",
      [...(process.platform === "win32" || process.env.npm_execpath ? [npmCli] : []), "install", "--prefix", runtimeDir(), "--no-audit", "--no-fund", `@openai/codex@${CLI_VERSION}`],
      { interactive: true });
    if (installation.code !== 0 || !existsSync(cliPath())) throw new Error("Automatic Codex installation failed. Check your internet connection and restart Chronica.");
    if ((await run(process.execPath, [cliPath(), "--version"])).code !== 0) throw new Error("The downloaded Codex CLI cannot run on this computer. Check that its platform is supported.");
  }
  // A private CODEX_HOME plus forced ChatGPT login prevents API credentials from being used.
  writeFileSync(path.join(runtimeDir(), "auth/config.toml"), 'forced_login_method = "chatgpt"\n');
  const status = await run(process.execPath, [cliPath(), "login", "status"]);
  let authenticated = status.code === 0 && /ChatGPT/i.test(status.output);
  if (!authenticated) {
    const existingHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
    const existing = await run(process.execPath, [cliPath(), "login", "status", "-c", 'forced_login_method="chatgpt"'], {
      env: { ...handCodexEnvironment(), CODEX_HOME: existingHome },
    });
    if (existing.code === 0 && /ChatGPT/i.test(existing.output)) {
      selectedAuthHome = existingHome;
      authenticated = true;
      console.log("[hand] Reusing your existing ChatGPT CLI sign-in.");
    }
  }
  if (!authenticated) {
    console.log("[hand] Sign in with ChatGPT in the browser opened by Codex. This uses your Codex allowance.");
    const login = await run(process.execPath, [cliPath(), "login"], { interactive: true });
    if (login.code !== 0) throw new Error("ChatGPT sign-in did not complete. Restart Chronica to try again.");
    const signedIn = await run(process.execPath, [cliPath(), "login", "status"]);
    if (signedIn.code !== 0 || !/ChatGPT/i.test(signedIn.output)) throw new Error("Hand mode requires ChatGPT sign-in, not an API key.");
  }
  console.log(`[hand] Ready: ${handCodexModel()} at ${handCodexEffort()} effort, using your Codex allowance.`);
}

export function prepareHandCodex(): Promise<void> {
  preparing ??= prepare().catch((error: unknown) => { preparing = undefined; throw error; });
  return preparing;
}

export type HandCodexCall = Readonly<{
  operation?: AiOperation;
  model?: string;
  effort?: LocalAiEffort;
}>;

/** Every request has a fresh session: no other actor's secrets or previous game context. */
export async function answerWithHandCodex(system: string, asked: string, requestKey: string, call: HandCodexCall = {}): Promise<string> {
  const existing = inFlight.get(requestKey);
  if (existing) return existing;
  const response = (async () => {
    await prepareHandCodex();
    const model = call.model ?? handCodexModel();
    const effort = call.effort ?? handCodexEffort(call.operation);
    const operation = call.operation;
    const schema = operation === undefined ? undefined : providerSchemaFor(operation);
    return answerGameRequest(operation, asked, (nextAsked) => ask({ system, asked: nextAsked, model, effort, schema, operation }));
  })().catch((error: unknown) => {
    // Recognised by type, so the loop does not pay for a repair of a prompt that was not wrong.
    throw error instanceof CodexTimedOut ? new AiTimeoutError(call.operation ?? "hand", timeoutMs()) : error;
  });
  inFlight.set(requestKey, response);
  try { return await response; } finally { inFlight.delete(requestKey); }
}

async function ask(request: { system: string; asked: string; model: string; effort: LocalAiEffort; schema?: Record<string, unknown> | undefined; operation?: AiOperation | undefined }): Promise<string> {
  const dir = mkdtempSync(path.join(runtimeDir(), "request-"));
  try {
    const schemaPath = path.join(dir, "schema.json");
    const output = path.join(dir, "response.json");
    const instructionsPath = path.join(dir, "instructions.txt");
    const structured = request.schema !== undefined;
    if (structured) writeFileSync(schemaPath, JSON.stringify(request.schema));
    // Replace the coding-agent instructions with the game's instructions,
    // instead of asking it to roleplay the game under an unrelated coding prompt.
    writeFileSync(instructionsPath, gameInstructions(request.system, structured));
    const disabledFeatures = ["shell_tool", "shell_snapshot", "code_mode_host", "apps", "plugins", "hooks", "multi_agent", "browser_use", "computer_use", "image_generation", "workspace_dependencies", "view_image", "sleep_tool", "goals", "skill_search", "tool_suggest"];
    const startedAt = performance.now();
    const result = await run(process.execPath, [
      cliPath(), "exec", "--ignore-user-config",
      "-c", 'forced_login_method="chatgpt"', "-c", `model_reasoning_effort="${request.effort}"`, "-c", 'web_search="disabled"',
      "-c", `model_instructions_file=${JSON.stringify(instructionsPath)}`,
      ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
      "--enable", "skip_host_skill_discovery",
      "--cd", dir, "--model", request.model, "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
      ...(structured ? ["--output-schema", schemaPath] : []), "--output-last-message", output, "--json", "-",
    ], { input: request.asked, timeoutMs: timeoutMs() });
    const completed = result.output.split(/\r?\n/).map(readNearlyJson).findLast((event) => event?.type === "turn.completed");
    console.info(`[hand] ${request.operation ?? "request"} ${request.model}/${request.effort} ${structured ? "schema" : "json"} ${((performance.now() - startedAt) / 1000).toFixed(1)}s code=${result.code}${completed?.usage ? ` usage=${JSON.stringify(completed.usage)}` : ""}`);
    if (result.code !== 0) {
      if (result.output.includes("not supported when using Codex with a ChatGPT account")) {
        throw new Error(`The model ${request.model} is unavailable for your ChatGPT CLI login. Select an available model in the developer account settings. No API fallback was used.`);
      }
      throw new Error("Codex could not answer this request. Check the CLI sign-in, model access, connection, and usage allowance. No API fallback was used.");
    }
    return existsSync(output) ? readFileSync(output, "utf8") : "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
