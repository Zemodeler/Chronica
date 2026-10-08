import { spawn } from "node:child_process";

// Runs a command with environment variables set first: `node scripts/dev-env.mjs KEY=value [KEY=value ...] command args...`.
// The launch configurations used `env`, which is not there on Windows.
const args = process.argv.slice(2);
const env = { ...process.env };
let at = 0;
for (; at < args.length; at += 1) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(args[at]);
  if (match === null) break;
  env[match[1]] = match[2];
}
const command = args.slice(at);
if (command.length === 0) {
  console.error("Usage: node scripts/dev-env.mjs KEY=value [KEY=value ...] command [args...]");
  process.exit(1);
}
const child = spawn(command[0], command.slice(1), { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
