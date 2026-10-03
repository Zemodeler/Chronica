import { buildStation, type Station } from "./station";
import { allOffices, allSuccessionRules, type Office, type SuccessionRule } from "../characters/character";
import { GOVERNMENT_FORM_IN_WORDS, type GovernmentForm } from "../political-parts";
import { EMPTY_ABROAD, readAbroad, type Abroad } from "./abroad";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * The state a person serves, as they could know it.
 *
 * The engine keeps a power's legitimacy and why, how it is governed, who
 * holds each office and until when, how each is filled and for how long, the business before its councils and how the votes stand, its
 * factions, its treaties, and how its government regards every other power.
 * The model has been told all of it every turn; the player was shown none of
 * it, and could not see that an election was open or a truce was running out.
 *
 * Gated as the world slice gates it. What any citizen would know -- who holds
 * office, what is before the Senate, the public treaties -- is shown to anyone
 * of the power. How the votes stand goes only to those who sit in the body or
 * are party to the business. Treaties and the government's regard for other
 * powers are `abroad.ts`'s, gated by `treaty-knowledge.ts`.
 */

export interface StateReading {
  readonly polityLabel: string | null;
  readonly legitimacy: { readonly inWords: string; readonly causes: readonly string[]; readonly shaky: boolean } | null;
  /** How it is governed, from its constitution: its form, who heads it, who may change it. */
  readonly government: {
    readonly form: GovernmentForm;
    readonly formLabel: string;
    readonly rulerLabel: string | null;
    readonly sovereignLabel: string | null;
  } | null;
  /** Each office once, with how it is filled and who holds its seats now. */
  readonly offices: readonly StateOffice[];
  readonly institutions: readonly StateInstitution[];
  readonly business: readonly {
    readonly key: string;
    readonly label: string;
    readonly deadlineLabel: string | null;
    /** "For 12, against 7": only for those in the body or party to it. */
    readonly tally: string | null;
    readonly yours: boolean;
  }[];
  readonly factions: readonly { readonly key: string; readonly name: string; readonly kindLabel: string; readonly members: number }[];
  /** Every other power, and where this one stands with it (`abroad.ts`). */
  readonly abroad: Abroad;
}

export interface StateOffice {
  /** The office's id, and its note's key. */
  readonly key: string;
  readonly officeLabel: string;
  readonly kind: "magistracy" | "membership" | "priesthood";
  readonly fillingInstitutionId: string | null;
  /** Vacancies explicitly recorded; unmodelled college members are not vacancies. */
  readonly recordedVacancies: number;
  /** "Election by the Centuriate Assembly". */
  readonly filledLabel: string | null;
  /** "a year", "18 months". Null for an office held for life or at pleasure. */
  readonly termLabel: string | null;
  /** How many sit in it at once: an office of one has one, the Senate three hundred. */
  readonly seats: number;
  readonly holders: readonly {
    readonly key: string;
    readonly label: string;
    /** "until 1 March 269 BC". */
    readonly untilLabel: string | null;
    readonly yours: boolean;
  }[];
  readonly yours: boolean;
}

export interface StateInstitution {
  readonly key: string;
  readonly name: string;
  readonly franchise: string | null;
  readonly advisory: boolean;
  readonly powers: readonly string[];
  readonly fillsOfficeIds: readonly string[];
  readonly votingBlocs: readonly { readonly name: string; readonly weight: number }[];
}

const EMPTY: StateReading = { polityLabel: null, legitimacy: null, government: null, offices: [], institutions: [], business: [], factions: [], abroad: EMPTY_ABROAD };
const OPEN_STAGES = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

function legitimacyInWords(bps: number): string {
  if (bps >= 7_500) return "secure: few question its right to rule";
  if (bps >= 5_500) return "accepted";
  if (bps >= 3_500) return "questioned";
  if (bps >= 2_000) return "openly doubted";
  return "near to breaking";
}

