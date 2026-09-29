import { boundedId } from "../determinism";
import type { MaterialWorldState, OfficeSeatVacancyCauseSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { z } from "zod";
import { isMagistracy, type Office } from "./character";

// Office vacancy on life change (character-sim phase 5).
//
// One function, called from every place a character stops being able to hold
// an office -- death, incapacity, retirement, capture, removal -- so no
// workflow duplicates vacancy logic and every seat's `vacancyCause` stays
// truthful. This never assigns a successor: filling the seat again is always
// a Phase 4 institutional procedure (characters/political-authority.ts,
// workflows/definitions/political-procedures.ts), never automatic.

type VacancyCause = z.infer<typeof OfficeSeatVacancyCauseSchema>;

export function vacateOfficeSeatsFor(
  material: MaterialWorldState,
  characterId: string,
  cause: VacancyCause,
  atStep: number,
): MaterialWorldState {
  const held = material.officeSeats.filter((seat) => seat.holderCharacterId === characterId && seat.status === "held");
  if (held.length === 0) return material;
  return {
    ...material,
    officeSeats: material.officeSeats.map((seat) =>
      seat.holderCharacterId === characterId && seat.status === "held"
        ? { ...seat, status: "vacant" as const, vacancyCause: cause, holderCharacterId: null, termExpiresAtStep: atStep }
        : seat,
    ),
  };
}

/**
 * The same, over a whole world -- and clearing the mirror the seat cannot see.
 *
 * `Character.officeId` duplicates what the office seats already say, and
 * `vacateOfficeSeatsFor` takes only `MaterialWorldState`, so it *cannot* clear
 * that field however carefully it is called. Which is exactly how the two would
 * drift: a man vacated from his seat would go on being described as holding the
 * office everywhere a character is read, including in his own prompt.
 *
 * So callers take this one. The material-only function stays for the places
 * that genuinely have nothing else.
 */
export function vacateOfficesOf(world: WorldState, characterId: string, cause: VacancyCause, atStep: number): WorldState {
  const material = vacateOfficeSeatsFor(world.material, characterId, cause, atStep);
  if (material === world.material) return world;
  return {
    ...world,
    material,
    characters: world.characters.map((character) => (character.id === characterId ? { ...character, officeId: null } : character)),
  };
}

/**
 * Laying down one office and keeping the rest.
 *
 * `vacateOfficesOf` empties every seat a man holds, which is right for a death
 * and wrong for a career: a senator elected praetor, or a consul whose office
 * was abolished, went on to lose his seat in the Senate and his priesthood
 * with it. The mirror falls back to whatever he still holds.
 */
export function vacateOfficeOf(world: WorldState, characterId: string, officeId: string, cause: VacancyCause, atStep: number): WorldState {
  const held = (seat: WorldState["material"]["officeSeats"][number]): boolean =>
    seat.holderCharacterId === characterId && seat.status === "held";
  if (!world.material.officeSeats.some((seat) => held(seat) && seat.officeId === officeId)) return world;
  const officeSeats = world.material.officeSeats.map((seat) => (held(seat) && seat.officeId === officeId
    ? { ...seat, status: "vacant" as const, vacancyCause: cause, holderCharacterId: null, termExpiresAtStep: atStep }
    : seat));
  const remaining = officeSeats.find((seat) => held(seat))?.officeId ?? null;
  return {
    ...world,
    material: { ...world.material, officeSeats },
    characters: world.characters.map((character) => (character.id === characterId && character.officeId === officeId
      ? { ...character, officeId: remaining }
      : character)),
  };
}

/** Laying down every magistracy he holds, as a man does who is elected to another. Councils and priesthoods stay his. */
export function vacateMagistraciesOf(
  world: WorldState,
  characterId: string,
  offices: readonly Pick<Office, "id" | "kind">[],
  cause: VacancyCause,
  atStep: number,
): WorldState {
  const kinds = new Map(offices.map((office) => [office.id, office]));
  let next = world;
  for (const seat of world.material.officeSeats) {
    if (seat.holderCharacterId !== characterId || seat.status !== "held" || !isMagistracy(kinds.get(seat.officeId))) continue;
    next = vacateOfficeOf(next, characterId, seat.officeId, cause, atStep);
  }
  return next;
}

/**
 * Seating somebody in an office, and keeping the mirror honest.
 *
 * The logic existed once, inline inside `materializePlayerCharacter`, and
 * nowhere else -- so an office was assigned exactly once in a game's life, when
 * the player declared their character, and never again. An appointment that
 * passed a vote changed nothing; a magistrate the world invented held no office
 * at all.
 *
 * Takes the match `findOfficeSeatForRole` returns: a vacant seat to fill, or an
 * office whose seats have never been authored, which gets its first.
 *
 * `termDays` is the new holder's own term. A seat keeps the expiry of whoever
 * held it last otherwise, and that date is in the past by the time anybody
 * fills it -- so a consul seated into a seat whose term had run out was
 * unseated again by the very next tick. Without a term, the seat has none;
 * `holdElections` gives an elective office its term.
 */
export function seatCharacterInOffice(
  world: WorldState,
  characterId: string,
  matched: { readonly office: { readonly id: string; readonly eligibilityRequirementIds: readonly string[]; readonly kind?: Office["kind"] }; readonly vacantSeatId: string | null },
  atStep: number,
  termDays: number | null = null,
): WorldState {
  const termExpiresAtStep = termDays === null ? null : atStep + termDays;
  const seats = matched.vacantSeatId !== null
    ? world.material.officeSeats.map((seat) => (seat.id === matched.vacantSeatId
      ? { ...seat, holderCharacterId: characterId, status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: atStep, termExpiresAtStep }
      : seat))
    : [...world.material.officeSeats, {
      id: boundedId(matched.office.id, "seat", world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length),
      officeId: matched.office.id,
      seatIndex: world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length,
      holderCharacterId: characterId,
      status: "held" as const,
      vacancyCause: "none" as const,
      termStartedAtStep: atStep,
      termExpiresAtStep,
      appointmentProcedureId: null,
      removalProcedureId: null,
      eligibilityRequirementIds: [...matched.office.eligibilityRequirementIds],
    }];

  return {
    ...world,
    material: { ...world.material, officeSeats: seats },
    // A seat in the Senate or a priesthood is not what a consul is called by.
    characters: world.characters.map((character) => (character.id === characterId && (isMagistracy(matched.office) || character.officeId === null)
      ? { ...character, officeId: matched.office.id }
      : character)),
  };
}

/**
 * Writes down who has held what, from the seats as they stand.
 *
 * A seat forgets its holder the day his term ends, so without this nobody
 * could ask whether a man had been quaestor before standing for praetor, or
 * consul within ten years. Run over every held seat each tick, rather than at
 * each of the dozen places a seat changes hands, so no path can miss it.
 */
export function recordTenures(world: WorldState, atStep: number): WorldState {
  const latest = new Map<string, Map<string, number>>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const until = seat.termExpiresAtStep === null ? atStep : Math.min(atStep, seat.termExpiresAtStep);
    const held = latest.get(seat.holderCharacterId) ?? new Map<string, number>();
    held.set(seat.officeId, Math.max(held.get(seat.officeId) ?? 0, until));
    latest.set(seat.holderCharacterId, held);
  }
  if (latest.size === 0) return world;
  let changed = false;
  const characters = world.characters.map((character) => {
    const held = latest.get(character.id);
    if (held === undefined) return character;
    const officesHeld = [...character.officesHeld];
    for (const [officeId, lastHeldAtStep] of held) {
      const index = officesHeld.findIndex((tenure) => tenure.officeId === officeId);
      if (index === -1) officesHeld.push({ officeId, lastHeldAtStep });
      else if (officesHeld[index]!.lastHeldAtStep < lastHeldAtStep) officesHeld[index] = { officeId, lastHeldAtStep };
      else continue;
      changed = true;
    }
    return officesHeld.length === character.officesHeld.length && !changed ? character : { ...character, officesHeld };
  });
  return changed ? { ...world, characters } : world;
}
