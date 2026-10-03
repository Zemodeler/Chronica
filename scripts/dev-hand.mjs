import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const options = {};
for (let at = 0; at < args.length; at += 2) {
  const [flag, value] = [args[at], args[at + 1]];
  if (!value || (flag !== "--model" && flag !== "--effort") || (flag === "--effort" && !["low", "medium", "high"].includes(value))) {
    console.error("Usage: npm run dev:hand -- [--model gpt-6-luna] [--effort low|medium|high]");
    process.exit(1);
  }
  options[flag.slice(2)] = value;
}
const child = spawn(process.execPath, [process.env.npm_execpath, "run", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CHRONICA_AI_MODE: "hand",
    CHRONICA_HAND_RESPONDER: "codex",
    ...(options.model ? { CHRONICA_HAND_MODEL: options.model } : {}),
    // Medium unless told otherwise (packages/ai/src/local-key-selection.ts).
    ...(options.effort ? { CHRONICA_HAND_EFFORT: options.effort } : {}),
  },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
