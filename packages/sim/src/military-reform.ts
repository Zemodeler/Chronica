import {
  boundedId,
  formArmies,
  isCombatDoctrine,
  unitCountOf,
  type BodyTemplate,
  type Force,
  type ForceFormation,
  type ForcePersonnelCategory,
  type FormationLine,
  type FormationTemplate,
  type MilitaryEstablishment,
  type MilitaryReform,
  type WorldState,
} from "@chronica/shared";
import { doctrineFrom, refitFor } from "./apply/army-practice";

/**
 * A power's armies remade by law (docs/plans/armies-in-detail.md).
 *
 * The Marian reforms are the measure of what this has to carry, not a menu
 * item: the head count enrolled, the state arming them, the maniple given up
 * for the cohort, the eagle, land for the men who served. Every one of those
 * is here as a part -- a doctrine adopted, the recruitment changed, the
 * equipment, the terms of service, a body redrawn -- and a player may put
 * together any other reform from the same parts.
 *
 * Nothing is remade in a day. Formations a new way of fighting reaches are
 * refitted over months (`refitFor`); a body redrawn keeps its men and its
 * years, loses much of its drill, and learns the new order in winter quarters;
 * new levies come in the new form.
 */

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, "").slice(0, 40) || "reform";

/** What a body redrawn keeps of its drill: the men know their trade, not yet the new order. */
const DRILL_KEPT_IN_REDRAWING = 0.6;
const REDRAWING_REFIT_DAYS = 120;

function lineOfCategory(categoryId: string): FormationLine {
  if (/warship|ship|fleet|quinquereme|trireme/u.test(categoryId)) return "afloat";
  if (/cavalry|horse|elephant/u.test(categoryId)) return "wing";
  if (/light|slinger|archer|skirmish/u.test(categoryId)) return "screen";
  return "first";
}

/**
 * The establishment a power has, or the plainest one there could be, made
 * from the armies it already keeps: one host, a formation for each kind of
 * troops in it. A power with no establishment can still reform its armies.
 */
export function establishmentOrPlain(world: WorldState, polityId: string): MilitaryEstablishment {
  const existing = world.establishments.find((establishment) => establishment.polityId === polityId);
  if (existing !== undefined) return existing;
  const kinds = [...new Set(world.material.forces.filter((force) => force.polityId === polityId).flatMap((force) => force.personnel.map((row) => row.categoryId)))];
  const categories = kinds.length === 0 ? ["infantry"] : kinds;
  const formations: FormationTemplate[] = categories.map((categoryId) => ({
    id: `${polityId}-host-${categoryId}`.slice(0, 120),
    label: categoryId === "infantry" ? "Foot" : categoryId === "cavalry" ? "Horse" : categoryId.replace(/[-_]/gu, " "),
    categoryId,
    line: lineOfCategory(categoryId),
    men: lineOfCategory(categoryId) === "afloat" ? 60 : 4_000,
    units: lineOfCategory(categoryId) === "afloat" ? { label: "ship", size: 1 } : { label: "company", size: 100 },
  }));
  const name = world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
  return {
    polityId,
    label: `The host of ${name}`,
    bodies: [{ id: `${polityId}-host`.slice(0, 120), label: "Host", naming: `{n} host of ${name}`.slice(0, 80), numerals: "ordinal", source: "citizen", matches: [], isDefault: true, formationIds: formations.map((template) => template.id) }],
    formations,
    ranks: [],
    honours: [],
    recruitment: { basis: "citizens", floor: "none", standing: false },
    equipment: "self",
    serviceCampaigns: { foot: 16, horse: 10 },
    discharge: "none",
    campaignsForOffice: 0,
    doctrineIds: [],
    numbered: {},
  };
}

function treasuryOf(world: WorldState, polityId: string): string | null {
  return world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active")?.id ?? null;
}

