import {
  activeDepartments,
  allOffices,
  allSuccessionRules,
  currentAgeYears,
  isEligibleFor,
  isMagistracy,
  labelNamesOffice,
  leverAptitude,
  seatCharacterInOffice,
  type Character,
  type LeverId,
  type FactProposalDraft,
  type Office,
  type WorldState,
} from "@chronica/shared";
import { rulerOf, rulerOfficeOf, type GovernmentRules } from "./constitutions";
import { assessExecution, domainOfWork } from "./delegation";

/**
 * Posts a government made and nobody filled.
 *
 * "The Roman Republic created the office of admiral to command its fleet" --
 * and then no admiral, ever, unless the consul thought to write a second
 * order naming one. A department whose seats stand empty runs at
 * `VACANT_SKILL`, so a board made to run the grain did it worse than the
 * consuls had before it. Nobody makes an office in order to leave it empty.
 *
 * So an appointive post that a department works through, or that the world
 * made since the opening, is filled the day after it stands empty: whoever
 * names to it (the ruler, in the constitution's words) names the ablest man
 * of the power for that work who is free to take it. A man holds one
 * magistracy at a time, so a sitting magistrate is not moved.
 *
 * Only posts nobody else keeps. Elective offices are the voters'
 * (`elections.ts`), a throne is its blood's (`keepThrones`), and a post the
 * scenario authored empty -- a dictatorship kept for emergencies -- stays
 * empty until somebody means to fill it. Nor is a post filled while a
 * question or a nomination to it is open: that is somebody meaning to.
 *
 * The player is never seated by the engine; he may still name himself.
 */

const MIN_AGE = 25;
const OPEN_STAGES = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

export interface FillAppointmentsInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly toDay: number;
  readonly playerCharacterId?: string | null | undefined;
}

export function fillAppointments(input: FillAppointmentsInput): { readonly world: WorldState; readonly facts: readonly FactProposalDraft[] } {
  const player = input.playerCharacterId ?? null;
  const facts: FactProposalDraft[] = [];
  let world = input.world;
  const rules = new Map(allSuccessionRules(world, input.government.successionRules).map((rule) => [rule.id, rule]));
  const offices = new Map(allOffices(world, input.government.offices).map((office) => [office.id, office]));
  const authored = new Set(input.government.offices.map((office) => office.id));
  // Which offices do which work: a post in a department is judged by its levers.
  const leversOf = new Map<string, readonly LeverId[]>();
  for (const department of activeDepartments(world)) {
    if (department.scope.kind !== "polity") continue;
    for (const officeId of [...department.officeIds, ...department.deputyOfficeIds, ...(department.headOfficeId === null ? [] : [department.headOfficeId])]) {
      leversOf.set(officeId, [...(leversOf.get(officeId) ?? []), ...department.levers]);
    }
  }

  // The places to fill: empty seats, and a single post the world made with no
  // seat at all -- "admiral of the fleet", made the day Rome had twenty ships
  // (`society.ts`), was an office nobody could ever hold. A college with a
  // seat count is worked by the men it implies, and is left as it is.
  const seatedOffices = new Set(world.material.officeSeats.map((seat) => seat.officeId));
  const places: { readonly seatId: string | null; readonly officeId: string; readonly requirementIds: readonly string[] }[] = [
    ...world.material.officeSeats.filter((seat) => seat.status === "vacant").map((seat) => ({ seatId: seat.id, officeId: seat.officeId, requirementIds: seat.eligibilityRequirementIds })),
    ...[...offices.values()]
      .filter((office) => !authored.has(office.id) && !seatedOffices.has(office.id) && office.seatCount === undefined && isMagistracy(office)
        && rulerOfficeOf(world, office.polityId, input.government)?.id !== office.id)
      .map((office) => ({ seatId: null, officeId: office.id, requirementIds: [] as readonly string[] })),
  ];
  if (places.length === 0) return { world, facts };

  const meantToBeFilled = (office: Office, seatId: string | null): boolean => world.material.politicalProcedures.some((procedure) =>
    OPEN_STAGES.has(procedure.stage)
    && ((procedure.subjectKind === "office_seat" && ((seatId !== null && procedure.subjectId === seatId) || (procedure.subjectId === null && labelNamesOffice(procedure.label, office.label))))
      || (procedure.subjectKind === "character" && (procedure.type === "nomination" || procedure.type === "appointment") && labelNamesOffice(procedure.label, office.label))));

  for (const seat of places) {
    const office = offices.get(seat.officeId);
    if (office === undefined || office.successionRuleId === "abolished") continue;
    const rule = rules.get(office.successionRuleId);
    if (rule !== undefined && rule.kind !== "appointment") continue;
    if (office.kind === "membership") continue;
    const levers = leversOf.get(office.id);
    if (levers === undefined && authored.has(office.id)) continue;
    if (meantToBeFilled(office, seat.seatId)) continue;
    const ruler = rulerOf(world, office.polityId, input.government);
    // The ruler's own seat is filled by whatever makes rulers, never by this.
    const rulerSeat = world.material.officeSeats.some((candidate) => candidate.officeId === office.id && candidate.holderCharacterId === ruler?.id);
    if (rulerSeat) continue;

    const sitting = new Set(world.material.officeSeats
      .filter((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null && isMagistracy(offices.get(candidate.officeId)))
      .map((candidate) => candidate.holderCharacterId!));
    const requirementIds = seat.requirementIds.length > 0 ? seat.requirementIds : office.eligibilityRequirementIds;
    // A department's post by its levers; any other by the work its name says
    // it is -- an admiral by a soldier's gifts, not by his standing.
    const domain = domainOfWork("office", office.label);
    const fitness = (character: Character): number => levers === undefined || levers.length === 0
      ? assessExecution(world, character.id, domain)?.competence ?? 0
      : levers.reduce((sum, lever) => sum + leverAptitude(character, lever), 0) / levers.length;
    const candidates = world.characters.filter((character) => character.alive
      && character.polityId === office.polityId
      && character.id !== player
      && character.id !== ruler?.id
      && currentAgeYears(character, input.toDay) >= MIN_AGE
      && (!isMagistracy(office) || !sitting.has(character.id))
      && isEligibleFor(world, office, requirementIds, character, input.toDay));
    const chosen = [...candidates].sort((a, b) => fitness(b) - fitness(a) || b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
    if (chosen === undefined) continue;

    world = seatCharacterInOffice(world, chosen.id, { office, vacantSeatId: seat.seatId }, input.toDay, office.termDays ?? null);
    const namer = ruler === null ? "The government" : ruler.name;
    facts.push({
      localId: `appointed_${seat.seatId ?? office.id}_${input.toDay}`.slice(0, 60),
      kind: "office_filled",
      summary: `${namer} named ${chosen.name} ${office.label}, a post that had stood empty.`,
      affectedRefs: [
        { kind: "character", id: chosen.id },
        { kind: "polity", id: office.polityId },
        ...(ruler === null ? [] : [{ kind: "character" as const, id: ruler.id }]),
      ],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 40,
    });
  }
  return { world, facts };
}
