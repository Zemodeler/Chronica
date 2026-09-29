/**
 * The Clepsina save as December 270 left it (2026-09-28), put right where the
 * engine fixes of the same day cannot reach back.
 *
 * - Rome's two standing orders get the scenario's new names: "The patrician
 *   houses" and "The plebeian new men". Faction and interest groups take theirs
 *   at the next monthly review of society, which also re-seats the chamber.
 * - The deliberation "for a larger army" was opened before no chamber, at its
 *   sponsor's discretion, with no day set; the consul's petition was folded
 *   into it. It goes before the Senate, to be voted on in 20 days.
 * - Carthage's protectorate over the Mamertines was written backwards and
 *   while Rome's already stood. It is ended; the war over Messana is not.
 * - The Anio waterworks finished twice with no province and left nothing.
 *   The later one's building stands now, in its sponsor's capital.
 *
 *   tsx --env-file=.env.local scripts/repair-save-december.mts <gameId>                          # dry run
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/repair-save-december.mts <gameId> --apply  # writes it, after saving a backup
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldStateSchema, findWorldReferenceViolations, type WorldState } from "@chronica/shared";
import { sovereignChamberOf } from "../packages/sim/src/constitutions";
import { MOTION_VOTING_DAYS } from "../packages/sim/src/senate";
import { structureSite } from "../packages/sim/src/tick";

const RENAMED: Record<string, string> = { "Patrician bloc": "The patrician houses", "Popular bloc": "The plebeian new men" };
const OPEN = new Set(["drafting", "gathering_support", "voting_or_deciding"]);

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: repair-save-december.mts <gameId> [--apply]");
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

    // 1. The standing orders' names.
    const renamed: string[] = [];
    world = { ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => ({
      ...institution,
      votingBlocs: institution.votingBlocs.map((bloc) => {
        const name = RENAMED[bloc.name];
        if (name === undefined) return bloc;
        renamed.push(`${institution.id}: ${bloc.name} -> ${name}`);
        return { ...bloc, name };
      }),
    })) } };
    report.renamed = renamed;

    // 2. Deliberations about the state, stranded before no chamber.
    const routed: string[] = [];
    world = { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((procedure) => {
      if (procedure.type !== "council_deliberation" || procedure.institutionId !== null || procedure.subjectKind !== "polity" || !OPEN.has(procedure.stage)) return procedure;
      const polityId = procedure.subjectId ?? world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.polityId ?? null;
      const chamber = polityId === null ? null : sovereignChamberOf(world, polityId);
      if (chamber === null) return procedure;
      routed.push(`${procedure.label} -> ${chamber.name}, vote on day ${atStep + MOTION_VOTING_DAYS}`);
      return { ...procedure, institutionId: chamber.id, resolutionMechanism: "vote" as const, deadlineStep: atStep + MOTION_VOTING_DAYS };
    }) } };
    report.routed = routed;

    // 3. The second protector.
    const ended: string[] = [];
    world = { ...world, polityAgreements: world.polityAgreements.map((agreement) => {
      if (agreement.kind !== "protectorate" || agreement.status !== "active") return agreement;
      const client = agreement.polityId === "mamertines" ? null : agreement.otherPolityId === "mamertines" ? agreement.polityId : null;
      const romeHolds = world.polityAgreements.some((other) => other.id !== agreement.id && other.kind === "protectorate" && other.status === "active" && other.polityId === "mamertines" && other.otherPolityId === "rome");
      if (client !== "carthage" || !romeHolds) return agreement;
      ended.push(agreement.id);
      return { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: "Messana was already under Rome's protection; nobody is protected by two powers at once." };
    }) };
    report.protectoratesEnded = ended;

    // 4. The Anio waterworks that finished and left nothing.
    const unbuilt = world.projects
      .filter((project) => project.status === "completed" && project.completionOutcome?.kind === "structure"
        && !world.structures.some((structure) => structure.provenanceProjectId === project.id))
      .sort((a, b) => (b.completedAtStep ?? 0) - (a.completedAtStep ?? 0));
    const last = unbuilt[0];
    if (last !== undefined && last.completionOutcome?.kind === "structure") {
      const outcome = last.completionOutcome;
      const site = structureSite(world, last, outcome.provinceId, outcome.polityId);
      if (site !== null) {
        const effects = outcome.effects ?? [];
        world = { ...world, structures: [...world.structures, {
          id: `structure-repair-${last.id}`.slice(0, 120),
          kind: outcome.structureKind ?? "other",
          name: outcome.label,
          provinceId: site.provinceId,
          settlementId: site.settlementId,
          ownerPolityId: site.polityId,
          garrisonCapacity: outcome.amount,
          defensiveEffectsBps: 0,
          supplyRadius: 0,
          builtAtStep: last.completedAtStep ?? atStep,
          provenanceProjectId: last.id,
          effects: [...effects],
          upkeep: outcome.upkeep ?? null,
        }] };
        report.built = { project: last.label, structure: outcome.label, provinceId: site.provinceId };
      }
    }
    report.unbuiltProjects = unbuilt.map((project) => project.label);

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
