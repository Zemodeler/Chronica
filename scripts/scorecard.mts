// The order-truth scorecard (plan chronicle-and-order-truth, phase 0).
//
// Runs the scripted fixtures and prints one markdown row each, ready to paste
// into docs/plans/chronicle-and-order-truth-baseline.md. Pass --entries
// <file.json> (an array of chronicle entries from a saved run) to score prose
// as well.
//
// Usage: npm run scorecard [-- --entries path.json]
import { readFileSync } from "node:fs";
import { runScorecard } from "../packages/sim/src/scorecard-fixtures";
import { SCORECARD_HEADER, scorecardRow } from "../packages/sim/src/scorecard";

const at = process.argv.indexOf("--entries");
const entries = at < 0 ? [] : JSON.parse(readFileSync(process.argv[at + 1]!, "utf8"));
const cards = await runScorecard(entries, () => performance.now());
console.log(SCORECARD_HEADER);
for (const card of cards) console.log(scorecardRow(card));
console.log("\nrequests by operation:");
for (const card of cards) console.log(`  ${card.label}: ${JSON.stringify(card.requests)}`);
