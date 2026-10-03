/**
 * The Roman navy of 150 begun twice (2026-09-30): the Senate's motion opened
 * the Republic's project, and the consul's own order opened a second one
 * beside it, started at once. The motion's project (the one the enactment
 * names) stays; the consul's twin is cancelled if nothing was paid into it.
 *
 *   tsx --env-file=.env.local scripts/repair-save-duplicate-navy.mts <gameId>           # dry run
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/repair-save-duplicate-navy.mts <gameId> --apply
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldStateSchema, findWorldReferenceViolations, type WorldState } from "@chronica/shared";

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: repair-save-duplicate-navy.mts <gameId> [--apply]");
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) throw new Error("DATABASE_URL is unavailable.");
  const database = createDatabase(url);
  try {
    const view = await getWorldView(database.db, gameId);
    if (view === undefined) throw new Error(`No world for game ${gameId}.`);
    const before: WorldState = view.world;
    const kept = before.projects.filter((project) => before.enactments.some((enactment) => enactment.projectId === project.id) && project.kind === "naval_construction" && project.status === "in_progress");
    if (kept.length !== 1) throw new Error(`Expected one enacted navy project, found ${kept.length}.`);
    const twins = before.projects.filter((project) => project.id !== kept[0]!.id && project.kind === "naval_construction" && project.status === "in_progress" && project.label === kept[0]!.label);
    const paid = (id: string): number => before.material.transactions.filter((t) => t.cause.id === id).length;
    const report = { kept: kept[0]!.id, cancelled: twins.map((t) => t.id), paymentsIntoTwins: twins.map((t) => paid(t.id)) };
    if (twins.some((t) => paid(t.id) > 0)) throw new Error(`A twin already has payments; not touching it: ${JSON.stringify(report)}`);
    const ids = new Set(twins.map((t) => t.id));
    const world: WorldState = { ...before, projects: before.projects.map((p) => (ids.has(p.id) ? { ...p, status: "cancelled" as const } : p)) };
    const parsed = WorldStateSchema.parse(world);
    const introduced = findWorldReferenceViolations(parsed).length - findWorldReferenceViolations(before).length;
    console.log(JSON.stringify({ ...report, referenceViolationsIntroduced: introduced }, null, 2));
    if (introduced > 0) throw new Error("New dangling references; nothing written.");
    if (flag !== "--apply") { console.log("Dry run: nothing written. Pass --apply to write it."); return; }
    const backup = `${process.env.BACKUP_DIR ?? "."}/world-backup-${gameId}-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(before));
    console.log(`Backup of the world as it was: ${backup}`);
    await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world: parsed });
    console.log("Written.");
  } finally {
    await database.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
