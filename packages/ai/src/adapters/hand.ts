import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AiOperation } from "@chronica/shared";
import type { AiAdapter, AiCallResult, AiConversationMessage, AiToolCall, AiToolCallResult, AiToolDefinition } from "../adapter";

/**
 * A model that is a person answering from files -- the base way to play the
 * game while working on it, because it spends nothing and hides nothing.
 *
 * Every call writes its prompt to `<dir>/<operation>-<hash>.prompt.txt` and
 * waits for `<dir>/<operation>-<hash>.json`. The name is the prompt's own
 * hash, so the same prompt is the same file on every run: a game played again
 * from the same world replays the answers already written without anybody
 * touching them, and only what is new waits. `queue.log` lists the prompts in
 * the order they were asked, which is the order to answer them in.
 *
 * Written for Claude working as the model (a session reads the prompt and
 * writes the answer), and for a developer who wants to see exactly what the
 * engine asks and exactly what it does with an answer. No provider is called,
 * and no coin is reserved: the gate lets a `free` adapter's calls through.
 *
 * An answer is the model's reply exactly as it would have come back: the JSON
 * object a prompt asks for. A tool-using step answers `{"content": "...",
 * "toolCalls": [{"name": "...", "arguments": {...}}]}`.
 */

export interface HandAdapterOptions {
  /** Automatic development responder; omit to retain manual file answering. */
  readonly respond?: (system: string, asked: string, requestKey: string, operation: AiOperation) => Promise<string>;
  /** Separate automatic answers by model, effort and protocol version: a change of any of them is a different answer. */
  readonly cacheNamespace?: string | ((operation: AiOperation) => string);
  /** Where prompts and answers live. */
  readonly dir: string;
  /** How often to look for an answer. */
  readonly pollMs?: number;
  /** Give up after this long, with an error naming the prompt. Unset waits for ever. */
  readonly timeoutMs?: number;
  /** Told once per prompt that is waiting, with its path. */
  readonly onWaiting?: (promptPath: string) => void;
}

/** The file stem a prompt is kept under: its operation and the hash of what was asked. */
export function handStem(operation: string, asked: string): string {
  return `${operation}-${createHash("sha256").update(asked).digest("hex").slice(0, 16)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function answerFor(options: HandAdapterOptions, operation: AiOperation, system: string, asked: string): Promise<string> {
  const { dir } = options;
  mkdirSync(dir, { recursive: true });
  const namespace = typeof options.cacheNamespace === "function" ? options.cacheNamespace(operation) : options.cacheNamespace;
  const stem = handStem(operation, options.respond ? JSON.stringify([namespace, system, asked]) : asked);
  const answerPath = path.join(dir, `${stem}.json`);
  if (existsSync(answerPath)) {
    const cached = readFileSync(answerPath, "utf8");
    try { JSON.parse(cached); return cached; } catch { /* Ignore interrupted/invalid cached answers. */ }
  }

  // Each operation's system prompt once: it is the same for every call, and
  // it is where the answer's schema is.
  const systemPath = path.join(dir, `system-${operation}.txt`);
  if (!existsSync(systemPath)) writeFileSync(systemPath, system);
  const promptPath = path.join(dir, `${stem}.prompt.txt`);
  if (!existsSync(promptPath)) {
    writeFileSync(promptPath, asked);
    appendFileSync(path.join(dir, "queue.log"), `${new Date().toISOString()} ${stem}\n`);
  }
  options.onWaiting?.(promptPath);

  if (options.respond) {
    // Keep the actual system instructions beside each request, including after prompt edits.
    writeFileSync(path.join(dir, `${stem}.system.txt`), system);
    const answer = await options.respond(system, asked, answerPath, operation);
    JSON.parse(answer);
    const temporary = `${answerPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, answer);
    renameSync(temporary, answerPath);
    return answer;
  }

  const startedAt = Date.now();
  for (;;) {
    await sleep(options.pollMs ?? 500);
    if (existsSync(answerPath)) {
      // Written by hand, so possibly caught half-written: a file that does not
      // yet parse is read again rather than handed on.
      const text = readFileSync(answerPath, "utf8");
      try {
        JSON.parse(text);
        return text;
      } catch {
        continue;
      }
    }
    if (options.timeoutMs !== undefined && Date.now() - startedAt > options.timeoutMs) {
      throw new Error(`No answer was written for ${promptPath} within ${Math.round(options.timeoutMs / 1000)}s.`);
    }
  }
}

const NOTHING_SPENT = { model: "hand", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } as const;

export function createHandAdapter(options: HandAdapterOptions): AiAdapter {
  let callCounter = 0;
  return {
    free: true,
    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      return { ...NOTHING_SPENT, content: await answerFor(options, operation, systemPrompt, userMessage) };
    },
    async callWithTools(operation, systemPrompt, messages: readonly AiConversationMessage[], tools: readonly AiToolDefinition[]): Promise<AiToolCallResult> {
      const asked = JSON.stringify({ tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), messages }, null, 2);
      const raw = JSON.parse(await answerFor(options, operation, systemPrompt, asked)) as { content?: unknown; toolCalls?: unknown };
      if (options.respond && (typeof raw.content !== "string" || !Array.isArray(raw.toolCalls) || raw.toolCalls.some((entry: unknown) => {
        if (typeof entry !== "object" || entry === null || !("name" in entry) || !("arguments" in entry)) return true;
        return !tools.some((tool) => tool.name === entry.name) || typeof entry.arguments !== "object" || entry.arguments === null || Array.isArray(entry.arguments);
      }))) throw new Error("Codex returned an invalid tool step or an unknown tool name.");
      const toolCalls: AiToolCall[] = (Array.isArray(raw.toolCalls) ? raw.toolCalls : [])
        .filter((entry): entry is { name: string; arguments?: Record<string, unknown> } => typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string")
        .map((entry) => {
          callCounter += 1;
          return { id: `hand-call-${callCounter}`, name: entry.name, arguments: entry.arguments ?? {} };
        });
      return { ...NOTHING_SPENT, content: typeof raw.content === "string" ? raw.content : "", toolCalls, stopReason: toolCalls.length > 0 ? "tool_calls" : "stop" };
    },
  };
}
