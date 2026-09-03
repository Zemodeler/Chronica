import type { MaterialWorldState, OfficeSeatVacancyCauseSchema } from "../material-state";
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
