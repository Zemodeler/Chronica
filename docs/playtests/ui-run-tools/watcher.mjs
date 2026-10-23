// Answers ONLY the stub operations and voice_letters. Everything else is left for hand answers.
import { readdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { autoLetters } from "./autoletters.mjs";

// node docs/playtests/ui-run-tools/watcher.mjs <hand dir> "<the player's character name>"
const dir = process.argv[2] ?? "apps/web/eval-out/ui-run/hand";
const playerName = (process.argv[3] ?? "the player").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stubs = {
  write_mechanic: '{"mechanic":null}',
  reconcile_facts: '{"withdraw":[],"rewrite":[]}',
  repair_deltas: '{"deltas":[]}',
};
const counts = { stub: 0, auto: 0 };
const held = new Set();
for (;;) {
  for (const f of readdirSync(dir)) {
    const m = /^(.+)-([0-9a-f]+)\.prompt\.txt$/.exec(f);
    if (!m) continue;
    const out = join(dir, `${m[1]}-${m[2]}.json`);
    if (existsSync(out)) continue;
    let body = null;
    if (stubs[m[1]]) { body = stubs[m[1]]; counts.stub++; }
    else if (m[1] === "simulate_cognition") {
      // Left for hand answer only when the power holds a letter from the player.
      const t = readFileSync(join(dir, f), "utf8");
      // held: a letter from the player awaits an answer, or the player's decision was forced onto this power
      const mine = new RegExp(`Letters awaiting their answer:[^\\n]*\\n(\\s*- \\[[^\\n]*\\n)*?\\s*- \\[[^\\n]*by ${playerName}`);
      if (!mine.test(t) && !/reached you after/.test(t)) { body = '{"actors":[]}'; counts.stub++; }
      else if (!held.has(f)) { held.add(f); appendFileSync(join(dir, "..", "held.log"), `${new Date().toISOString()} HELD ${f}\n`); }
    }
    else if (m[1] === "voice_letters") { body = autoLetters(readFileSync(join(dir, f), "utf8")); counts.auto++; }
    if (body !== null) {
      writeFileSync(out, body);
      appendFileSync(join(dir, "..", "watcher.log"), `${new Date().toISOString()} ${m[1]}-${m[2]} ${JSON.stringify(counts)}\n`);
    }
  }
  await new Promise((r) => setTimeout(r, 700));
}
