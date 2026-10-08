import { currentAgeYears } from "./age";
import type { Character, Office } from "./character";
import type { WorldState } from "../world/world-state";

/**
 * The order of Rome's offices, as the custom of the age kept it.
 *
 * The *lex Villia annalis* (180 BCE) is later than the years these games open in (270 BCE): in 270 the ladder was custom, not law. The custom ran so:
 * a young man served ten campaigns and then stood for the quaestorship at about thirty (Polybius VI.19: ten years' service before any office); the aedileship, the praetorship and the consulship followed, each
 * a rung higher, with a year's rest (a *biennium*, two years from election to election) between one office and the next; a man did not hold two
 * magistracies at once, and did not step back down to a lesser one once he had held a greater. The ladder is kept here for every Roman magistracy by its
 * id, so the election and the candidate's own admission read one rule.
 *
 * A man whom a court has condemned is infamous (*infamia*): he does not stand for a magistracy for ten years, or for ever if he was sent into exile; and
 * a man the censors have marked (`nota`) is not a military tribune or a senator until the next censors lift it (`sim/the-lectio.ts`).
 */

/** Which rung of the ladder each Roman magistracy is. Offices not here have no rung. */
export const CURSUS_RUNGS: Readonly<Record<string, number>> = {
  "roman-quaestor": 1,
  "roman-tribune": 1,
  "roman-aedile": 2,
  "roman-plebeian-aedile": 2,
  "roman-praetor": 3,
  "roman-consul": 4,
};

/** The least age at which the custom let a man stand for a rung: ten years' service from seventeen (Polybius VI.19) puts the quaestorship at about twenty-seven to thirty, the others a few years on each. */
export const CURSUS_MIN_AGE: Readonly<Record<number, number>> = { 1: 27, 2: 31, 3: 34, 4: 38 };

/** The rest a man had between one office and the next: a year between the end of one and the day he stood for another. */
export const CURSUS_REST_DAYS = 365;
/** How long a conviction keeps a man from the magistracies (ten years), unless he was exiled, which is for life. */
export const INFAMIA_DAYS = 3_650;
/** The kind of the record a conviction writes (`sim/trials.ts`). */
export const INFAMIA_KIND = "infamia";
/** The censors' mark's kind (`sim/nota.ts`). */
export const NOTA_RECORD_KIND = "nota";
/** The offices the censors' mark keeps a man from. */
const MARKED_OUT_OF = new Set(["roman-military-tribune", "roman-senator"]);

const DAY = 365;

/**
 * Offices a man does not hold at once because the constitution keeps them apart. Carthage's generals commanded abroad and her suffetes judged and presided at
 * home (Aristotle, *Politics* 1272b-1273b): the same man was not both, and a serving strategos is not seated as a suffete.
 */
export const INCOMPATIBLE_OFFICES: Readonly<Record<string, readonly string[]>> = {
  "carthaginian-suffete": ["carthaginian-strategos"],
  "carthaginian-strategos": ["carthaginian-suffete"],
};

/** The rung of the ladder an office is, or undefined. */
export const rungOf = (officeId: string): number | undefined => CURSUS_RUNGS[officeId];

/** The grade of the highest office a man holds or has held. A man whose record is empty is taken, by his years, to have had a career before the world began. */
export function bestRungHeld(world: Pick<WorldState, "material" | "elapsedStep">, character: Character, toDay: number): number {
  let best = 0;
  for (const tenure of character.officesHeld) best = Math.max(best, rungOf(tenure.officeId) ?? 0);
  for (const seat of world.material.officeSeats) {
    if (seat.holderCharacterId === character.id && seat.status === "held") best = Math.max(best, rungOf(seat.officeId) ?? 0);
    if (seat.designateCharacterId === character.id) best = Math.max(best, rungOf(seat.officeId) ?? 0);
  }
  // A man with no magistracy on record (a seat in the Senate is none) is taken, in the first years of a world, to have had the career his age implies.
  if (best === 0) {
    const age = currentAgeYears(character, toDay);
    return toDay <= 6 * DAY ? (age >= 44 ? 2 : age >= 38 ? 1 : 0) : 0;
  }
  return best;
}

/** When a man's infamy ends: a day, "life", or null where he has none. */
export function infamyOf(world: Pick<WorldState, "genericEntities">, characterId: string, toDay: number): { readonly untilStep: number | "life"; readonly why: string } | null {
  for (const entity of world.genericEntities) {
    if (entity.kind !== INFAMIA_KIND || entity.attributes?.["characterId"] !== characterId) continue;
    const until = entity.attributes?.["untilStep"];
    const why = String(entity.attributes?.["why"] ?? "a court condemned him");
    if (until === "life" || until === undefined || until === null) return { untilStep: "life", why };
    if (typeof until === "number" && until > toDay) return { untilStep: until, why };
  }
  return null;
}

/**
 * Why a man may not stand for this office by the custom of the ladder or by his name: null if he may. Offices with no rung are asked only about infamy
 * (and about the censors' mark for the military tribunate and the Senate).
 */
