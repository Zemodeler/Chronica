import { atWar, type PolityAgreement } from "./agreements";
import type { Province } from "./map";

/**
 * Held is not owned (docs/plans/a-living-world.md §3).
 *
 * Taking ground used to be owning it: the day a siege ended the province was
 * the besieger's, its taxes and its levy with it, and the peace only confirmed
 * what the war had already settled. The user's rule, after CK3 and EU4: an
 * army that takes ground in a war **occupies** it. The occupier holds it --
 * its armies stand there, the map shows its colours over the owner's, and the
 * province counts toward how the war is going -- but it pays nothing to
 * anybody: not to the owner, whose men are not there to collect, and not to
 * the occupier, whose it is not. Ownership changes only at the peace, where
 * what is ceded passes and the rest goes back.
 *
 * Two fields, as in EU4. `controllerPolityId` is who holds the province now,
 * which is what every rule of armies, sieges, borders and movement already
 * reads. `ownerPolityId` is whose it is, and is set only while somebody else
 * holds it: absent, the holder is the owner. So everything written before
 * occupation existed reads as owned by its holder, which it was.
 */

/** Whose the province is: its owner while occupied, else whoever holds it. */
export function ownerOf(province: Pick<Province, "controllerPolityId" | "ownerPolityId">): string | null {
  return province.ownerPolityId ?? province.controllerPolityId;
}

/** Held by somebody other than its owner. */
export function isOccupied(province: Pick<Province, "controllerPolityId" | "ownerPolityId">): boolean {
  return province.ownerPolityId != null && province.controllerPolityId !== province.ownerPolityId;
}

/** Owned by this power and held by it: ground it taxes and levies from. */
export function ownsAndHolds(province: Pick<Province, "controllerPolityId" | "ownerPolityId">, polityId: string): boolean {
  return province.controllerPolityId === polityId && !isOccupied(province);
}

/**
 * Who holds and who owns a province once `takerId` takes it -- only those two
 * fields, to spread over the rest of whatever the caller is changing. Taken in
 * a war with its owner it is occupied, and the owner keeps it on paper; taken
 * back by its owner it is free again; taken any other way -- unheld ground
 * claimed, ground handed over by a power that is not at war with the taker --
 * it simply changes hands.
 */
export function takenBy(province: Pick<Province, "controllerPolityId" | "ownerPolityId">, takerId: string, agreements: readonly PolityAgreement[]): { readonly controllerPolityId: string; readonly ownerPolityId: string | null } {
  const owner = ownerOf(province);
  if (owner === null || owner === takerId) return { controllerPolityId: takerId, ownerPolityId: null };
  if (atWar(agreements, owner, takerId)) return { controllerPolityId: takerId, ownerPolityId: owner };
  return { controllerPolityId: takerId, ownerPolityId: null };
}

/**
 * What a peace between two powers does to the ground each holds of the
 * other's. The ancient default, uti possidetis: each keeps what it holds, and
 * the people of a province kept remember whose it was (`yearning`). A clause
 * may cede ground to somebody else, and the peace table may give occupied
 * ground back (`returned`), which leaves it its owner's as before. Ground
 * either of them holds of a third power is that war's business, not this
 * peace's.
 */
export function settleOccupations<P extends Pick<Province, "id" | "controllerPolityId" | "ownerPolityId" | "yearning">>(
  provinces: readonly P[],
  a: string,
  b: string,
  atStep: number,
  returned: ReadonlySet<string> = new Set(),
): P[] {
  const party = (id: string | null | undefined): boolean => id === a || id === b;
  return provinces.map((province) => {
    if (!isOccupied(province) || !party(province.ownerPolityId) || !party(province.controllerPolityId)) return province;
    if (returned.has(province.id)) return { ...province, controllerPolityId: province.ownerPolityId!, ownerPolityId: null };
    return { ...province, ownerPolityId: null, yearning: { polityId: province.ownerPolityId!, bps: 3_000, updatedAtStep: atStep } };
  });
}

/**
 * Occupations left standing with no war under them -- a war closed without a
 * treaty, a party gone over to somebody else -- settle the way a peace would:
 * the holder keeps it. Run by the tick, so a province is never held for ever
 * by a power that is no longer fighting for it.
 */
export function settleOrphanedOccupations<P extends Pick<Province, "id" | "controllerPolityId" | "ownerPolityId" | "yearning">>(
  provinces: readonly P[],
  agreements: readonly PolityAgreement[],
  atStep: number,
): readonly P[] {
  let changed = false;
  const next = provinces.map((province) => {
    if (!isOccupied(province) || province.controllerPolityId === null) return province;
    if (atWar(agreements, province.ownerPolityId!, province.controllerPolityId)) return province;
    changed = true;
    return { ...province, ownerPolityId: null, yearning: { polityId: province.ownerPolityId!, bps: 3_000, updatedAtStep: atStep } };
  });
  return changed ? next : provinces;
}
