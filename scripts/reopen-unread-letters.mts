/**
 * Letters "refused by silence" that nobody ever read (2026-09-28).
 *
 * Before `putToRecipientOnDay`, the tick lapsed every letter past its term,
 * read or not. In the Clepsina save six of Rome's allies were recorded as
 * refusing "Aid for the defence of Messana" by silence on day 136 -- none of
 * them had been shown it. Their letters are put back before them with a fresh
 * term, and the trust the lapse took from Rome (-14 each, the tick's flat
 * "ignored") is given back. The ultimatum to Syracuse, and its war, stand.
 *
 *   tsx --env-file=.env.local scripts/reopen-unread-letters.mts <gameId>                          # dry run
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/reopen-unread-letters.mts <gameId> --apply  # writes it, after saving a backup
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldStateSchema, findWorldReferenceViolations, type WorldState } from "@chronica/shared";

const SUBJECT = "Aid for the defence of Messana";
const TERM_DAYS = 30;
/** What `applyDiplomaticAnswerToStance` takes for "ignored" when no hands are given, as the tick gives none. */
const IGNORED_SHIFT = 14;

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: reopen-unread-letters.mts <gameId> [--apply]");
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) throw new Error("DATABASE_URL is unavailable.");
  const database = createDatabase(url);
  try {
    const view = await getWorldView(database.db, gameId);
    if (view === undefined) throw new Error(`No world for game ${gameId}.`);
    const before: WorldState = view.world;
    const atStep = before.elapsedStep;

    // Lapsed unread: answered "ignored" by the tick, never put before the reader.
    const lapsed = before.diplomacy.filter((message) => message.fromPolityId === "rome" && message.subject === SUBJECT
      && message.answer === "ignored" && message.answerText === "No answer came." && message.putToRecipientOnDay == null);
    const ids = new Set(lapsed.map((message) => message.id));
    const allies = new Set(lapsed.map((message) => message.toPolityId));

    const world: WorldState = {
      ...before,
      diplomacy: before.diplomacy.map((message) => (ids.has(message.id)
        ? { ...message, status: "awaiting_reply" as const, answer: null, answerText: null, answeredAtStep: null, putToRecipientOnDay: null, replyDueByStep: atStep + TERM_DAYS }
        : message)),
      polityStances: before.polityStances.map((stance) => (stance.polityId === "rome" && allies.has(stance.towardPolityId)
        ? { ...stance, trustScore: Math.min(100, stance.trustScore + IGNORED_SHIFT), lastShiftReason: `The letter "${SUBJECT}" was never read; it is before them again.`, lastShiftAtStep: atStep }
        : stance)),
    };

    const parsed = WorldStateSchema.parse(world);
    const introduced = findWorldReferenceViolations(parsed).length - findWorldReferenceViolations(before).length;
    console.log(JSON.stringify({
      reopened: lapsed.map((message) => ({ id: message.id, to: message.toPolityId, reader: message.toCharacterId })),
      replyDueByStep: atStep + TERM_DAYS,
      trust: [...allies].map((ally) => ({
        ally,
        was: before.polityStances.find((stance) => stance.polityId === "rome" && stance.towardPolityId === ally)?.trustScore ?? null,
        now: parsed.polityStances.find((stance) => stance.polityId === "rome" && stance.towardPolityId === ally)?.trustScore ?? null,
      })),
      referenceViolationsIntroduced: introduced,
    }, null, 2));
    if (introduced > 0) throw new Error("The repaired world would carry new dangling references; nothing written.");
    if (flag !== "--apply") {
      console.log("Dry run: nothing written. Pass --apply to write it.");
      return;
    }
    const backup = `${process.env.BACKUP_DIR ?? "."}/world-backup-${gameId}-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(before));
    console.log(`Backup of the world as it was: ${backup}`);
    // Over the revision this repair read, and never while a burst is running.
    await persistRepairedWorld(database.db, { gameId, expectedRevision: view.revision, world: parsed });
    console.log("Written.");
  } finally {
    await database.close();
  }
}

void main();
