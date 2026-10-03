import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--model" || !args[1])) {
  console.error("Usage: npm run dev:hand -- [--model gpt-6-luna]");
  process.exit(1);
}
const child = spawn(process.execPath, [process.env.npm_execpath, "run", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CHRONICA_AI_MODE: "hand",
    CHRONICA_HAND_RESPONDER: "codex",
    ...(args[1] ? { CHRONICA_HAND_MODEL: args[1] } : {}),
  },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