export function carryOutMilitaryReform(
  world: WorldState,
  polityId: string,
  reform: MilitaryReform,
  atStep: number,
  sponsorId: string | null,
  procedureId: string,
): { readonly world: WorldState; readonly said: string[] } {
  const said: string[] = [];
  let establishment = establishmentOrPlain(world, polityId);
  const isNew = !world.establishments.some((candidate) => candidate.polityId === polityId);
  let next = world;
  let doctrines = world.doctrines;

  // Ways of war brought in, at the state's charge.
  for (const proposal of reform.adopt ?? []) {
    const id = boundedId(polityId, "reform", slug(proposal.label));
    const doctrine = doctrineFrom(proposal, { id, origin: "reform", polityId, forceId: null, upkeepAccountId: treasuryOf(next, polityId), atStep, byCharacterId: sponsorId });
    doctrines = [...doctrines.filter((candidate) => candidate.id !== id), doctrine].slice(-400);
    establishment = { ...establishment, doctrineIds: [...establishment.doctrineIds.filter((candidate) => candidate !== id), id].slice(-24) };
    if (isCombatDoctrine(doctrine)) {
      next = { ...next, material: { ...next.material, forces: next.material.forces.map((force) => (force.polityId === polityId ? refitFor(force, doctrine, atStep) : force)) } };
    }
    said.push(`${proposal.label} is adopted`);
  }
  // And ways given up.
  for (const dropped of reform.drop ?? []) {
    if (!establishment.doctrineIds.includes(dropped)) continue;
    establishment = { ...establishment, doctrineIds: establishment.doctrineIds.filter((candidate) => candidate !== dropped) };
    doctrines = doctrines.map((candidate) => (candidate.id === dropped && candidate.lapsedAtStep === null ? { ...candidate, lapsedAtStep: atStep } : candidate));
    said.push(`${doctrines.find((candidate) => candidate.id === dropped)?.label ?? dropped} is given up`);
  }
  // Whom it calls, how it arms them, how long they serve and what they are owed.
  if (reform.recruit !== undefined || reform.standing !== undefined) {
    establishment = {
      ...establishment,
      recruitment: {
        ...establishment.recruitment,
        ...(reform.recruit === undefined ? {} : { basis: reform.recruit, floor: reform.recruit === "volunteers" || reform.recruit === "citizens" ? "none" as const : establishment.recruitment.floor }),
        ...(reform.standing === undefined ? {} : { standing: reform.standing }),
      },
    };
    said.push(`its armies are raised ${recruitmentInWords(establishment.recruitment)}`);
  }
  if (reform.stateArms !== undefined) {
    establishment = { ...establishment, equipment: reform.stateArms ? "state" : "self" };
    said.push(reform.stateArms ? "the state arms its soldiers" : "its soldiers arm themselves");
  }
  if (reform.campaigns !== undefined) {
    establishment = { ...establishment, serviceCampaigns: { foot: reform.campaigns, horse: Math.max(1, Math.round((reform.campaigns * 5) / 8)) } };
    said.push(`a soldier owes ${establishment.serviceCampaigns.foot} campaigns on foot and ${establishment.serviceCampaigns.horse} on horse`);
  }
  if (reform.discharge !== undefined) {
    establishment = { ...establishment, discharge: reform.discharge };
    said.push(reform.discharge === "land" ? "discharged soldiers are owed land" : reform.discharge === "cash" ? "discharged soldiers are owed a bounty" : "discharged soldiers are owed nothing");
  }
  next = { ...next, doctrines, establishments: [...next.establishments.filter((candidate) => candidate.polityId !== polityId), establishment] };

  if (reform.redraw !== undefined) {
    const redrawn = redrawBody(next, polityId, reform.redraw, atStep, procedureId);
    next = redrawn.world;
    if (redrawn.said !== null) said.push(redrawn.said);
  }
  // A power that had none now draws up its armies the plain way.
  if (isNew) next = formArmies(next, atStep);
  return { world: next, said };
}

function recruitmentInWords(recruitment: MilitaryEstablishment["recruitment"]): string {
  const basis: Record<MilitaryEstablishment["recruitment"]["basis"], string> = {
    property_class: "from men of property", citizens: "from all its citizens", settlers: "from its military settlers",
    volunteers: "from volunteers, the poorest included", mercenary: "by hiring", subject_levy: "by levy on its subjects",
  };
  return `${basis[recruitment.basis]}${recruitment.standing ? ", and kept under the standards" : ", for the season"}`;
}

/**
 * One kind of body redrawn: its formations replaced, and every body of that
 * kind in every army re-formed into the new ones. Men are kept and so are
 * their years; much of their drill is not, and they refit through the
 * winter. Kinds of troops the new order has no place for stay as they were.
 */
