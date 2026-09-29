import type { Enactment, PoliticalProcedure, QuestionConcern, WorldState } from "@chronica/shared";

/**
 * What a question is about, so every bloc can lean by what it wants.
 *
 * A bloc used to have one mood for every question: the Patricians at +20 were
 * as warm to a land law as to a war, and a question's weight in the house
 * depended only on who had spoken. Now a question has concerns, and a bloc's
 * interests meet them (`political-parts.ts`).
 *
 * The engine reads them from what the measure plainly does -- a law that
 * raises income is a tax, a new office is a new office, a kingship abolished
 * weakens the ruler -- and from the words it was put in. The model may name
 * more when it opens the question; it cannot name fewer, because what a
 * measure does is not a matter of how it is described.
 */

const WORDS: readonly (readonly [RegExp, QuestionConcern])[] = [
  [/\b(war|campaign|invade|invasion|attack|expedition|declare)\b/iu, "war"],
  [/\b(peace|truce|treaty|armistice|terms)\b/iu, "peace"],
  [/\b(tax|taxes|tithe|tribute|duty|duties|toll|levy on|impost)\b/iu, "taxes"],
  [/\b(fleet|navy|ships|temple|walls?|build|aqueduct|road|spend|pay for|games)\b/iu, "spending"],
  [/\b(land|lands|allot|allotment|colony|colonies|ager|redistribut)/iu, "land"],
  [/\b(debt|debts|loan|loans|interest|usury|bondage|nexum)\b/iu, "debt"],
  [/\b(trade|market|harbou?r|port|merchants?|commerce|customs)\b/iu, "trade"],
  [/\b(gods?|temple|cult|priest|sacrifice|oracle|rites|festival)\b/iu, "religion"],
  [/\b(levy|legion|legions|recruit|conscript|muster|enrol)\b/iu, "levy"],
  [/\b(grain|corn|bread|dole|famine)\b/iu, "grain"],
  [/\b(citizenship|franchise|the vote|enfranchis|rights of)\b/iu, "widen_franchise"],
  [/\b(punish|exile|trial|condemn|execute|banish|censure|impeach)\b/iu, "punishment"],
  // Not "dictator": at Rome that was an office of the republic's own, for six months, not a crown.
  [/\b(king|kingship|crown|throne|tyrant|tyranny|monarch|monarchy)\b/iu, "strengthen_ruler"],
];

/** Concerns written into what the measure does. */
export function enactedConcerns(enactment: Enactment | undefined, rulerOfficeId: string | null = null): QuestionConcern[] {
  if (enactment === undefined) return [];
  const found: QuestionConcern[] = [];
  for (const effect of enactment.effects) {
    if (effect.quantity === "income") found.push(effect.direction === "raise" ? "taxes" : "spending");
    if (effect.quantity === "food_security" && effect.direction === "raise") found.push("grain");
    if (effect.quantity === "manpower" && effect.direction === "raise") found.push("levy");
    if (effect.quantity === "conversion") found.push("religion");
    if (effect.quantity === "defense" || effect.quantity === "supply") found.push("spending");
  }
  if (enactment.upkeep !== null) found.push("spending");
  if (enactment.office !== null) {
    if (enactment.office.abolish) found.push(enactment.office.officeId === rulerOfficeId ? "weaken_ruler" : "new_office");
    else found.push("new_office");
  }
  if (enactment.body !== null) found.push("new_office");
  if (enactment.department != null) found.push("new_office");
  const constitution = enactment.constitution ?? null;
  if (constitution !== null) {
    const form = constitution.form ?? null;
    if (form === "monarchy" || form === "temple_state") found.push("strengthen_ruler", "narrow_franchise");
    else if (form === "popular_republic") found.push("weaken_ruler", "widen_franchise");
    else if (form === "oligarchic_republic") found.push("weaken_ruler", "narrow_franchise");
    else if (form !== null) found.push("weaken_ruler");
    const chamber = constitution.chamber ?? null;
    if (chamber !== null) {
      if (chamber.abolish) found.push("strengthen_ruler");
      else if (chamber.franchise === "citizens" || chamber.franchise === "soldiers") found.push("widen_franchise");
      else if (chamber.advisory === false || (chamber.powers?.length ?? 0) > 0) found.push("weaken_ruler");
    }
    const succession = constitution.succession ?? null;
    if (succession !== null) found.push(succession.kind === "primogeniture" ? "strengthen_ruler" : "weaken_ruler");
  }
  return found;
}

/** Concerns read off the words a question was put in, and the sort of question it is. */
export function statedConcerns(procedure: Pick<PoliticalProcedure, "label" | "type" | "subjectKind">): QuestionConcern[] {
  const found = WORDS.filter(([pattern]) => pattern.test(procedure.label)).map(([, concern]) => concern);
  if (procedure.type === "treaty_ratification") found.push("peace");
  if (procedure.type === "denunciation" || procedure.type === "removal") found.push("punishment");
  return found;
}

/**
 * Everything a question is about: what it enacts, what it is called, and
 * whatever the model said beside. Each once, in the order they were found.
 */
export function concernsOf(world: WorldState, procedure: PoliticalProcedure, rulerOfficeId: string | null = null): QuestionConcern[] {
  const enactment = world.enactments.find((candidate) => candidate.procedureId === procedure.id);
  return [...new Set([...(procedure.concerns ?? []), ...enactedConcerns(enactment, rulerOfficeId), ...statedConcerns(procedure)])].slice(0, 8);
}
