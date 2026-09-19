import type { MaterialWorldState, OfficeSeatVacancyCauseSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { z } from "zod";

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
 */
export function seatCharacterInOffice(
  world: WorldState,
  characterId: string,
  matched: { readonly office: { readonly id: string; readonly eligibilityRequirementIds: readonly string[] }; readonly vacantSeatId: string | null },
  atStep: number,
): WorldState {
  const seats = matched.vacantSeatId !== null
    ? world.material.officeSeats.map((seat) => (seat.id === matched.vacantSeatId
      ? { ...seat, holderCharacterId: characterId, status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: atStep }
      : seat))
    : [...world.material.officeSeats, {
      id: `${matched.office.id}:seat:${world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length}`,
      officeId: matched.office.id,
      seatIndex: world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length,
      holderCharacterId: characterId,
      status: "held" as const,
      vacancyCause: "none" as const,
      termStartedAtStep: atStep,
      termExpiresAtStep: null,
      appointmentProcedureId: null,
      removalProcedureId: null,
      eligibilityRequirementIds: [...matched.office.eligibilityRequirementIds],
    }];

  return {
    ...world,
    material: { ...world.material, officeSeats: seats },
    characters: world.characters.map((character) => (character.id === characterId ? { ...character, officeId: matched.office.id } : character)),
  };
}