export function readTheState(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
  successionRules: readonly SuccessionRule[] = [],
): StateReading {
  if (characterId === null) return EMPTY;
  const station: Station = buildStation({ world, characterId, offices });
  const polityId = station.polityId;
  if (polityId === null) return EMPTY;
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? "another power";
  const personName = (id: string | null): string | null => (id === null ? null : world.characters.find((character) => character.id === id)?.name ?? null);
  const date = (day: number | null): string | null =>
    day === null ? null : clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock);

  const standing = world.material.polityLegitimacy.find((entry) => entry.polityId === polityId);
  const legitimacy = standing === undefined ? null : {
    inWords: legitimacyInWords(standing.legitimacyBps),
    causes: [...standing.causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2).map((cause) => cause.label),
    shaky: standing.legitimacyBps < 3_500,
  };

  const constitution = world.constitutions.find((candidate) => candidate.polityId === polityId);
  const everyOffice = allOffices(world, offices);
  const builtIds = new Set(everyOffice.filter((office) => office.id.includes(":")).map((office) => office.id));
  // A template power's scenario ruler, council and priesthood are reformed into its constitution's (`sim/constitutions.ts`):
  // the old office is the same chair under an older id, and listing both read as a throne nobody held.
  const shadowed = (office: Office): boolean => {
    const key = office.id.startsWith(`${polityId}-`) ? office.id.slice(polityId.length + 1) : null;
    return key !== null && !key.includes(":") && builtIds.has(`${polityId}:${key}`);
  };
  const ownOffices = everyOffice.filter((office) => office.polityId === polityId && !shadowed(office));
  const ruler = constitution?.rulerOfficeId == null ? undefined : ownOffices.find((office) => office.id === constitution.rulerOfficeId);
  const sovereign = constitution?.sovereignInstitutionId == null ? undefined : world.material.institutions.find((institution) => institution.id === constitution.sovereignInstitutionId);
  const government = constitution === undefined ? null : {
    form: constitution.form,
    formLabel: GOVERNMENT_FORM_IN_WORDS[constitution.form],
    rulerLabel: ruler?.label ?? null,
    sovereignLabel: sovereign?.name ?? null,
  };

  const rules = new Map(allSuccessionRules(world, successionRules).map((rule) => [rule.id, rule]));
  const yourSeats = new Set(station.seats.map((seat) => seat.seatId));
  const officeList = ownOffices
    .map((office): StateOffice & { rank: number } => {
      const seats = world.material.officeSeats.filter((seat) => seat.officeId === office.id);
      const holders = seats
        .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null)
        .map((seat) => ({
          key: seat.id,
          label: personName(seat.holderCharacterId) ?? "somebody",
          untilLabel: seat.termExpiresAtStep === null ? null : `until ${date(seat.termExpiresAtStep)}`,
          yours: yourSeats.has(seat.id),
        }))
        .sort((a, b) => Number(b.yours) - Number(a.yours) || a.label.localeCompare(b.label));
      return {
        key: office.id,
        officeLabel: office.label,
        kind: office.kind ?? "magistracy",
        fillingInstitutionId: rules.get(office.successionRuleId)?.institutionId ?? null,
        recordedVacancies: seats.filter((seat) => seat.status !== "held" && seat.holderCharacterId === null).length,
        filledLabel: rules.get(office.successionRuleId)?.label ?? null,
        termLabel: office.termDays == null ? null : termWords(office.termDays),
        // An office the world has named no seat for, a dictatorship between
        // dictators, is still an office of the state, and vacant.
        seats: Math.max(office.seatCount ?? 1, seats.length),
        holders,
        yours: holders.some((holder) => holder.yours),
        rank: office.rank ?? 0,
      };
    })
    .sort((a, b) => Number(b.yours) - Number(a.yours) || b.rank - a.rank || a.officeLabel.localeCompare(b.officeLabel))
    .map(({ rank: _rank, ...office }) => office);

  const institutionPolity = new Map(world.material.institutions.map((institution) => [institution.id, institution.polityId]));
  const business = world.material.politicalProcedures
    .filter((procedure) => OPEN_STAGES.has(procedure.stage))
    .flatMap((procedure) => {
      const party = station.procedureIds.has(procedure.id);
      const member = procedure.institutionId !== null && station.institutionIds.has(procedure.institutionId);
      const ownPublic = procedure.visibility === "public" && procedure.institutionId !== null && institutionPolity.get(procedure.institutionId) === polityId;
      if (!party && !member && !ownPublic) return [];
      let tally: string | null = null;
      if (party || member) {
        const positions = world.material.supportPositions.filter((position) => position.procedureId === procedure.id);
        const weigh = (choice: string) => positions.filter((position) => position.position === choice).reduce((sum, position) => sum + position.influenceWeight, 0);
        const forIt = weigh("support");
        const against = weigh("oppose");
        tally = forIt + against === 0 ? "Nobody has declared yet." : `For ${forIt}, against ${against}.`;
      }
      return [{ key: procedure.id, label: procedure.label, deadlineLabel: date(procedure.deadlineStep), tally, yours: party }];
    })
    .sort((a, b) => Number(b.yours) - Number(a.yours));

  const factions = world.material.politicalGroups
    .filter((group) => group.active && group.polityId === polityId)
    .map((group) => ({
      key: group.id,
      name: group.name,
      kindLabel: group.type.replace(/_/g, " "),
      members: world.material.groupMemberships.filter((membership) => membership.groupId === group.id).length,
    }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));

  const institutions: StateInstitution[] = world.material.institutions
    .filter((institution) => institution.polityId === polityId)
    .map((institution) => ({
      key: institution.id,
      name: institution.name,
      franchise: institution.franchise ?? null,
      advisory: institution.advisory ?? false,
      powers: institution.powers ?? [],
      fillsOfficeIds: officeList.filter((office) => office.fillingInstitutionId === institution.id).map((office) => office.key),
      votingBlocs: institution.votingBlocs.map((bloc) => ({ name: bloc.name, weight: bloc.weight })),
    }));
  return { polityLabel: polityName(polityId), legitimacy, government, offices: officeList, institutions, business, factions, abroad: readAbroad(world, characterId, offices, clock) };
}

function termWords(days: number): string {
  if (days % 365 === 0) return days === 365 ? "a year" : `${days / 365} years`;
  if (days >= 330 && days <= 400) return "about a year";
  return days > 60 ? `${Math.round(days / 30)} months` : `${days} days`;
}
