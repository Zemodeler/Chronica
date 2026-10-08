import { describe, expect, it } from "vitest";
import { readDepartments, type WorldState } from "@chronica/shared";
import { atDay, input, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal } from "./fiscal-officers";
import { MODEL_ACT_PRECEDENCE_DAYS, modelHasActedOnTheBooks } from "./played-ruler-books";

/**
 * "Hiero is the only officer Syracuse has, and the model plays him. Who keeps his books?"
 *
 * The rules did, once, for every power nobody plays; a man the model was playing was passed over, and a king who is his own treasurer and whom the model
 * asks about wars and letters never thought of the rate of the tribute. The books are a standing business: the rules keep them for him, and give way
 * only to what he has himself done about the money of his power lately (`played-ruler-books.ts`).
 */

const strained = (): WorldState => withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 2_000, 60_000), "syracuse", 0.1);

/** The days in which the books of Syracuse are kept by the rules at all (as one decision does not come every month). */
const DAYS = [120, 150, 180, 210, 240, 270, 300];

function hiero(world: WorldState): string {
  return readDepartments(world).rulers("syracuse")[0]!.id;
}

describe("a played ruler keeps his books", () => {
  it("has his books kept by the rules though the model plays him, where the only officer his power has is the ruler", () => {
    const world = strained();
    const ruler = hiero(world);
    const kept = DAYS.filter((day) => decideFiscal({ ...input(atDay(world, day)), playedByModel: new Set([ruler]) }).some((decision) => decision.polityId === "syracuse" && decision.actorCharacterId === ruler));
    expect(kept.length).toBeGreaterThan(0);
  });

  it("keeps the same books for a man the model does not play, so that playing him changes who is asked and nothing of what is done", () => {
    const world = strained();
    const ruler = hiero(world);
    for (const day of DAYS) {
      const free = decideFiscal(input(atDay(world, day))).filter((decision) => decision.polityId === "syracuse");
      const played = decideFiscal({ ...input(atDay(world, day)), playedByModel: new Set([ruler]) }).filter((decision) => decision.polityId === "syracuse");
      expect(JSON.stringify(played)).toBe(JSON.stringify(free));
    }
  });

  it("gives way to what the model itself did about the money lately, and takes the books up again when the season has run", () => {
    const world = strained();
    const ruler = hiero(world);
    const day = DAYS.find((candidate) => decideFiscal({ ...input(atDay(world, candidate)), playedByModel: new Set([ruler]) }).some((decision) => decision.polityId === "syracuse"))!;
    const at = atDay(world, day);
    // The model set the rate itself ten days ago: nobody else decides it again in the season.
    const set = { ...at, actMarks: [...at.actMarks, { polityId: "syracuse", act: "tax_rate" as const, officeId: null, byCharacterId: ruler, byOfficeId: null, atStep: day - 10, sinceStep: day - 10, total: 0 }] };
    expect(modelHasActedOnTheBooks(set, "syracuse", day)).toBe(true);
    expect(decideFiscal({ ...input(set), playedByModel: new Set([ruler]) }).some((decision) => decision.polityId === "syracuse")).toBe(false);
    // A season and more later it has run out, and his books are the rules' again.
    const later = { ...set, instant: { ...set.instant, day: day + MODEL_ACT_PRECEDENCE_DAYS + 1 } };
    expect(modelHasActedOnTheBooks(later, "syracuse", day + MODEL_ACT_PRECEDENCE_DAYS + 1)).toBe(false);
  });

  it("does not mistake the officer's own decision, which the marks keep too, for the model's", () => {
    const world = strained();
    const ruler = hiero(world);
    const day = 180;
    const at = atDay(world, day);
    const own = {
      ...at,
      actMarks: [...at.actMarks, { polityId: "syracuse", act: "tax_rate" as const, officeId: null, byCharacterId: ruler, byOfficeId: null, atStep: day - 5, sinceStep: day - 5, total: 0 }],
      statecraft: { ...at.statecraft, log: [...at.statecraft.log, { day: day - 5, polityId: "syracuse", actorCharacterId: ruler, act: "fiscal" as const, targetPolityId: null, why: "tax: raised the rate" }] },
    };
    expect(modelHasActedOnTheBooks(own, "syracuse", day)).toBe(false);
  });

  it("leaves a power the player rules to the player, and every competence rule where it was", () => {
    const world = strained();
    const ruler = hiero(world);
    for (const day of DAYS) {
      expect(decideFiscal({ ...input(atDay(world, day), "syracuse"), playedByModel: new Set([ruler]) }).some((decision) => decision.polityId === "syracuse")).toBe(false);
    }
  });
});