function redrawBody(
  world: WorldState,
  polityId: string,
  plan: NonNullable<MilitaryReform["redraw"]>,
  atStep: number,
  procedureId: string,
): { readonly world: WorldState; readonly said: string | null } {
  const establishment = world.establishments.find((candidate) => candidate.polityId === polityId);
  const body = establishment?.bodies.find((candidate) => candidate.id === plan.bodyId);
  if (establishment === undefined || body === undefined) return { world, said: null };
  const templates: FormationTemplate[] = plan.formations.map((formation, index) => ({
    id: boundedId(body.id, slug(formation.label), procedureId.slice(-8), String(index)),
    label: formation.label,
    categoryId: formation.kind,
    line: formation.line,
    men: formation.men,
    units: { label: formation.unit, size: formation.size },
  }));
  const newCategories = new Set(templates.map((template) => template.categoryId));
  const oldTemplates = body.formationIds.map((id) => establishment.formations.find((template) => template.id === id)).filter((template): template is FormationTemplate => template !== undefined);
  const kept = oldTemplates.filter((template) => !newCategories.has(template.categoryId));
  const replaced = new Set(oldTemplates.filter((template) => newCategories.has(template.categoryId)).map((template) => template.id));
  const redrawnBody: BodyTemplate = { ...body, formationIds: [...templates.map((template) => template.id), ...kept.map((template) => template.id)].slice(0, 12) };
  const nextEstablishment: MilitaryEstablishment = {
    ...establishment,
    formations: [...establishment.formations, ...templates].slice(-40),
    bodies: establishment.bodies.map((candidate) => (candidate.id === body.id ? redrawnBody : candidate)),
  };

  const remap = new Map<string, string>();
  /** How many units each new formation has, so a man's unit maps into one that exists. */
  const unitsIn = new Map<string, number>();
  const forces = world.material.forces.map((force): Force => {
    if (force.polityId !== polityId) return force;
    const formations = force.formations ?? [];
    const affected = formations.filter((formation) => replaced.has(formation.templateId));
    if (affected.length === 0) return force;
    let rows: ForcePersonnelCategory[] = force.personnel.filter((row) => !affected.some((formation) => formation.id === row.formationId));
    let records: ForceFormation[] = formations.filter((formation) => !affected.includes(formation));
    for (const bodyId of new Set(affected.map((formation) => formation.bodyId))) {
      const instance = affected.filter((formation) => formation.bodyId === bodyId);
      const bodyLabel = instance[0]!.bodyLabel;
      for (const categoryId of newCategories) {
        const old = instance.filter((formation) => force.personnel.some((row) => row.formationId === formation.id && row.categoryId === categoryId));
        const oldRows = force.personnel.filter((row) => old.some((formation) => formation.id === row.formationId));
        const fit = oldRows.reduce((sum, row) => sum + row.fit, 0);
        const unavailable = oldRows.flatMap((row) => row.unavailable);
        if (fit <= 0 && unavailable.length === 0) continue;
        const men = old.reduce((sum, formation) => sum + (oldRows.find((row) => row.formationId === formation.id)?.fit ?? 0), 0) || 1;
        const training = old.reduce((sum, formation) => sum + formation.trainingBps * (oldRows.find((row) => row.formationId === formation.id)?.fit ?? 0), 0) / men;
        const experience = old.reduce((sum, formation) => sum + formation.experienceBps * (oldRows.find((row) => row.formationId === formation.id)?.fit ?? 0), 0) / men;
        const into = templates.filter((template) => template.categoryId === categoryId);
        const total = into.reduce((sum, template) => sum + template.men, 0) || 1;
        let placed = 0;
        into.forEach((template, index) => {
          const share = index === into.length - 1 ? fit - placed : Math.round((fit * template.men) / total);
          placed += share;
          const id = boundedId(bodyId, template.id);
          for (const formation of old) if (!remap.has(formation.id)) remap.set(formation.id, id);
          unitsIn.set(id, unitCountOf(template, share));
          records.push({
            id, bodyId, bodyLabel, templateId: template.id, line: template.line,
            trainingBps: Math.round(training * DRILL_KEPT_IN_REDRAWING), experienceBps: Math.round(experience),
            doctrineIds: [...new Set(old.flatMap((formation) => formation.doctrineIds))].slice(0, 8), units: [], raisedAtStep: atStep,
            refitUntilStep: atStep + REDRAWING_REFIT_DAYS,
          });
          rows.push({
            categoryId, label: `${template.label} of ${bodyLabel}`.slice(0, 80), fit: share,
            unavailable: index === 0 ? unavailable : [], formationId: id,
          });
        });
      }
    }
    records = records.slice(0, 40);
    if (rows.length === 0) rows = force.personnel;
    return {
      ...force,
      formations: records,
      personnel: rows,
      posts: (force.posts ?? []).map((post) => (remap.has(post.formationId) ? { ...post, formationId: remap.get(post.formationId)!, unitIndex: post.unitIndex === null ? null : post.unitIndex % (unitsIn.get(remap.get(post.formationId)!) ?? 1) } : post)),
    };
  });
  // The men's own records follow them into the new order.
  const characters = world.characters.map((character) => {
    const service = character.service;
    if (service?.formationId == null || !remap.has(service.formationId)) return character;
    const into = remap.get(service.formationId)!;
    return { ...character, service: { ...service, formationId: into, unitIndex: service.unitIndex === null ? null : service.unitIndex % (unitsIn.get(into) ?? 1) } };
  });
  return {
    world: {
      ...world,
      characters,
      establishments: world.establishments.map((candidate) => (candidate.polityId === polityId ? nextEstablishment : candidate)),
      material: { ...world.material, forces },
    },
    said: `the ${body.label.toLowerCase()} is redrawn as ${templates.map((template) => template.label).join(", ")}`,
  };
}
