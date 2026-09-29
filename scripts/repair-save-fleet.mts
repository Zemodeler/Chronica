/**
 * The fleet the Clepsina save paid for and never got (2026-09-28).
 *
 * - The "Initial transport and escort" contract hired a Campanian shipmaster
 *   with no company: 100 a month from the treasury, and not one hull. He gets
 *   the squadron his pay was for -- 40 transports, about what the Republic
 *   pays to victual that many (it keeps 18 allied hulls on 40 a month) --
 *   mustered where he was hired, beside Legio I.
 * - "Authorize construction of a limited Roman fleet" is withdrawn: the Senate
 *   carried the same question 119 to 0 on 22 April.
 * - "Provision Messana through the strait" was the Republic's convoy and was
 *   charged to the consul's own purse, because the tick dropped the chest it
 *   named; the treasury pays him back.
 *
 *   tsx --env-file=.env.local scripts/repair-save-fleet.mts <gameId>                          # dry run
 *   BACKUP_DIR=<dir> tsx --env-file=.env.local scripts/repair-save-fleet.mts <gameId> --apply  # writes it, after saving a backup
 */
import { writeFileSync } from "node:fs";
import { createDatabase, getWorldView, persistRepairedWorld } from "@chronica/db";
import { WorldStateSchema, findWorldReferenceViolations, type WorldState } from "@chronica/shared";

const HULLS = 40;
const DUPLICATE_LABEL = "Authorize construction of a limited Roman fleet";
const CONVOY_LABEL = "Provision Messana through the strait";

async function main(): Promise<void> {
  const [gameId, flag] = process.argv.slice(2);
  if (gameId === undefined) throw new Error("Usage: repair-save-fleet.mts <gameId> [--apply]");
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

    // 1. The shipmaster's company.
    const contract = world.material.contracts.find((candidate) => candidate.role === "mercenary" && candidate.status === "active" && candidate.forceId === null && /transport/i.test(candidate.label));
    if (contract !== undefined) {
      const captain = world.characters.find((character) => character.id === contract.employeeCharacterId)!;
      const hirer = world.material.accounts.find((account) => account.id === contract.employerAccountId)!;
      const polityId = hirer.owner.kind === "polity" ? hirer.owner.id : captain.polityId!;
      const controller = world.material.forces.find((force) => force.id === "roman-field-army")?.controllerCharacterId ?? captain.id;
      const forceId = `${contract.id}-company`;
      const locationId = contract.provinceId ?? captain.locationProvinceId;
      world = { ...world, material: { ...world.material,
        forces: [...world.material.forces, {
          id: forceId, name: "Campanian transports", polityId, commanderCharacterId: captain.id, controllerCharacterId: controller,
          locationId, positionId: null, authorizedStrength: HULLS,
          personnel: [{ categoryId: "warship", label: "Warships", fit: HULLS, unavailable: [] }],
          moraleBps: 6_000, cohesionBps: 5_000, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: atStep + 30,
          payObligationId: contract.obligationId, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
        }],
        accounts: [...world.material.accounts, {
          id: `${forceId}-chest`, owner: { kind: "force", id: forceId }, currencyId: world.material.currency.id, balance: 0, status: "active", visibility: "polity",
        }],
        contracts: world.material.contracts.map((candidate) => (candidate.id === contract.id
          ? { ...candidate, forceId, forceWas: { polityId: captain.polityId ?? polityId, controllerCharacterId: captain.id } }
          : candidate)),
      } };
      report.company = { contract: contract.id, forceId, hulls: HULLS, carries: HULLS * 30, at: locationId, controller };
    }

    // 2. The fleet question asked twice.
    const carried = world.material.politicalProcedures.find((procedure) => procedure.outcome === "passed" && /fleet/i.test(procedure.label));
    const again = world.material.politicalProcedures.find((procedure) => procedure.label === DUPLICATE_LABEL && procedure.outcome === null);
    if (carried !== undefined && again !== undefined) {
      world = { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((procedure) => (procedure.id === again.id
        ? { ...procedure, stage: "withdrawn", outcome: "withdrawn", outcomeReason: `Withdrawn: the Senate had already carried "${carried.label}".`, resolvedAtStep: atStep }
        : procedure)) } };
      report.withdrawn = again.id;
    }

    // 3. The convoy's cost, back to the purse that should not have paid it.
    const convoy = world.projects.find((project) => project.label === CONVOY_LABEL);
    if (convoy !== undefined) {
      const paid = world.material.transactions.filter((transaction) => transaction.cause.kind === "project_milestone" && transaction.cause.id === convoy.id && transaction.sourceAccountId !== undefined);
      const purse = paid[0]?.sourceAccountId;
      const owner = world.material.accounts.find((account) => account.id === purse)?.owner;
      const sum = paid.reduce((total, transaction) => total + transaction.amount, 0);
      if (purse !== undefined && owner?.kind === "character" && sum > 0) {
        world = { ...world, material: { ...world.material,
          accounts: world.material.accounts.map((account) => (account.id === purse ? { ...account, balance: account.balance + sum }
            : account.id === "rome-treasury" ? { ...account, balance: account.balance - sum } : account)),
          transactions: [...world.material.transactions, {
            id: `refund-${convoy.id}`.slice(0, 120), atStep, kind: "transfer", amount: sum, sourceAccountId: "rome-treasury", destinationAccountId: purse,
            cause: { kind: "project_milestone", id: convoy.id, explanation: "The Republic's convoy, paid back to the consul who was charged for it." }, visibility: "polity",
          }],
        } };
        report.refunded = { purse, sum };
      }
    }

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
