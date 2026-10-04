import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
const fake = vi.hoisted(() => ({ spawn: vi.fn<(_command: string, args: string[], options: {env: NodeJS.ProcessEnv}) => FakeChild>(), loggedIn: false, oldVersion: false, existingHome: "", fail: false, answer: '{"actors":[]}', answers: [] as string[], schemas: [] as string[], refuseSchema: false }));
vi.mock("node:child_process", () => ({ spawn: fake.spawn }));

describe("subscription hand responder", () => {
  let dir: string;
  beforeEach(() => {
    vi.resetModules();
    fake.spawn.mockReset();
    fake.loggedIn = false;
    fake.oldVersion = false;
    fake.existingHome = "";
    fake.fail = false;
    fake.answer = '{"actors":[]}';
    fake.answers = [];
    fake.schemas = [];
    fake.refuseSchema = false;
    dir = mkdtempSync(path.join(tmpdir(), "hand-codex-"));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHRONICA_HAND_RUNTIME_DIR", dir);
    vi.stubEnv("CHRONICA_LOCAL_AI_SETTINGS_FILE", path.join(dir, "settings.json"));
    vi.stubEnv("CHRONICA_AI_MODE", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-api-key-must-not-be-used");
    vi.stubEnv("CODEX_API_KEY", "test-api-key-must-not-be-used");
    fake.spawn.mockImplementation((_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
      queueMicrotask(() => {
        let code = 0;
        if (args.includes("install")) {
          fake.oldVersion = false;
          const bin = path.join(dir, "node_modules/@openai/codex/bin");
          mkdirSync(bin, { recursive: true });
          writeFileSync(path.join(bin, "codex.js"), "");
        } else if (args.includes("--version")) {
          child.stdout.write(`codex-cli ${fake.oldVersion ? "0.149.1" : "0.160.0"}`);
        } else if (args.includes("status")) {
          const loggedIn = fake.loggedIn || options.env.CODEX_HOME === fake.existingHome;
          child.stdout.write(loggedIn ? "Logged in using ChatGPT" : "Not logged in");
          code = loggedIn ? 0 : 1;
        } else if (args.includes("login")) {
          fake.loggedIn = true;
        } else if (args.includes("exec")) {
          code = fake.fail ? 1 : 0;
          const structured = args.includes("--output-schema");
          fake.schemas.push(structured ? "schema" : "json");
          if (structured && fake.refuseSchema) {
            code = 1;
            child.stderr.write("invalid_request_error: Invalid schema for response_format");
          } else if (!code) {
            const answer = fake.answers.shift() ?? fake.answer;
            writeFileSync(args[args.indexOf("--output-last-message") + 1]!, answer);
          }
        }
        child.emit("close", code);
      });
      return child;
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("installs on a fresh PC, signs in once and uses Luna with no API credentials", async () => {
    const { prepareHandCodex, answerWithHandCodex } = await import("./hand-codex");
    await Promise.all([prepareHandCodex(), prepareHandCodex()]);
    expect(fake.spawn.mock.calls.filter((call) => call[1].includes("install"))).toHaveLength(1);
    expect(fake.spawn.mock.calls.filter((call) => call[1].includes("login") && !call[1].includes("status"))).toHaveLength(1);
    expect(await answerWithHandCodex("system", "request", "one")).toBe('{"actors":[]}');
    const exec = fake.spawn.mock.calls.find((call) => call[1].includes("exec"))!;
    expect(exec[1]).toContain("gpt-6-luna");
    expect(exec[1]).toContain("shell_tool");
    for (const call of fake.spawn.mock.calls) {
      expect(call[2].env.OPENAI_API_KEY).toBeUndefined();
      expect(call[2].env.CODEX_API_KEY).toBeUndefined();
      if (!call[1].includes('forced_login_method="chatgpt"') || call[1].includes("exec")) expect(call[2].env.CODEX_HOME).toBe(path.join(dir, "auth"));
    }
    expect(readFileSync(path.join(dir, "auth/config.toml"), "utf8")).toContain('forced_login_method = "chatgpt"');
    expect(existsSync(exec[1][exec[1].indexOf("--cd") + 1]!)).toBe(false);
  });

  it("reuses a ChatGPT CLI login without opening sign-in or copying its credentials", async () => {
    const existing = path.join(dir, "existing-codex-home");
    vi.stubEnv("CODEX_HOME", existing);
    fake.existingHome = existing;
    const { answerWithHandCodex } = await import("./hand-codex");
    await answerWithHandCodex("S", "R", "existing-login");
    expect(fake.spawn.mock.calls.filter((call) => call[1].includes("login") && !call[1].includes("status"))).toHaveLength(0);
    const exec = fake.spawn.mock.calls.find((call) => call[1].includes("exec"))!;
    expect(exec[2].env.CODEX_HOME).toBe(existing);
    expect(exec[2].env.OPENAI_API_KEY).toBeUndefined();
    expect(existsSync(path.join(existing, "config.toml"))).toBe(false);
  });

  it("reuses an installation and login, deduplicates concurrent requests, and respects model selection", async () => {
    const bin = path.join(dir, "node_modules/@openai/codex/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "codex.js"), "");
    fake.loggedIn = true;
    vi.stubEnv("CHRONICA_HAND_MODEL", "gpt-5.6-luna");
    const { answerWithHandCodex } = await import("./hand-codex");
    await Promise.all([answerWithHandCodex("S", "R", "same"), answerWithHandCodex("S", "R", "same")]);
    expect(fake.spawn.mock.calls.filter((call) => call[1].includes("install"))).toHaveLength(0);
    const calls = fake.spawn.mock.calls.filter((call) => call[1].includes("exec"));
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toContain("gpt-5.6-luna");
  });

  it("rejects CLI failures and malformed JSON instead of using an API fallback", async () => {
    const { answerWithHandCodex } = await import("./hand-codex");
    fake.fail = true;
    await expect(answerWithHandCodex("S", "R", "failed")).rejects.toThrow("No API fallback");
    fake.fail = false;
    fake.answer = "not JSON";
    expect(await answerWithHandCodex("S", "R", "bad-json")).toBe("not JSON");
  });

  it("refuses production before installation or login", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { prepareHandCodex } = await import("./hand-codex");
    await expect(prepareHandCodex()).rejects.toThrow("local development");
    expect(fake.spawn).not.toHaveBeenCalled();
  });

  it("asks at low effort unless told otherwise, and keys the cache by model, effort and format", async () => {
    fake.loggedIn = true;
    const { answerWithHandCodex, handCodexCacheNamespace, handCodexEffort } = await import("./hand-codex");
    await answerWithHandCodex("S", "R", "effort-default");
    expect(fake.spawn.mock.calls.find((call) => call[1].includes("exec"))![1]).toContain('model_reasoning_effort="low"');
    expect(handCodexEffort("simulate_cognition")).toBe("low");
    expect(handCodexCacheNamespace("simulate_cognition")).toBe("codex-v4:gpt-6-luna:low:schema");
    expect(handCodexCacheNamespace("compose_chronicle")).toBe("codex-v4:gpt-6-luna:low:schema");
    vi.stubEnv("CHRONICA_HAND_EFFORT", "high");
    vi.stubEnv("CHRONICA_AI_EFFORT_COMPOSE_CHRONICLE", "low");
    expect(handCodexEffort("simulate_cognition")).toBe("high");
    expect(handCodexEffort("compose_chronicle")).toBe("low");
    expect(handCodexCacheNamespace("simulate_cognition")).toBe("codex-v4:gpt-6-luna:high:schema");
  });

  it("holds cognition to its own schema and hands back what Zod expects", async () => {
    fake.loggedIn = true;
    // The strict dialect writes an absent plan as null and a record as pairs; the answer comes back as Zod reads it.
    fake.answer = JSON.stringify({ actors: [] });
    const { answerWithHandCodex } = await import("./hand-codex");
    expect(JSON.parse(await answerWithHandCodex("S", "R", "schema-mode", { operation: "simulate_cognition" }))).toEqual({ actors: [] });
    expect(fake.schemas).toEqual(["schema"]);
    const schemaPath = fake.spawn.mock.calls.find((call) => call[1].includes("exec"))![1];
    expect(schemaPath).toContain("--output-schema");
  });

  it("removes only a separately supplied schema and keeps the game's instructions", async () => {
    const { handCodexInstructions } = await import("./hand-codex");
    const system = 'Obey the authority rules.\n{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"actors":{}}}';
    expect(handCodexInstructions(system, true)).toContain("Obey the authority rules.");
    expect(handCodexInstructions(system, true)).not.toContain('"$schema"');
    expect(handCodexInstructions(system, false)).toContain('"$schema"');
    expect(handCodexInstructions('Keep this.\n{"$schema":broken', true)).toContain('"$schema":broken');
  });

  it("retries an unreadable structured reply under the same schema", async () => {
    fake.loggedIn = true;
    fake.answers = ["broken", '{"actors":[]}'];
    const { answerWithHandCodex } = await import("./hand-codex");
    expect(await answerWithHandCodex("S", "R", "same-schema-retry", { operation: "simulate_cognition" })).toBe('{"actors":[]}');
    expect(fake.schemas).toEqual(["schema", "schema"]);
  });

  it("asks Chronicle and reconciliation for objects without a JSON-string envelope", async () => {
    const { answerWithHandCodex } = await import("./hand-codex");
    fake.answers = ['{"entries":[]}', '{"withdraw":[],"rewrite":[]}'];
    expect(await answerWithHandCodex("S", "R", "chronicle", {operation: "compose_chronicle"})).toBe('{"entries":[]}');
    expect(await answerWithHandCodex("S", "R", "reconcile", {operation: "reconcile_facts"})).toBe('{"withdraw":[],"rewrite":[]}');
    expect(fake.schemas).toEqual(["schema", "schema"]);
  });

  it("reports schema refusal without silently changing the game contract", async () => {
    fake.loggedIn = true;
    fake.refuseSchema = true;
    const { answerWithHandCodex } = await import("./hand-codex");
    await expect(answerWithHandCodex("S", "R", "refused", { operation: "simulate_orchestrate" })).rejects.toThrow("No API fallback");
    expect(fake.schemas).toEqual(["schema"]);
  });

  it("reads a fenced or trailing-comma answer, and asks once more for one it cannot read", async () => {
    fake.loggedIn = true;
    const { answerWithHandCodex, readNearlyJson } = await import("./hand-codex");
    expect(readNearlyJson('```json\n{"a": [1, 2,],}\n```')).toEqual({ a: [1, 2] });
    expect(readNearlyJson('Here it is: {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(readNearlyJson('{"said": "he said "go""}')).toBeUndefined();
    fake.answers = ['{"actors": [{"said": "he said "go""}]}', '{"actors":[]}'];
    expect(await answerWithHandCodex("S", "R", path.join(dir, "retried.json"))).toBe('{"actors":[]}');
    const asked = fake.spawn.mock.calls.filter((call) => call[1].includes("exec"));
    expect(asked).toHaveLength(2);
    expect(fake.schemas).toEqual(["json", "json"]);
  });

  it("reports a deadline as a timeout the loop recognises", async () => {
    fake.loggedIn = true;
    vi.stubEnv("CHRONICA_HAND_CODEX_TIMEOUT_MS", "20");
    const bin = path.join(dir, "node_modules/@openai/codex/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "codex.js"), "");
    const { answerWithHandCodex, prepareHandCodex } = await import("./hand-codex");
    await prepareHandCodex();
    const { isTimeout } = await import("@chronica/shared");
    fake.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() }));
    const failure = await answerWithHandCodex("S", "R", "slow", { operation: "simulate_cognition" }).catch((error: unknown) => error);
    expect(isTimeout(failure)).toBe(true);
    expect((failure as Error).name).toBe("AiTimeoutError");
  });

  it("automatically upgrades an older downloaded CLI", async () => {
    const bin = path.join(dir, "node_modules/@openai/codex/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "codex.js"), "");
    fake.oldVersion = true;
    fake.loggedIn = true;
    const { prepareHandCodex } = await import("./hand-codex");
    await prepareHandCodex();
    const installs = fake.spawn.mock.calls.filter((call) => call[1].includes("install"));
    expect(installs).toHaveLength(1);
    expect(installs[0]![1]).toContain("@openai/codex@0.160.0");
  });
});
