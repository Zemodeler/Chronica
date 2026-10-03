import { boundedId } from "../determinism";
import type { Force, ForceFormation, ForcePersonnelCategory, FormationLine, SavedUnit } from "../material-state";
import type { ScenarioWarfareRules, TroopCategoryDefinition } from "./battle";
import {
  BASE_DRILL_CEILING_BPS,
  COHESION_PROTECTION_CAP_BPS,
  COMBAT_LEVERS,
  EXPERIENCE_STEADINESS_BPS,
  EXPERIENCE_STRENGTH_BPS,
  STRENGTH_EDGE_CAP_BPS,
  STRENGTH_EDGE_FLOOR_BPS,
  TRAINING_STEADINESS_BPS,
  TRAINING_STRENGTH_BPS,
  effectValue,
  type BodySource,
  type BodyTemplate,
  type Doctrine,
  type DoctrineLever,
  type FormationTemplate,
  type MilitaryEstablishment,
} from "./establishment";

/**
 * Armies made of formations (docs/plans/armies-in-detail.md).
 *
 * A personnel row *is* a formation's men: `formationId` on the row names its
 * record in `Force.formations`. So every reader that counts heads -- supply,
 * pay, sieges, the muster, the map -- goes on counting them exactly as it did,
 * and only the readers that care what the men are (the battle, drill, careers)
 * look at the formation.
 *
 * Nobody lists maniples. A levy, an allied contingent, a hired company or an
 * army raised by order arrives as a row of men; `formArmies` draws them up the
 * way their power's establishment says -- tops up the bodies it already has,
 * raises new ones and numbers them -- and an army a power keeps no
 * establishment for is left as the flat list it always was.
 */

/** The doctrines and establishments the engine reads with the scenario's rules. */
export interface WarfareContext {
  readonly establishments?: readonly MilitaryEstablishment[];
  readonly doctrines?: readonly Doctrine[];
  /** The day it is, for doctrines adopted and refits under way. */
  readonly today?: number;
}
export type WarfareRules = ScenarioWarfareRules & WarfareContext;

const FALLBACK_CATEGORY: Pick<TroopCategoryDefinition, "naval" | "mobilityBps"> = { naval: false, mobilityBps: 5_000 };

export function establishmentOf(context: WarfareContext | undefined, polityId: string): MilitaryEstablishment | undefined {
  return context?.establishments?.find((establishment) => establishment.polityId === polityId);
}

export function formationOf(force: Pick<Force, "formations">, formationId: string | undefined): ForceFormation | undefined {
  return formationId === undefined ? undefined : (force.formations ?? []).find((formation) => formation.id === formationId);
}

export function formationTemplateOf(establishment: MilitaryEstablishment | undefined, templateId: string): FormationTemplate | undefined {
  return establishment?.formations.find((template) => template.id === templateId);
}

export function bodyTemplateOf(establishment: MilitaryEstablishment | undefined, formationTemplateId: string): BodyTemplate | undefined {
  return establishment?.bodies.find((body) => body.formationIds.includes(formationTemplateId));
}

// ── Doctrine ──────────────────────────────────────────────────────────────

function isActive(doctrine: Doctrine, today: number | undefined): boolean {
  return doctrine.lapsedAtStep === null && (today === undefined || doctrine.adoptedAtStep <= today);
}

function appliesTo(doctrine: Doctrine, formation: ForceFormation | undefined, row: Pick<ForcePersonnelCategory, "categoryId">): boolean {
  const scope = doctrine.appliesTo;
  if (scope === undefined) return true;
  if (scope.formationIds !== undefined && (formation === undefined || !scope.formationIds.includes(formation.templateId))) return false;
  if (scope.lines !== undefined && (formation === undefined || !scope.lines.includes(formation.line))) return false;
  if (scope.categoryIds !== undefined && !scope.categoryIds.includes(row.categoryId)) return false;
  return true;
}

/**
 * The doctrines a formation fights by: its power's, and its own army's
 * practice. A formation being refitted has not yet learned what was brought in
 * after it was raised.
 */
