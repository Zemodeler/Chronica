/**
 * The Clepsina save of spring 270 BC, brought up to the fixes of 2026-09-29.
 *
 * - Every chamber decides by votes cast. The Senate counted over the whole
 *   house, so a fleet carried 49 to none with 51 undecided was lost.
 * - The country is ten times as populous as it was drawn (`province-material.ts`
 *   counts the countryside now). Population, the displaced and the men of age
 *   are scaled; the tax capacity is not, because the tax per head was divided
 *   by the same factor.
 * - Provinces keep the ancient names the new map graph gives them, where play
 *   has not renamed them: "Szabolcs-Szatmár-Bereg" is not a place in 270 BC.
 * - One Anio survey, not four: the same work begun again by the same man is
 *   the same work.
 * - An army has one march: a later move order used to leave the earlier march
 *   running, and the tick then moved the army on it. And the hired fleet's
 *   march on Panormus, a one-letter slip for Messana, is called off; it waits
 *   in Bruttium for orders.
 * - The 1,000 the consul sent "to ensure passage" left his purse for nowhere
 *   -- no account received it and nothing recorded it -- and is returned.
 * - Rome's allies are marked as having sent this season's contingent, so a
 *   new war this year does not levy them a third time.
 *
 *   tsx --env-file=.env.local scripts/repair-save-spring-270.mts <gameId>                          # dry run
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/repair-save-spring-270.mts <gameId> --apply  # writes it, after saving a backup
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld, punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, findWorldReferenceViolations, type WorldState } from "@chronica/shared";

const POPULATION_SCALE = 10;
const LOST_SUM = 1_000;
const OPEN = new Set(["proposed", "funded", "in_progress"]);
/** A label's telling words: "Survey the proposed Anio aqueduct route" -> survey, proposed, anio, aqueduct, route. */
const telling = (label: string): Set<string> => new Set(label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((word) => word.length > 3));
/** The same work: two telling words in common, and a survey only ever the same as a survey. */
const sameWork = (a: string, b: string): boolean => {
  const [x, y] = [telling(a), telling(b)];
  return x.has("survey") === y.has("survey") && [...x].filter((word) => y.has(word)).length >= 2;
};
/**
 * The hired fleet's march of day 65 on "Panormus and the north-west", written
 * for Messana one letter off (the north-west province for the north-east): a
 * beaten squadron sailing into Carthage's own harbour.
 */
