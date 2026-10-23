// node docs/playtests/ui-run-tools/schema.mjs --list | <op> ... | --def <Def> ; run from the repo root once the first orchestrate prompt exists.
import { readFileSync } from "node:fs";
const s = readFileSync(process.env.SYSTEM_FILE ?? "apps/web/eval-out/ui-run/hand/system-simulate_orchestrate.txt", "utf8"); // the file the server writes next to the first orchestrate prompt
const start = s.indexOf('{"$schema"');
let depth = 0, end = start;
for (let i = start; i < s.length; i++) { if (s[i] === "{") depth++; else if (s[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } } }
const schema = JSON.parse(s.slice(start, end));
const defs = schema.$defs;
const worldDelta = defs.WorldDelta;
const variants = worldDelta.oneOf ?? worldDelta.anyOf;
const brief = (v) => { const p = v.properties ?? {}; const req = new Set(v.required ?? []); return Object.entries(p).map(([k, d]) => { const t = d.type ?? (d.enum ? "enum:" + d.enum.join("|") : d.anyOf ? d.anyOf.map((x) => x.type ?? (x.enum ? "enum:" + x.enum.join("|") : x.$ref ?? "?")).join("/") : d.$ref ?? d.const ?? "?"); return `${k}${req.has(k) ? "" : "?"}:${typeof t === "string" ? t : JSON.stringify(t)}`; }).join(", "); };
const want = process.argv.slice(2);
if (want[0] === "--list") { console.log(variants.map((v) => v.properties?.op?.const).join(" ")); console.log("top-level:", Object.keys(schema.properties).join(", ")); process.exit(0); }
if (want[0] === "--def") { console.log(JSON.stringify(defs[want[1]], null, 0).slice(0, 4000)); process.exit(0); }
if (want[0] === "--top") { console.log(brief(schema)); process.exit(0); }
for (const op of want) { const v = variants.find((x) => x.properties?.op?.const === op); console.log(`## ${op}: ${v ? brief(v) : "NOT FOUND"}`); }