export function doctrinesOf(context: WarfareContext | undefined, force: Pick<Force, "id" | "polityId" | "formations">, row: Pick<ForcePersonnelCategory, "categoryId" | "formationId">): readonly Doctrine[] {
  const all = context?.doctrines ?? [];
  if (all.length === 0) return [];
  const establishment = establishmentOf(context, force.polityId);
  const formation = formationOf(force, row.formationId);
  const today = context?.today;
  const refitting = formation?.refitUntilStep !== undefined && today !== undefined && formation.refitUntilStep > today;
  const own = new Set([...(establishment?.doctrineIds ?? []), ...(formation?.doctrineIds ?? [])]);
  return all.filter((doctrine) =>
    isActive(doctrine, today)
    && (own.has(doctrine.id) || doctrine.forceId === force.id)
    && (doctrine.polityId === force.polityId || doctrine.forceId === force.id)
    && appliesTo(doctrine, formation, row)
    && !(refitting && formation !== undefined && doctrine.adoptedAtStep > formation.raisedAtStep));
}

function sumLever(doctrines: readonly Doctrine[], lever: DoctrineLever): number {
  let total = 0;
  for (const doctrine of doctrines) for (const effect of doctrine.effects) if (effect.lever === lever) total += effectValue(effect);
  return total;
}

/**
 * A lever's total across a whole power: what its levies cost, how fast they
 * muster, how many may be called, how long they serve.
 */
export function polityLever(context: WarfareContext | undefined, polityId: string, lever: DoctrineLever): number {
  const establishment = establishmentOf(context, polityId);
  if (establishment === undefined) return 0;
  const today = context?.today;
  const own = new Set(establishment.doctrineIds);
  return sumLever((context?.doctrines ?? []).filter((doctrine) => own.has(doctrine.id) && isActive(doctrine, today) && doctrine.forceId === null), lever);
}

/**
 * A lever's total for one army: its power's doctrines and its own, as they
 * reach its men -- weighted by how many of them each reaches, so a doctrine for
 * the horse moves a march by what the horse are of the army.
 */
export function forceLever(context: WarfareContext | undefined, force: Pick<Force, "id" | "polityId" | "formations" | "personnel">, lever: DoctrineLever): number {
  const men = force.personnel.reduce((sum, row) => sum + row.fit, 0);
  if (men <= 0) return 0;
  let weighted = 0;
  for (const row of force.personnel) weighted += sumLever(doctrinesOf(context, force, row), lever) * row.fit;
  return weighted / men;
}

// ── What a formation is worth ─────────────────────────────────────────────

export interface FormationReading {
  readonly line: FormationLine;
  /** Added to what each man is worth in the field, in basis points, after the cap. */
  readonly strengthEdgeBps: number;
  /** Taken off the cohesion it loses under loss, in basis points, after the cap. */
  readonly protectionBps: number;
  readonly reliefBps: number;
  readonly roughGroundBps: number;
  readonly screenBps: number;
  readonly pursuitBps: number;
  readonly boardingBps: number;
  readonly trainingBps: number;
  readonly experienceBps: number;
  readonly refitting: boolean;
}

const NEUTRAL: Omit<FormationReading, "line"> = {
  strengthEdgeBps: 0, protectionBps: 0, reliefBps: 0, roughGroundBps: 0, screenBps: 0, pursuitBps: 0, boardingBps: 0, trainingBps: 0, experienceBps: 0, refitting: false,
};

/** Where men of no formation stand: ships afloat, horse on the wings, the rest in the line. */
export function lineForCategory(category: Pick<TroopCategoryDefinition, "naval" | "mobilityBps"> | undefined): FormationLine {
  const known = category ?? FALLBACK_CATEGORY;
  if (known.naval) return "afloat";
  if (known.mobilityBps >= 8_000) return "wing";
  return "first";
}

/** Less than this and a refitting formation is half in the old way and half in the new. */
const REFIT_PENALTY_BPS = 800;

