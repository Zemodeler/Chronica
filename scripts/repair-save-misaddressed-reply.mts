/** Hand a counter-letter that went to the consul back to the player who wrote the letter it answers. No time passes and nothing is answered. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldStateSchema } from "@chronica/shared";

const gameId = process.argv[2];
if (gameId === undefined) throw Error("Usage: repair-save-misaddressed-reply.mts <gameId> [--apply]");
const database = createDatabase(process.env.DATABASE_URL!);
try {
  const view = await getWorldView(database.db, gameId);
  if (!view) throw Error("No such game.");
  const before = view.world;
  const moved: string[] = [];
  const world = WorldStateSchema.parse({ ...before, diplomacy: before.diplomacy.map((message) => {
    const original = message.inReplyToMessageId === null ? undefined : before.diplomacy.find((candidate) => candidate.id === message.inReplyToMessageId);
    const writer = original?.fromCharacterId == null ? undefined : before.characters.find((character) => character.id === original.fromCharacterId);
    if (message.status !== "awaiting_reply" || writer === undefined || !writer.alive || writer.polityId !== message.toPolityId || message.toCharacterId === writer.id) return message;
    moved.push(`${message.id}: ${message.toCharacterId} -> ${writer.id}`);
    return { ...message, toCharacterId: writer.id };
  }) });
  console.log(JSON.stringify({ revision: view.revision, moved }));
  if (moved.length > 0 && process.argv.includes("--apply")) {
    const dir = path.resolve(process.env.TEMP ?? ".", "chronica-save-backups");
    mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `${gameId}-reply-revision-${view.revision}.json`);
    writeFileSync(backup, JSON.stringify({ world: before, revision: view.revision }), { flag: "wx" });
    const revision = await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world, repairRecord: {
      title: "A reply to your letter is put in your hands",
      storylineIds: [],
      body: "Answers to letters you wrote were being handed to the consul instead of to you. The reply that came back to your offer to Messana is now yours to answer. No time has passed.",
    } });
    console.log(JSON.stringify({ writtenRevision: revision, backup }));
  } else console.log("Dry run; no save changed.");
} finally { await database.close(); }
