import { buildStation, holdsPolityStanding, type Station } from "./station";
import { allOffices, type Office } from "../characters/character";
import { AGREEMENT_KIND_IN_WORDS } from "../world/agreements";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * The state a person serves, as they could know it.
 *
 * The engine keeps a power's legitimacy and why, who holds each office and
 * until when, the business before its councils and how the votes stand, its
 * factions, its treaties, and how its government regards every other power.
 * The model has been told all of it every turn; the player was shown none of
 * it, and could not see that an election was open or a truce was running out.
 *
 * Gated as the world slice gates it. What any citizen would know -- who holds
 * office, what is before the Senate, the public treaties -- is shown to anyone
 * of the power. How the votes stand goes only to those who sit in the body or
 * are party to the business; the government's regard for other powers, and
 * treaties made in private, only to those who govern.
 */

export interface StateReading {
  readonly polityLabel: string | null;
  readonly legitimacy: { readonly inWords: string; readonly causes: readonly string[]; readonly shaky: boolean } | null;
  readonly offices: readonly {
    readonly key: string;
    readonly officeLabel: string;
    /** Null when the seat is empty. */
    readonly holderLabel: string | null;
    readonly termLabel: string | null;
    readonly yours: boolean;
  }[];
  readonly business: readonly {
    readonly key: string;
    readonly label: string;
    readonly deadlineLabel: string | null;
    /** "For 12, against 7": only for those in the body or party to it. */
    readonly tally: string | null;
    readonly yours: boolean;
  }[];
  readonly factions: readonly { readonly key: string; readonly name: string; readonly kindLabel: string; readonly members: number }[];
  readonly treaties: readonly {
    readonly key: string;
    readonly kindLabel: string;
    readonly withLabel: string;
    readonly terms: string;
    readonly untilLabel: string | null;
    readonly atWar: boolean;
  }[];
  /** How the government regards other powers: only for those who govern. */
  readonly regard: readonly { readonly key: string; readonly polityLabel: string; readonly inWords: string }[];
}

const EMPTY: StateReading = { polityLabel: null, legitimacy: null, offices: [], business: [], factions: [], treaties: [], regard: [] };
const OPEN_STAGES = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

function legitimacyInWords(bps: number): string {
  if (bps >= 7_500) return "secure: few question its right to rule";
  if (bps >= 5_500) return "accepted";
  if (bps >= 3_500) return "questioned";
  if (bps >= 2_000) return "openly doubted";
  return "near to breaking";
}

function trustInWords(score: number): string {
  if (score >= 50) return "trusted";
  if (score >= 15) return "well regarded";
  if (score > -15) return "watched";
  if (score > -50) return "distrusted";
  return "regarded as an enemy";
}

export function readTheState(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): StateReading {
  if (characterId === null) return EMPTY;
  const station: Station = buildStation({ world, characterId, offices });
  const polityId = station.polityId;
  if (polityId === null) return EMPTY;
  const governs = holdsPolityStanding(station);
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

  const officeById = new Map(allOffices(world, offices).map((office) => [office.id, office]));
  const yourSeats = new Set(station.seats.map((seat) => seat.seatId));
  const seats = world.material.officeSeats
    .filter((seat) => officeById.get(seat.officeId)?.polityId === polityId && (seat.status === "held" || seat.status === "vacant"))
    .map((seat) => ({
      key: seat.id,
      officeLabel: officeById.get(seat.officeId)!.label,
      holderLabel: seat.status === "held" ? personName(seat.holderCharacterId) : null,
      termLabel: seat.status === "held" && seat.termExpiresAtStep !== null ? `until ${date(seat.termExpiresAtStep)}` : null,
      yours: yourSeats.has(seat.id),
    }))
    .sort((a, b) => Number(b.yours) - Number(a.yours) || a.officeLabel.localeCompare(b.officeLabel));

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

  const treaties = world.polityAgreements
    .filter((agreement) => agreement.status === "active" && (agreement.polityId === polityId || agreement.otherPolityId === polityId))
    .filter((agreement) => agreement.visibility === "public" || governs)
    .map((agreement) => ({
      key: agreement.id,
      kindLabel: AGREEMENT_KIND_IN_WORDS[agreement.kind],
      withLabel: polityName(agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId),
      terms: agreement.terms,
      untilLabel: date(agreement.untilStep),
      atWar: agreement.kind === "war",
    }))
    .sort((a, b) => Number(b.atWar) - Number(a.atWar) || a.withLabel.localeCompare(b.withLabel));

  const regard = !governs ? [] : world.polityStances
    .filter((stance) => stance.polityId === polityId && stance.towardPolityId !== polityId)
    .map((stance) => ({ key: stance.towardPolityId, polityLabel: polityName(stance.towardPolityId), inWords: trustInWords(stance.trustScore) }))
    .sort((a, b) => a.polityLabel.localeCompare(b.polityLabel));

  return { polityLabel: polityName(polityId), legitimacy, offices: seats, business, factions, treaties, regard };
}
