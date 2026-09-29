import { authorityInWords, buildStation, CLAIMED_OFFICE_SOURCE_REF, type Station } from "./station";
import type { Office } from "../characters/character";
import { controlInWords } from "../material/in-words";
import { perMonth } from "../material/books";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * What a person holds: the offices, the powers, and the land.
 *
 * `describeAuthority` has produced "propose, spend in fiscal matters, over the
 * Rome treasury" since the authority index was written, and it has only ever
 * been written into prompts. The player could not find out what their own
 * office let them do -- the character sheet showed the office's *name* and
 * stopped there. `HoldingViewSchema` has the same history: specified, never
 * rendered.
 *
 * The seat a scenario never wrote down is said out loud rather than quietly
 * treated as real. `buildStation` already distinguishes a held seat from a
 * claimed one, because a declared player can name an office the world has no
 * free seat for; a player who has claimed the consulship should be told that
 * Rome has not agreed.
 *
 * Land you merely govern is not land you hold. `station.holdingIds` is
 * `legalHolderCharacterId === characterId` and nothing else, which is the
 * honest reading of a holding: a proconsul administers a province, he does
 * not own it.
 *
 * Nor is "may spend from his own purse" a power. Every character in the
 * scenario carries a fiscal grant over their own account, so listing grants
 * as they come would tell a man with nothing in the world that he holds one
 * power -- and the purse has its own place in the room anyway. Authority
 * over somebody else's money, a state treasury included, stays.
 */

export interface SeatReading {
  readonly seatId: string;
  readonly officeLabel: string;
  readonly polityLabel: string;
  readonly termLabel: string | null;
  /** True when the world has written no seat for this office and the player only claims it. */
  readonly claimed: boolean;
}

export interface PowerReading {
  readonly powers: readonly string[];
  readonly domain: string;
  readonly overLabel: string;
}

export interface HoldingReading {
  readonly id: string;
  readonly title: string;
  readonly territoryLabel: string;
  readonly controlLabel: string;
  readonly incomeLabel: string;
}

export interface Standing {
  readonly seats: readonly SeatReading[];
  readonly powers: readonly PowerReading[];
  readonly holdings: readonly HoldingReading[];
  /** When a person holds nothing at all, which is a real and playable answer. */
  readonly nothing: string | null;
}

const NOTHING = "You hold no office, and no land that anyone has written down.";

export function readYourStanding(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): Standing {
  if (characterId === null) return { seats: [], powers: [], holdings: [], nothing: NOTHING };
  const station: Station = buildStation({ world, characterId, offices });

  const polityName = (id: string | null): string =>
    id === null ? "no power in particular" : world.map.polities.find((p) => p.id === id)?.name ?? id;
  const provinceName = (id: string): string => world.map.provinces.find((p) => p.id === id)?.name ?? id;

  const seatById = new Map(world.material.officeSeats.map((seat) => [seat.id, seat]));

  const seats: SeatReading[] = station.seats.map((seat) => {
    const claimed = seat.seatId.startsWith(CLAIMED_OFFICE_SOURCE_REF);
    const expires = seatById.get(seat.seatId)?.termExpiresAtStep ?? null;
    return {
      seatId: seat.seatId,
      officeLabel: seat.office.label,
      polityLabel: polityName(seat.office.polityId),
      termLabel: claimed
        ? `${polityName(seat.office.polityId)} has not written you into this seat.`
        : expires === null
          ? null
          : `Held until ${clock === undefined ? `day ${expires}` : formatWorldDate({ day: expires, minute: 0 }, clock)}`,
      claimed,
    };
  });

  // A grant over your own purse is ownership, not authority.
  const ownPurseIds = new Set(
    world.material.accounts
      .filter((account) => account.owner.kind === "character" && account.owner.id === characterId)
      .map((account) => account.id),
  );
  const powers: PowerReading[] = authorityInWords(station, world)
    .filter((phrase) => !ownPurseIds.has(phrase.scopeId))
    .map(({ powers: p, domain, overLabel }) => ({ powers: p, domain, overLabel }));

  const holdings: HoldingReading[] = world.material.holdings
    .filter((holding) => station.holdingIds.has(holding.id))
    .map((holding): HoldingReading => {
      // Counted the way readTheBooks counts it: what actually arrives, not
      // what is levied on paper.
      const source = world.material.incomeSources.find(
        (candidate) => candidate.originKind === "holding" && candidate.originId === holding.id,
      );
      const monthly = source === undefined || !source.active
        ? 0
        : Math.round(perMonth(source.amount, source.cadenceSteps) * (source.collectionRateBps / 10_000));
      return {
        id: holding.id,
        title: holding.title,
        territoryLabel: provinceName(holding.territoryId),
        controlLabel: controlInWords(holding.physicalControlBps),
        incomeLabel: monthly <= 0
          ? "Nothing is coming in from it."
          : `${monthly.toLocaleString()} a month`,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const nothing = seats.length === 0 && powers.length === 0 && holdings.length === 0 ? NOTHING : null;
  return { seats, powers, holdings, nothing };
}