const MISADDRESSED_MARCHES = ["project-964ca4ef-29fc-4c65-b007-3ff91f0a82be-70"];

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: repair-save-spring-270.mts <gameId> [--apply]");
  const url = process.env.DATABASE_URL?.trim();
  if (url === undefined || url.length === 0) throw new Error("DATABASE_URL is unavailable.");
  const database = createDatabase(url);
  try {
    const view = await getWorldView(database.db, gameId);
    if (view === undefined) throw new Error(`No world for game ${gameId}.`);
    const before: WorldState = view.world;
    let world = before;
    const report: Record<string, unknown> = {};
    const atStep = world.elapsedStep;
    // Once only: the population is scaled by this repair, so a second run would scale it again.
    if (world.material.transactions.some((transaction) => transaction.id === `refund-passage-${gameId}`.slice(0, 120))) {
      console.log("Already repaired: nothing to do.");
      return;
    }

    // 1. Votes cast.
    const recounted = world.material.institutions.filter((institution) => institution.denominator !== "cast").map((institution) => institution.id);
    world = { ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => ({ ...institution, denominator: "cast" as const })) } };
    report.chambersNowByVotesCast = recounted;

    // 2. The people.
    // The men already levied stay levied: the new pool less what the old one gave.
    const fresh = new Map(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0).material.provinceMaterial
      .map((row) => [row.provinceId, row.availableManpower]));
    world = { ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => {
      const full = fresh.get(row.provinceId);
      const taken = full === undefined ? 0 : Math.max(0, Math.round(full / POPULATION_SCALE) - row.availableManpower);
      return {
        ...row,
        population: row.population * POPULATION_SCALE,
        displacedPopulation: row.displacedPopulation * POPULATION_SCALE,
        availableManpower: full === undefined ? row.availableManpower * POPULATION_SCALE : Math.max(0, full - taken),
      };
    }) } };
    const latium = world.material.provinceMaterial.find((row) => /latium/.test(row.provinceId));
    report.population = { scaledBy: POPULATION_SCALE, provinces: world.material.provinceMaterial.length, latium: latium === undefined ? null : { population: latium.population, men: latium.availableManpower } };

    // 3. Names.
    const opening = new Map((punicWarsScenario.initialWorld as WorldState).map.provinces.map((province) => [province.id, province.name]));
    const renamed: string[] = [];
    world = { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => {
      const name = opening.get(province.id);
      if (name === undefined || name === province.name || province.formerNames.length > 0) return province;
      renamed.push(`${province.name} -> ${name}`);
      return { ...province, name };
    }) } };
    report.renamed = { count: renamed.length, sample: renamed.slice(0, 8) };

    // 4. One work, not four.
    const kept: WorldState["projects"][number][] = [];
    const duplicates: string[] = [];
    for (const project of [...world.projects].sort((a, b) => a.startedAtStep - b.startedAtStep || a.id.localeCompare(b.id))) {
      if (!OPEN.has(project.status) || project.completionOutcome?.kind === "force_move") continue;
      const first = kept.find((candidate) => candidate.sponsorEntityRef.kind === project.sponsorEntityRef.kind && candidate.sponsorEntityRef.id === project.sponsorEntityRef.id && sameWork(candidate.label, project.label));
      if (first !== undefined) duplicates.push(project.id);
      else kept.push(project);
    }
    world = { ...world, projects: world.projects.map((project) => (duplicates.includes(project.id) ? { ...project, status: "cancelled" as const } : project)) };
    report.duplicateWorksCancelled = duplicates.map((id) => `${id}: ${before.projects.find((project) => project.id === id)?.label}`);

    // 5. One march an army.
    const latestMarch = new Map<string, WorldState["projects"][number]>();
    for (const project of world.projects) {
      const forceId = project.completionOutcome?.kind === "force_move" ? project.completionOutcome.forceId : null;
      if (!OPEN.has(project.status) || forceId === null) continue;
      const known = latestMarch.get(forceId);
      if (known === undefined || project.startedAtStep > known.startedAtStep) latestMarch.set(forceId, project);
    }
    const calledOff = world.projects.filter((project) => OPEN.has(project.status) && project.completionOutcome?.kind === "force_move"
      && project.completionOutcome.forceId !== null && (latestMarch.get(project.completionOutcome.forceId)?.id !== project.id || MISADDRESSED_MARCHES.includes(project.id))).map((project) => project.id);
    world = { ...world, projects: world.projects.map((project) => (calledOff.includes(project.id) ? { ...project, status: "cancelled" as const } : project)) };
    report.staleMarchesCalledOff = calledOff.map((id) => `${id}: ${before.projects.find((project) => project.id === id)?.label}`);

    // 6. The 1,000 that went nowhere.
    // The player declared himself, so his id is a declared one; this save has one Clepsina.
    const player = world.characters.find((character) => character.id.startsWith("declared-") && /Clepsina/.test(character.name));
    const purse = player?.personalAccountId;
    const recorded = world.material.transactions.some((transaction) => transaction.sourceAccountId === purse && transaction.amount === LOST_SUM);
    if (purse !== undefined && !recorded && !world.material.transactions.some((transaction) => transaction.id === `refund-passage-${gameId}`.slice(0, 120))) {
      world = { ...world, material: { ...world.material,
        accounts: world.material.accounts.map((account) => (account.id === purse ? { ...account, balance: account.balance + LOST_SUM } : account)),
        transactions: [...world.material.transactions, {
          id: `refund-passage-${gameId}`.slice(0, 120), atStep, kind: "transfer", amount: LOST_SUM, destinationAccountId: purse,
          cause: { kind: "action", id: `repair-${gameId}`.slice(0, 120), explanation: "Returned: the 1,000 spent to see the fleet passed reached nobody, and the vote failed." }, visibility: "private",
        }],
      } };
      report.returnedToPurse = { purse, amount: LOST_SUM };
    } else {
      report.returnedToPurse = { skipped: purse === undefined ? "no player purse" : "already recorded" };
    }

    // 7. This season's contingents, already sent.
    const allies = world.polityAgreements.filter((agreement) => agreement.status === "active" && agreement.kind === "foedus" && (agreement.polityId === "rome" || agreement.otherPolityId === "rome"))
      .map((agreement) => (agreement.polityId === "rome" ? agreement.otherPolityId : agreement.polityId));
    const lastWar = Math.max(0, ...world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active" && (agreement.polityId === "rome" || agreement.otherPolityId === "rome")).map((agreement) => agreement.sinceStep ?? 0));
    if (world.economy !== undefined && allies.length > 0) {
      const kept = world.economy.contingentsSent.filter((entry) => !allies.includes(entry.polityId));
      world = { ...world, economy: { ...world.economy, contingentsSent: [...kept, ...allies.map((polityId) => ({ polityId, atStep: lastWar }))].slice(-200) } };
    }
    report.contingentsMarkedSent = { allies, atStep: lastWar };

    const parsed = WorldStateSchema.parse(world);
    const introduced = findWorldReferenceViolations(parsed).length - findWorldReferenceViolations(before).length;
    console.log(JSON.stringify({ ...report, referenceViolationsIntroduced: introduced }, null, 2));
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