export function cursusRefusal(world: WorldState, office: Pick<Office, "id" | "kind">, character: Character, toDay: number, requirementIds: readonly string[] = ["req-standing-"]): string | null {
  // The ladder is part of what an office asks: a seat whose requirements were set aside (a test of how a count is made, a law that waived them) asks only after the man's name.
  const ladder = requirementIds.some((id) => id.startsWith("req-standing-"));
  const infamous = infamyOf(world, character.id, toDay);
  if (infamous !== null && (rungOf(office.id) !== undefined || MARKED_OUT_OF.has(office.id))) {
    return infamous.untilStep === "life"
      ? `${character.name} stands condemned (${infamous.why}) and is infamous for life: no office of the city is his.`
      : `${character.name} is infamous after his conviction (${infamous.why}), and no office is open to him until day ${infamous.untilStep}.`;
  }
  if (MARKED_OUT_OF.has(office.id) && world.genericEntities.some((entity) => entity.kind === NOTA_RECORD_KIND && entity.attributes?.["characterId"] === character.id)) {
    return `${character.name} lies under the censors' mark, and is neither a military tribune nor a senator until the next censors lift it.`;
  }
  const apart = INCOMPATIBLE_OFFICES[office.id];
  if (apart !== undefined) {
    const sitting = world.material.officeSeats.find((seat) => apart.includes(seat.officeId) && seat.holderCharacterId === character.id && seat.status === "held");
    if (sitting !== undefined) return `${character.name} is a general of Carthage and sits as one: the city does not make a serving general a suffete.`;
  }
  const rung = rungOf(office.id);
  if (rung === undefined || !ladder) return null;
  const waived = character.eligibilityWaivers.some((waiver) => waiver.officeId === office.id && waiver.untilStep >= toDay);
  // One magistracy at a time: a man sitting in another, or named to follow in one, does not stand for a second the same year.
  for (const seat of world.material.officeSeats) {
    const elsewhere = rungOf(seat.officeId);
    if (elsewhere === undefined || seat.officeId === office.id) continue;
    // Sitting in one chosen this very month (the day's colleges are counted one after another) or named to follow in one; a man mid-term who rises lays his first down, as he always has.
    const justChosen = seat.holderCharacterId === character.id && seat.status === "held" && seat.termStartedAtStep !== null && seat.termStartedAtStep > 0 && toDay - seat.termStartedAtStep <= 60;
    if (justChosen || seat.designateCharacterId === character.id) {
      return `${character.name} is already ${seat.designateCharacterId === character.id ? "chosen for" : "newly chosen to"} another magistracy of the city (${seat.officeId.replace(/^roman-/, "")}): a man does not hold two.`;
    }
  }
  if (waived) return null;
  const age = currentAgeYears(character, toDay);
  const minAge = CURSUS_MIN_AGE[rung] ?? 0;
  if (age < minAge) return `${character.name} is ${age}: the custom asks ${minAge} years of a man who stands for this office.`;
  // The ladder: he does not step back down, and rests a year between one office and the next.
  let highest = 0;
  let lastEnded = Number.NEGATIVE_INFINITY;
  for (const tenure of character.officesHeld) {
    const held = rungOf(tenure.officeId);
    if (held === undefined || tenure.officeId === office.id) continue;
    highest = Math.max(highest, held);
    // An office he still sits in has not ended: a man rising mid-term lays the lesser down on winning the greater, and the year's rest is counted from offices that are over.
    const sitting = world.material.officeSeats.some((seat) => seat.officeId === tenure.officeId && seat.holderCharacterId === character.id && seat.status === "held");
    // A tenure written at the world's first day is a career before it began: how long ago, nobody wrote, and it is taken to be long ago.
    if (!sitting && tenure.lastHeldAtStep > 0) lastEnded = Math.max(lastEnded, tenure.lastHeldAtStep);
    if (held >= rung && !(held === rung)) return `${character.name} has been ${tenure.officeId.replace(/^roman-/, "")} and does not stand again for a lesser office.`;
    if (held === rung) return `${character.name} has held an office of this rung (${tenure.officeId.replace(/^roman-/, "")}) and does not hold another beside it.`;
  }
  if (lastEnded > Number.NEGATIVE_INFINITY && toDay - lastEnded < CURSUS_REST_DAYS) {
    return `${character.name} left his last office too lately: the custom is a year's rest between one office and the next.`;
  }
  // A step at a time: from nothing to the quaestorship or the aedileship, from there on one rung or two; never from the quaestorship to the consulship.
  const best = bestRungHeld(world, character, toDay);
  if (rung > best + 2) return `${character.name} has not served the offices below it: ${rung >= 4 ? "the consulship is for a man who has been aedile or praetor" : "he has to be quaestor first"}.`;
  if (rung === 4 && best < 2) return `${character.name} has not served the offices below the consulship: it is for a man who has been aedile or praetor.`;
  return null;
}
