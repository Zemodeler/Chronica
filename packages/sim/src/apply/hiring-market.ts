import { aNameFor, createCanonicalNpc, type WorldState } from "@chronica/shared";
import type { IdFactory } from "../ports";

/**
 * A man found at a place, hired there.
 *
 * "Hire forty transports at Tarentum" needed a shipowner of Tarentum who
 * existed already, and none did: the world had a consul, his Senate and the
 * kings, and nobody in a port who owned a hull. So the order ended at "there
 * are no ship owners", and a consul with money voted for transports could not
 * spend it. A hire may name the town instead of the man; the engine finds
 * the shipmaster or contractor there -- the market is the town -- as a levy
 * finds the officer who leads an allied contingent (`treaties.ts`).
 *
 * Null when the id is not a place, so the hire is judged as it was.
 */
export function hireAtThePlace(
  world: WorldState,
  placeId: string,
  role: string,
  atStep: number,
  ids: IdFactory,
): { readonly world: WorldState; readonly characterId: string; readonly placeName: string } | null {
  const settlement = world.map.provinces.flatMap((province) => province.settlements).find((candidate) => candidate.id === placeId);
  const province = world.map.provinces.find((candidate) => candidate.id === (settlement?.provinceId ?? placeId));
  if (province === undefined) return null;
  const placeName = settlement?.name ?? province.name;
  const polityId = settlement?.controllerPolityId ?? province.controllerPolityId ?? null;
  const what = role === "mercenary" ? "shipmaster and captain for hire" : role === "engineer" ? "contractor" : role;
  const made = createCanonicalNpc(world, {
    characterId: ids.next("character"),
    name: aNameFor(polityId ?? province.id, `${role}-${placeId}-${atStep}`, new Set(world.characters.map((character) => character.name))),
    locationProvinceId: province.id,
    polityId,
    createdAtStep: atStep,
    creationReason: `A ${what} of ${placeName}, found there when men were hired.`.slice(0, 300),
    ageYearsAtStart: 40,
    prestigeBps: 2_500,
    startingMoney: 200,
  });
  if (made === null) return null;
  return { world: made.world, characterId: made.character.id, placeName };
}