export function readFormation(
  rules: WarfareRules | undefined,
  force: Pick<Force, "id" | "polityId" | "formations">,
  row: Pick<ForcePersonnelCategory, "categoryId" | "formationId">,
): FormationReading {
  const formation = formationOf(force, row.formationId);
  if (formation === undefined) {
    const category = rules?.troopCategories.find((candidate) => candidate.id === row.categoryId);
    return { line: lineForCategory(category), ...NEUTRAL };
  }
  const doctrines = doctrinesOf(rules, force, row);
  const today = rules?.today;
  const refitting = formation.refitUntilStep !== undefined && today !== undefined && formation.refitUntilStep > today;
  const strength = sumLever(doctrines, "frontal_weight")
    + (formation.trainingBps * TRAINING_STRENGTH_BPS) / 10_000
    + (formation.experienceBps * EXPERIENCE_STRENGTH_BPS) / 10_000
    - (refitting ? REFIT_PENALTY_BPS : 0);
  const protection = sumLever(doctrines, "steadiness")
    + (formation.trainingBps * TRAINING_STEADINESS_BPS) / 10_000
    + (formation.experienceBps * EXPERIENCE_STEADINESS_BPS) / 10_000;
  return {
    line: formation.line,
    strengthEdgeBps: Math.round(Math.max(STRENGTH_EDGE_FLOOR_BPS, Math.min(STRENGTH_EDGE_CAP_BPS, strength))),
    protectionBps: Math.round(Math.max(-COHESION_PROTECTION_CAP_BPS, Math.min(COHESION_PROTECTION_CAP_BPS, protection))),
    reliefBps: Math.max(0, sumLever(doctrines, "line_relief")),
    roughGroundBps: sumLever(doctrines, "rough_ground"),
    screenBps: sumLever(doctrines, "screen"),
    pursuitBps: sumLever(doctrines, "pursuit"),
    boardingBps: sumLever(doctrines, "boarding"),
    trainingBps: formation.trainingBps,
    experienceBps: formation.experienceBps,
    refitting,
  };
}

/** True when a doctrine moves something a battle reads. */
export function isCombatDoctrine(doctrine: Pick<Doctrine, "effects">): boolean {
  return doctrine.effects.some((effect) => COMBAT_LEVERS.has(effect.lever));
}

/** How good drill can make this formation. */
export function drillCeilingOf(rules: WarfareRules | undefined, force: Pick<Force, "id" | "polityId" | "formations">, row: Pick<ForcePersonnelCategory, "categoryId" | "formationId">): number {
  return Math.max(2_000, Math.min(10_000, BASE_DRILL_CEILING_BPS + sumLever(doctrinesOf(rules, force, row), "drill_ceiling")));
}

// ── Who takes the blows ───────────────────────────────────────────────────

/**
 * How much of a battle's loss falls on each line, against an even share.
 * The clash is the first line's; the second comes up when it tires; the third
 * is reached only when it has gone badly ("res ad triarios rediit"). The screen
 * has fought already at contact, and the horse on the wings fight their own
 * fight.
 */
export const ENGAGEMENT_EXPOSURE: Readonly<Record<FormationLine, number>> = {
  screen: 0.9,
  first: 1.35,
  second: 1,
  third: 0.45,
  wing: 0.75,
  reserve: 0.35,
  afloat: 1,
};

/** In a rout the slow are caught and the quick get away. */
export function pursuitExposure(category: Pick<TroopCategoryDefinition, "mobilityBps"> | undefined): number {
  return (category?.mobilityBps ?? 5_000) >= 8_000 ? 0.5 : 1.15;
}

// ── Units ─────────────────────────────────────────────────────────────────

