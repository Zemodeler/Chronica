import {
  currentAgeYears,
  familyLinksOf,
  readDepartments,
  type Character,
  type Project,
  type WorldState,
} from "@chronica/shared";
import { assessExecution, domainOfWork, leverForDomain } from "./delegation";

/**
 * Who has charge of a piece of work, when the order named nobody.
 *
 * A consul who ordered a fleet, a survey of Messana's walls and a levy in
 * Picenum had to put a man over each of them himself, or nobody was: a
 * project was a clock with milestones and no hands, and one that raised a
 * force and named no commander finished into nothing at all. A ruler does
 * not run his works one by one. He has men for that, and the man the work
 * falls to is the one whose business it is:
 *
 *  - an army's march is its commander's;
 *  - a power's work (sponsored by it, or paid from its chest) goes to the
 *    head of the department that does that kind of work, and where it has
 *    none, to the ablest of its office-holders not already buried in work;
 *  - a private man's work goes to his steward or engineer, then to a grown
 *    son or brother, then to himself.
 *
 * The player is never handed a power's work by the engine, as he is never
 * handed an office by it. His own private works may fall to him, which is
 * only saying that nobody else is there to do them.
 */

/** What each open project already on a man's hands costs his score for the next. */
const LOAD_PENALTY = 12;
/** Young enough and a man is not put over a public work. */
const MIN_OVERSEER_AGE = 20;
const OPEN: ReadonlySet<Project["status"]> = new Set(["proposed", "funded", "in_progress"]);

type ProjectShape = Pick<Project, "kind" | "label" | "sponsorEntityRef" | "completionOutcome"> & { readonly fundingAccountId?: string | null | undefined };

/** The power whose work this is, if it is one's: its sponsor, or the chest it is paid from. */
export function polityOfWork(world: WorldState, project: ProjectShape): string | null {
  if (project.sponsorEntityRef.kind === "polity") return project.sponsorEntityRef.id;
  const owner = project.fundingAccountId == null ? undefined : world.material.accounts.find((account) => account.id === project.fundingAccountId)?.owner;
  return owner?.kind === "polity" ? owner.id : null;
}

function loadOf(world: WorldState): Map<string, number> {
  const load = new Map<string, number>();
  for (const project of world.projects) {
    if (!OPEN.has(project.status) || project.overseerCharacterId == null) continue;
    load.set(project.overseerCharacterId, (load.get(project.overseerCharacterId) ?? 0) + 1);
  }
  return load;
}

const grown = (world: WorldState, character: Character): boolean =>
  character.alive && currentAgeYears(character, world.elapsedStep) >= MIN_OVERSEER_AGE;

export function chooseOverseer(
  world: WorldState,
  project: ProjectShape,
  playerCharacterId: string | null,
  load: ReadonlyMap<string, number> = loadOf(world),
): string | null {
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const outcome = project.completionOutcome;

  // A march is its army's, and nobody else's.
  if (outcome?.kind === "force_move" && outcome.forceId !== null) {
    return world.material.forces.find((force) => force.id === outcome.forceId)?.commanderCharacterId ?? null;
  }

  const domain = domainOfWork(project.kind, project.label);
  const score = (character: Character): number => {
    const hand = assessExecution(world, character.id, domain);
    if (hand === null) return Number.NEGATIVE_INFINITY;
    // Able first, honest second, and not a man already carrying three works.
    return hand.competence + (hand.fidelity - 50) / 5 - LOAD_PENALTY * (load.get(character.id) ?? 0);
  };
  const best = (candidates: readonly Character[]): Character | null =>
    [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0] ?? null;

  const sponsor = project.sponsorEntityRef;
  const polityId = polityOfWork(world, project);
  // A man who put his own name to a work does it himself -- unless he is the
  // player and it is his power's work, which is what he has officers for.
  if (sponsor.kind === "character" && sponsor.id !== playerCharacterId && byId.get(sponsor.id)?.alive === true) return sponsor.id;

  if (polityId !== null) {
    const departments = readDepartments(world);
    const head = departments.holding({ kind: "polity", id: polityId }, leverForDomain(domain)).head;
    if (head !== null && head.id !== playerCharacterId && grown(world, head)) return head.id;
    const seated = new Set(world.material.officeSeats
      .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null)
      .map((seat) => seat.holderCharacterId!));
    const officers = world.characters.filter((character) =>
      character.polityId === polityId && character.id !== playerCharacterId && seated.has(character.id) && grown(world, character));
    const chosen = best(officers);
    if (chosen !== null) return chosen.id;
  }

  if (sponsor.kind !== "character") return null;
  const owner = byId.get(sponsor.id);
  if (owner === undefined || !owner.alive) return null;
  // His own people: whoever he pays to run his affairs or build for him.
  const hired = new Set(world.material.contracts
    .filter((contract) => contract.status === "active"
      && (contract.role === "steward" || contract.role === "engineer" || contract.role === "agent")
      && contract.employerAccountId === owner.personalAccountId)
    .map((contract) => contract.employeeCharacterId));
  const staff = best(world.characters.filter((character) => hired.has(character.id) && grown(world, character)));
  if (staff !== null) return staff.id;
  // Then the family.
  const kin = new Set(familyLinksOf(world, owner.id, world.elapsedStep)
    .filter((link) => link.kind === "parent" || link.kind === "sibling")
    .map((link) => link.counterpartCharacterId));
  const family = best(world.characters.filter((character) => kin.has(character.id) && character.id !== playerCharacterId && grown(world, character)));
  if (family !== null && score(family) > score(owner)) return family.id;
  return owner.id;
}

/**
 * Puts a man over every open work that has none, or whose man has died or
 * gone over to another power. Run once a day, after the day's work is done.
 *
 * Silent: a clerk being given the survey of Messana's walls is not history,
 * and the Chronicle has had enough one-line entries. It shows where the work
 * does -- in the orders under way, and in what the model is told of it.
 */
export function assignOverseers(world: WorldState, playerCharacterId: string | null): WorldState {
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const load = loadOf(world);
  let changed = false;
  const projects = world.projects.map((project) => {
    if (!OPEN.has(project.status)) return project;
    const current = project.overseerCharacterId == null ? undefined : byId.get(project.overseerCharacterId);
    const polityId = polityOfWork(world, project);
    const stillFit = current !== undefined && current.alive && (polityId === null || current.polityId === polityId || project.sponsorEntityRef.id === current.id);
    if (stillFit) return project;
    if (current !== undefined) load.set(current.id, Math.max(0, (load.get(current.id) ?? 1) - 1));
    const chosen = chooseOverseer(world, project, playerCharacterId, load);
    if (chosen === (project.overseerCharacterId ?? null)) return project;
    if (chosen !== null) load.set(chosen, (load.get(chosen) ?? 0) + 1);
    changed = true;
    return { ...project, overseerCharacterId: chosen };
  });
  return changed ? { ...world, projects } : world;
}
