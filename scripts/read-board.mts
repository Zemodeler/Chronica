/**
 * Prints the board (packages/sim/src/board.ts) for a saved world: what each
 * named power sees of its neighbourhood. Usage:
 *   npx tsx scripts/read-board.mts <world.json> [polityId ...]
 */
import { readFileSync } from "node:fs";
import { WorldStateSchema } from "@chronica/shared";
import { describeNeighbourhood, readBoard } from "../packages/sim/src/board";

const [path, ...ids] = process.argv.slice(2);
if (path === undefined) throw new Error("usage: read-board.mts <world.json> [polityId ...]");
const raw = JSON.parse(readFileSync(path, "utf8"));
const world = WorldStateSchema.parse(raw.world ?? raw);
const started = performance.now();
const board = readBoard(world);
console.log(`${board.size} powers read in ${Math.round(performance.now() - started)} ms`);
for (const id of ids.length > 0 ? ids : [...board.keys()].slice(0, 5)) {
  console.log(`\n# ${id}`);
  console.log(describeNeighbourhood(world, id).join("\n") || "(nothing around it)");
}