export interface UnitReading {
  readonly index: number;
  readonly label: string;
  readonly fit: number;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
export function ordinalWord(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

export function romanNumeral(n: number): string {
  const table: readonly [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let left = Math.max(1, Math.floor(n));
  let out = "";
  for (const [value, glyph] of table) while (left >= value) { out += glyph; left -= value; }
  return out;
}

/** What an irregular formation divides into: companies of a hundred. */
const IRREGULAR_UNITS = { label: "company", size: 100 } as const;

export function unitCountOf(template: FormationTemplate | undefined, men: number): number {
  const units = template?.units ?? IRREGULAR_UNITS;
  if ("count" in units && units.count !== undefined) return units.count;
  const size = ("size" in units ? units.size : undefined) ?? IRREGULAR_UNITS.size;
  return Math.max(1, Math.min(200, Math.round(men / size)));
}

/**
 * The units of a formation, worked out from its template and its strength,
 * with the ones somebody has had cause to remember as they were recorded.
 * They always add up to the formation: a saved unit's men come out of the
 * share of the rest.
 */
export function unitsOf(formation: ForceFormation, template: FormationTemplate | undefined, fit: number): UnitReading[] {
  const label = template?.units.label ?? IRREGULAR_UNITS.label;
  const count = unitCountOf(template, fit + 0);
  const saved = new Map<number, SavedUnit>(formation.units.filter((unit) => unit.index < count).map((unit) => [unit.index, unit]));
  const savedMen = Math.min(fit, [...saved.values()].reduce((sum, unit) => sum + unit.fit, 0));
  const others = count - saved.size;
  const share = others <= 0 ? 0 : Math.floor((fit - savedMen) / others);
  let spare = others <= 0 ? 0 : (fit - savedMen) - share * others;
  const out: UnitReading[] = [];
  for (let index = 0; index < count; index += 1) {
    const kept = saved.get(index);
    const men = kept !== undefined ? Math.min(kept.fit, fit) : share + (spare > 0 ? 1 : 0);
    if (kept === undefined && spare > 0) spare -= 1;
    out.push({ index, label: kept?.name ?? `the ${ordinalWord(index + 1)} ${label}`, fit: men });
  }
  return out;
}

// ── Forming men ───────────────────────────────────────────────────────────

/** What men come to the standards with, by where they come from. Levied citizens are raw; a hired company is not. */
export const SOURCE_QUALITY: Readonly<Record<BodySource, { readonly trainingBps: number; readonly experienceBps: number }>> = {
  citizen: { trainingBps: 0, experienceBps: 0 },
  ally: { trainingBps: 1_000, experienceBps: 500 },
  mercenary: { trainingBps: 3_500, experienceBps: 3_500 },
  subject: { trainingBps: 500, experienceBps: 0 },
  settler: { trainingBps: 1_500, experienceBps: 1_000 },
  royal: { trainingBps: 4_000, experienceBps: 3_000 },
};

const WORD = /[^a-z]+/u;
const wordsOf = (text: string): string[] => text.toLowerCase().split(WORD).filter((word) => word.length > 1);

/** The body men are drawn up in: the one their name says they are, else the default for their kind of troops. */
export function chooseBody(establishment: MilitaryEstablishment, row: Pick<ForcePersonnelCategory, "categoryId" | "label">, forceName: string): BodyTemplate | undefined {
  const takes = establishment.bodies.filter((body) => body.formationIds.some((id) => formationTemplateOf(establishment, id)?.categoryId === row.categoryId));
  if (takes.length === 0) return undefined;
  const words = [...wordsOf(row.label), ...wordsOf(forceName)];
  const named = (body: BodyTemplate): boolean => body.matches.some((match) => words.some((word) => word.startsWith(match.toLowerCase())));
  // The row's own name first: "Allied infantry" in the Roman field army is allies, whatever the army is called.
  const byRow = takes.find((body) => body.matches.some((match) => wordsOf(row.label).some((word) => word.startsWith(match.toLowerCase()))));
  return byRow ?? takes.find(named) ?? takes.find((body) => body.isDefault) ?? takes[0];
}

/** One body's name: "Legio II", "the third Ala of the allies". */
export function bodyName(body: BodyTemplate, n: number): string {
  const numeral = body.numerals === "roman" ? romanNumeral(n) : body.numerals === "ordinal" ? ordinalWord(n) : "";
  return body.naming.replace("{n}", numeral).replace(/\s+/gu, " ").trim().slice(0, 80);
}

/** Men split between several places, the fit and each band of the not-yet-fit alike, adding up exactly. */
function splitRow(row: ForcePersonnelCategory, counts: readonly number[]): { fit: number; unavailable: ForcePersonnelCategory["unavailable"] }[] {
  const total = row.fit + row.unavailable.reduce((sum, group) => sum + group.count, 0);
  if (total <= 0 || counts.length === 0) return counts.map(() => ({ fit: 0, unavailable: [] }));
  const shareOf = (whole: number): number[] => {
    const parts = counts.map((count) => Math.floor((whole * count) / total));
    let left = whole - parts.reduce((sum, part) => sum + part, 0);
    for (let index = parts.length - 1; index >= 0 && left > 0; index -= 1) { parts[index] = parts[index]! + 1; left -= 1; }
    return parts;
  };
  const fits = shareOf(row.fit);
  const groups = row.unavailable.map((group) => shareOf(group.count));
  return counts.map((_, at) => ({
    fit: fits[at]!,
    unavailable: row.unavailable.flatMap((group, g) => (groups[g]![at]! > 0 ? [{ ...group, id: boundedId(group.id, String(at)), count: groups[g]![at]! }] : [])),
  }));
}

const menIn = (row: Pick<ForcePersonnelCategory, "fit" | "unavailable">): number => row.fit + row.unavailable.reduce((sum, group) => sum + group.count, 0);

/** Experience and drill when new men join old: averaged by head, the new bringing what they bring. */
function blend(formation: ForceFormation, oldMen: number, newMen: number, quality: { trainingBps: number; experienceBps: number }): ForceFormation {
  const total = oldMen + newMen;
  if (total <= 0 || newMen <= 0) return formation;
  return {
    ...formation,
    trainingBps: Math.round((formation.trainingBps * oldMen + quality.trainingBps * newMen) / total),
    experienceBps: Math.round((formation.experienceBps * oldMen + quality.experienceBps * newMen) / total),
  };
}

export interface FormingHints {
  /** What the men of an army already in the world have behind them, where they are not raw: the scenario's veterans of Pyrrhus. */
  readonly seasoned?: (force: Force, row: ForcePersonnelCategory) => { trainingBps: number; experienceBps: number } | undefined;
}

/**
 * Draws up every army's unformed men the way its power's establishment says.
 * Idempotent: an army whose rows are all formed is returned as it was, and a
 * world whose powers keep no establishments is returned untouched.
 */
export function formArmies<W extends { readonly establishments: readonly MilitaryEstablishment[]; readonly material: { readonly forces: readonly Force[] } }>(world: W, atStep: number, hints: FormingHints = {}): W {
  if (world.establishments.length === 0) return world;
  const establishments = world.establishments.map((establishment) => ({ ...establishment, numbered: { ...establishment.numbered } }));
  let changed = false;
  const forces = world.material.forces.map((force) => {
    const establishment = establishments.find((candidate) => candidate.polityId === force.polityId);
    const kept = new Set(force.personnel.flatMap((row) => (row.formationId === undefined ? [] : [row.formationId])));
    const orphaned = (force.formations ?? []).some((formation) => !kept.has(formation.id));
    const unformed = force.personnel.some((row) => row.formationId === undefined || formationOf(force, row.formationId) === undefined);
    if (establishment === undefined) {
      if (!orphaned && (force.formations ?? []).length === 0) return force;
      // Its power has given up its establishment, or it has gone to one with
      // none: its men stay what they are, but nobody numbers them any more.
      if (!orphaned) return force;
    }
    if (!unformed && !orphaned) return force;
    changed = true;
    return formOne(force, establishment, atStep, hints);
  });
  if (!changed) return world;
  return { ...world, establishments, material: { ...world.material, forces } } as W;

  function formOne(force: Force, establishment: MilitaryEstablishment | undefined, day: number, given: FormingHints): Force {
    let formations = (force.formations ?? []).filter((formation) => force.personnel.some((row) => row.formationId === formation.id));
    const rows: ForcePersonnelCategory[] = force.personnel.filter((row) => row.formationId !== undefined && formations.some((formation) => formation.id === row.formationId));
    const loose = force.personnel.filter((row) => !rows.includes(row));
    if (establishment === undefined) return { ...force, formations, personnel: [...rows, ...loose] };

    const rowFor = (formationId: string): number => rows.findIndex((row) => row.formationId === formationId);
    for (const row of loose) {
      if (menIn(row) <= 0 && rows.length > 0) continue;
      const body = chooseBody(establishment, row, force.name);
      const quality = given.seasoned?.(force, row) ?? (body === undefined ? SOURCE_QUALITY.mercenary : SOURCE_QUALITY[body.source]);
      if (body === undefined) {
        // A kind of troops this power has no body for -- elephants taken into
        // a legion -- stands on its own, as what it is.
        const id = boundedId(force.id, "irregular", row.categoryId, String(formations.length));
        formations = [...formations, {
          id, bodyId: id, bodyLabel: row.label, templateId: `irregular:${row.categoryId}`, line: "wing",
          ...quality, doctrineIds: [], units: [], raisedAtStep: day,
        }];
        rows.push({ ...row, formationId: id });
        continue;
      }
      const templates = body.formationIds
        .map((id) => formationTemplateOf(establishment, id))
        .filter((template): template is FormationTemplate => template !== undefined && template.categoryId === row.categoryId);
      const capacity = templates.reduce((sum, template) => sum + template.men, 0);
      let remaining = menIn(row);
      const targets: { formationId: string | null; template: FormationTemplate; bodyId: string; bodyLabel: string; men: number }[] = [];

      // The bodies of this kind the army already has, filled first.
      const bodies = [...new Map(formations
        .filter((formation) => body.formationIds.includes(formation.templateId))
        .map((formation) => [formation.bodyId, formation.bodyLabel] as const)).entries()];
      for (const [bodyId, bodyLabel] of bodies) {
        for (const template of templates) {
          if (remaining <= 0) break;
          const existing = formations.find((formation) => formation.bodyId === bodyId && formation.templateId === template.id);
          const at = existing === undefined ? -1 : rowFor(existing.id);
          const has = at < 0 ? 0 : menIn(rows[at]!);
          const room = Math.max(0, template.men - has);
          if (room <= 0) continue;
          const take = Math.min(room, remaining);
          targets.push({ formationId: existing?.id ?? null, template, bodyId, bodyLabel, men: take });
          remaining -= take;
        }
      }
      // Too few for a body of their own: they join the last, over strength.
      const last = bodies[bodies.length - 1];
      if (remaining > 0 && capacity > 0 && last !== undefined && remaining < capacity / 2) {
        let placed = 0;
        templates.forEach((template, t) => {
          const men = t === templates.length - 1 ? remaining - placed : Math.round((remaining * template.men) / capacity);
          placed += men;
          if (men <= 0) return;
          const existing = formations.find((formation) => formation.bodyId === last[0] && formation.templateId === template.id);
          targets.push({ formationId: existing?.id ?? null, template, bodyId: last[0], bodyLabel: last[1], men });
        });
        remaining = 0;
      }
      // And new bodies for the rest, numbered on from the last.
      if (remaining > 0 && capacity > 0) {
        // Whole bodies, the odd men shared among them: 4,500 legionaries are
        // one legion over strength, not a legion and a half.
        const count = Math.max(1, Math.round(remaining / capacity));
        const perBody = remaining / count;
        let given2 = 0;
        for (let b = 0; b < count; b += 1) {
          const n = (establishment.numbered[body.id] ?? 0) + 1;
          establishment.numbered[body.id] = n;
          const bodyId = boundedId(force.polityId, body.id, String(n));
          const bodyLabel = bodyName(body, n);
          const forThis = b === count - 1 ? remaining - given2 : Math.round(perBody);
          given2 += forThis;
          let placed = 0;
          templates.forEach((template, t) => {
            const men = t === templates.length - 1 ? forThis - placed : Math.round((forThis * template.men) / capacity);
            placed += men;
            if (men > 0) targets.push({ formationId: null, template, bodyId, bodyLabel, men });
          });
        }
        remaining = 0;
      }
      const parts = splitRow(row, targets.map((target) => target.men));
      targets.forEach((target, index) => {
        const part = parts[index]!;
        const added = part.fit + part.unavailable.reduce((sum, group) => sum + group.count, 0);
        if (added <= 0) return;
        const existing = target.formationId === null
          ? formations.find((formation) => formation.bodyId === target.bodyId && formation.templateId === target.template.id)
          : formations.find((formation) => formation.id === target.formationId);
        if (existing !== undefined) {
          const at = rowFor(existing.id);
          const before = at < 0 ? 0 : menIn(rows[at]!);
          formations = formations.map((formation) => (formation.id === existing.id ? blend(formation, before, added, quality) : formation));
          if (at < 0) rows.push({ categoryId: row.categoryId, label: rowLabel(target.template, target.bodyLabel), fit: part.fit, unavailable: part.unavailable, formationId: existing.id });
          else rows[at] = { ...rows[at]!, fit: rows[at]!.fit + part.fit, unavailable: [...rows[at]!.unavailable, ...part.unavailable] };
          return;
        }
        const id = boundedId(target.bodyId, target.template.id);
        formations = [...formations, {
          id, bodyId: target.bodyId, bodyLabel: target.bodyLabel, templateId: target.template.id, line: target.template.line,
          trainingBps: quality.trainingBps, experienceBps: quality.experienceBps, doctrineIds: [], units: [], raisedAtStep: day,
        }];
        rows.push({ categoryId: row.categoryId, label: rowLabel(target.template, target.bodyLabel), fit: part.fit, unavailable: part.unavailable, formationId: id });
      });
    }
    return { ...force, formations: formations.slice(0, 40), personnel: rows.length === 0 ? force.personnel : rows };
  }
}

function rowLabel(template: FormationTemplate, bodyLabel: string): string {
  return (template.label.toLowerCase() === bodyLabel.toLowerCase() ? bodyLabel : `${template.label} of ${bodyLabel}`).slice(0, 80);
}

/** The bodies an army is made of, in words: "two legions and two alae, and 600 horse". */
export function bodiesInWords(force: Pick<Force, "formations" | "personnel">, establishment: MilitaryEstablishment | undefined): string | null {
  const formations = force.formations ?? [];
  if (formations.length === 0) return null;
  const counts = new Map<string, number>();
  for (const bodyId of new Set(formations.map((formation) => formation.bodyId))) {
    const formation = formations.find((candidate) => candidate.bodyId === bodyId)!;
    const label = bodyTemplateOf(establishment, formation.templateId)?.label ?? formation.bodyLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return [...counts].map(([label, n]) => `${NUMBER[n] ?? String(n)} ${n === 1 ? label.toLowerCase() : pluralOf(label.toLowerCase())}`).join(", ");
}

/**
 * The plural of an army's word for a body or a unit, the way its own
 * language made it: turmae, alae, syntagmata, companies, legions.
 */
const GREEK_NEUTERS: ReadonlySet<string> = new Set(["syntagma", "tagma", "systema", "sema"]);

export function pluralOf(word: string): string {
  // "Ala of the allies": the head word is the one made plural.
  const of = word.indexOf(" of ");
  if (of > 0) return `${pluralOf(word.slice(0, of))}${word.slice(of)}`;
  const words = word.split(" ");
  const last = words[words.length - 1] ?? word;
  // Greek neuters in -ma take -mata (syntagmata); a Latin turma is turmae.
  const plural = GREEK_NEUTERS.has(last) ? `${last}ta`
    : last.endsWith("a") ? `${last}e`
      : last.endsWith("y") && !/[aeiou]y$/u.test(last) ? `${last.slice(0, -1)}ies`
        : last.endsWith("s") || last.endsWith("x") || last.endsWith("ch") ? `${last}es`
          : `${last}s`;
  return [...words.slice(0, -1), plural].join(" ");
}
