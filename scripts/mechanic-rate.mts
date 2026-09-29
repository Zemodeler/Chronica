// Section 2's done-when, read from a played game: of the acts the engine kept
// or floored as arrangements, how many became rules that changed a number;
// how many of the rules written do something a plain income effect could not
// (a condition, a trigger other than monthly, an end); and what the writer
// declined or the engine refused. The kill criterion reads from the same
// figures.
//
// Usage: npx tsx --env-file=.env.local scripts/mechanic-rate.mts <gameId>
import { createDatabase, getWorldView, schema } from "@chronica/db";
import { eq } from "drizzle-orm";

const [gameId] = process.argv.slice(2);
if (!gameId) throw new Error("usage: mechanic-rate <gameId>");
const { db, close } = createDatabase(process.env.DATABASE_URL!);
try {
  const rows = await db.select({ kind: schema.deltaAudit.kind, attempt: schema.deltaAudit.attempt, reason: schema.deltaAudit.reason }).from(schema.deltaAudit).where(eq(schema.deltaAudit.gameId, gameId));
  const view = await getWorldView(db, gameId);
  if (view === undefined) throw new Error("no world");
  const rules = view.world.genericEntities.flatMap((entity) => (entity.mechanic === undefined ? [] : [{ entity, rule: entity.mechanic }]));
  const count = (kind: string, attempt?: string) => rows.filter((row) => row.kind === kind && (attempt === undefined || row.attempt === attempt)).length;

  const keptOrFloored = count("kept") + count("pursuit");
  const idOf = (reason: string) => reason.split(":")[0]!.trim();
  const writtenIds = new Set(rows.filter((row) => row.kind === "mechanic" && (row.attempt === "keep" || row.attempt === "floor")).map((row) => idOf(row.reason)));
  const changed = rules.filter(({ entity, rule }) => writtenIds.has(entity.id) && rule.changedCount >= 1).length;
  const novel = rules.filter(({ rule }) => rule.origin === "written" && (rule.conditions.length > 0 || rule.trigger.kind !== "monthly" || (rule.end.kind !== "never" && rule.end.kind !== "owner_death")));
  const written = rules.filter(({ rule }) => rule.origin === "written");
  const nulls = rows.filter((row) => row.kind === "mechanic_refused" && row.reason.includes("judged it no rule")).length;
  const refused = count("mechanic_refused") - nulls;
  const answers = count("mechanic") + nulls + refused;

  console.log(`kept or floored acts: ${keptOrFloored}; of those, rules that changed a number: ${changed} → rate ${keptOrFloored === 0 ? "—" : (changed / keptOrFloored).toFixed(2)} (done at ≥ 0.50)`);
  console.log(`rules written: ${written.length}; novel (a condition, a trigger other than monthly, or an end): ${novel.length} → share ${written.length === 0 ? "—" : (novel.length / written.length).toFixed(2)} (done at ≥ 0.50)`);
  console.log(`writer answers: ${answers}; declined (null): ${nulls}; refused by validation or price: ${refused} → ${answers === 0 ? "—" : (((nulls + refused) / answers) * 100).toFixed(0)}% (stop if > 50%)`);
  console.log(`candidates seen: ${count("mechanic_candidate")}; refused effects at firing: ${count("mechanic_effect")}; lapsed warrants: ${count("mechanic_warrant_lapsed")}`);
  const dud = rules.filter(({ rule }) => (rule.firedCount > 0 && rule.changedCount === 0) || (rule.firedCount === 0 && rule.endedAtStep === null && view.world.instant.day - rule.attachedAtStep >= 60));
  console.log(`rules that fire on nothing or never fired after two months: ${dud.length} of ${rules.length} (stop if > 25%)`);
  for (const { entity, rule } of rules) {
    console.log(`- ${entity.label} [${entity.id}] (${rule.origin}): ${rule.trigger.kind}, ${rule.conditions.length} cond, end ${rule.end.kind}; fired ${rule.firedCount}, changed ${rule.changedCount}${rule.endedReason === null ? "" : `; ended: ${rule.endedReason}`}`);
  }
} finally {
  await close();
}
