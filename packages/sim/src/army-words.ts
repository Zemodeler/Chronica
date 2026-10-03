import {
  bodiesInWords,
  doctrinesOf,
  formationOf,
  isCombatDoctrine,
  formationTemplateOf,
  qualityInWords,
  unitsOf,
  type Character,
  type Doctrine,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { campaignsOf } from "./ranks";

/**
 * Armies and the men in them, said the way the record says them
 * (docs/plans/armies-in-detail.md). The model is told an army's make in a
 * line -- two legions and two alae, steady, fighting by the triplex acies --
 * and never its maniples: an order to attack is one order. Only the man the
 * story is about is told his own place in the ranks, because it is his.
 */

const establishmentOf = (world: WorldState, polityId: string) => world.establishments.find((candidate) => candidate.polityId === polityId);

/** What the men of an army are, weighted by head. */
function qualityOf(force: Force): string | null {
  const formations = force.formations ?? [];
  const men = force.personnel.reduce((sum, row) => sum + row.fit, 0);
  if (formations.length === 0 || men <= 0) return null;
  let training = 0;
  let experience = 0;
  for (const row of force.personnel) {
    const formation = formationOf(force, row.formationId);
    if (formation === undefined) continue;
    training += formation.trainingBps * row.fit;
    experience += formation.experienceBps * row.fit;
  }
  return qualityInWords(training / men, experience / men);
}

/**
 * The doctrines that reach some of an army's men: its power's that apply to
 * its formations, and its own. The triplex acies is not a fleet's.
 */
export function doctrinesReaching(world: WorldState, force: Force): Doctrine[] {
  const context = { establishments: world.establishments, doctrines: world.doctrines, today: world.elapsedStep };
  const seen = new Map<string, Doctrine>();
  for (const row of force.personnel) for (const doctrine of doctrinesOf(context, force, row)) seen.set(doctrine.id, doctrine);
  return [...seen.values()];
}

/** An army's make in one line, or null for one with no formations. */
export function armyInWords(world: WorldState, force: Force): string | null {
  const establishment = establishmentOf(world, force.polityId);
  const bodies = bodiesInWords(force, establishment);
  if (bodies === null) return null;
  const today = world.elapsedStep;
  const doctrines = doctrinesReaching(world, force);
  const fights = doctrines.filter(isCombatDoctrine).map((doctrine) => `${doctrine.label} [${doctrine.id}]`);
  const keeps = doctrines.filter((doctrine) => !isCombatDoctrine(doctrine)).map((doctrine) => `${doctrine.label} [${doctrine.id}]`);
  const refitting = (force.formations ?? []).filter((formation) => formation.refitUntilStep !== undefined && formation.refitUntilStep > today);
  return [
    bodies,
    qualityOf(force),
    fights.length === 0 ? null : `fights by ${fights.join(", ")}`,
    keeps.length === 0 ? null : `kept by ${keeps.join(", ")}`,
    force.drilling === true ? "drilling" : null,
    refitting.length === 0 ? null : `${[...new Set(refitting.map((formation) => formation.bodyLabel))].join(", ")} refitting`,
  ].filter((part): part is string => part !== null).join("; ");
}

/**
 * Where a man stands in his army: his formation and unit, his rank, the
 * officer over him, the men beside him, and the campaigns behind him and
 * still owed. Ids are given where an order would have to name them.
 */
export function serviceInWords(world: WorldState, character: Character): string | null {
  const service = character.service;
  if (service === undefined) return null;
  if (service.forceId === null || service.formationId === null) {
    return service.dischargedAtStep === undefined ? null : `Discharged after ${campaignsOf(character)} campaigns${service.dischargeClaim === "land" ? ", and owed land" : service.dischargeClaim === "cash" ? ", and owed a bounty" : ""}.`;
  }
  const force = world.material.forces.find((candidate) => candidate.id === service.forceId);
  const formation = force === undefined ? undefined : formationOf(force, service.formationId);
  if (force === undefined || formation === undefined) return null;
  const establishment = establishmentOf(world, force.polityId);
  const template = formationTemplateOf(establishment, formation.templateId);
  const rank = establishment?.ranks.find((candidate) => candidate.id === service.rankId);
  const fit = force.personnel.find((row) => row.formationId === formation.id)?.fit ?? 0;
  const unit = service.unitIndex === null ? undefined : unitsOf(formation, template, fit)[service.unitIndex];
  const name = (id: string): string => `${world.characters.find((candidate) => candidate.id === id)?.name ?? id} [${id}]`;
  const officers = (force.posts ?? [])
    .filter((post) => post.characterId !== character.id && post.formationId === formation.id && (post.unitIndex === service.unitIndex || post.unitIndex === null))
    .map((post) => `${establishment?.ranks.find((candidate) => candidate.id === post.rankId)?.label ?? post.rankId} ${name(post.characterId)}`);
  const comrades = force.memberCharacterIds.filter((id) => {
    if (id === character.id) return false;
    const other = world.characters.find((candidate) => candidate.id === id && candidate.alive)?.service;
    return other?.formationId === formation.id && other.unitIndex === service.unitIndex && !(force.posts ?? []).some((post) => post.characterId === id);
  });
  const owed = formation.line === "wing" ? establishment?.serviceCampaigns.horse : establishment?.serviceCampaigns.foot;
  const doing = { steady: "means to keep his place in the line", glory: "means to win glory in the next battle", cautious: "means to keep his head down in the next battle" }[service.conduct];
  return [
    `Serves as ${rank?.label ?? "a soldier"} in ${unit === undefined ? "" : `${unit.label} (${unit.fit} men) of `}the ${template?.label ?? formation.bodyLabel} of ${formation.bodyLabel} [formation ${formation.id}], ${force.name} [${force.id}].`,
    officers.length === 0 ? "" : ` Over him: ${officers.join("; ")}.`,
    comrades.length === 0 ? "" : ` Beside him: ${comrades.map(name).join(", ")}.`,
    ` ${campaignsOf(character)} campaigns${owed === undefined ? "" : ` of ${owed} owed`}, ${service.battles} battles, ${service.wounds} wounds.`,
    service.decorations.length === 0 ? "" : ` Decorated: ${service.decorations.map((entry) => entry.label).join(", ")}.`,
    service.punishments.length === 0 ? "" : ` Punished: ${service.punishments.map((entry) => entry.label).join(", ")}.`,
    ` He ${doing}.`,
  ].join("");
}
