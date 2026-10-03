import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ spawn: vi.fn(), loggedIn: false, oldVersion: false, existingHome: "", fail: false, answer: '{"actors":[]}' }));
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
          if (!code) writeFileSync(args[args.indexOf("--output-last-message") + 1]!, JSON.stringify({ answer: fake.answer }));
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
    expect(existsSync(exec[1][exec[1].indexOf("--cd") + 1])).toBe(false);
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
    await expect(answerWithHandCodex("S", "R", "bad-json")).rejects.toThrow();
  });

  it("refuses production before installation or login", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { prepareHandCodex } = await import("./hand-codex");
    await expect(prepareHandCodex()).rejects.toThrow("local development");
    expect(fake.spawn).not.toHaveBeenCalled();
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
