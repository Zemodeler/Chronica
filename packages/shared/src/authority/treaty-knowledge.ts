import { buildStation, holdsPolityStanding } from "./station";
import { officeGovernsItsPolity } from "./authority-grant";
import { allOffices, type Office } from "../characters/character";
import type { PolityAgreement, PolityAgreementKind } from "../world/agreements";
import type { WorldState } from "../world/world-state";

/**
 * Who may know what two powers have agreed.
 *
 * Three rules, and every surface that shows a treaty asks this module rather
 * than reading `visibility` for itself -- the sheet, the calendar line and the
 * model's slice each had their own copy, and they disagreed.
 *
 * - A war, a peace or a truce cannot be hidden. Armies march or stop marching,
 *   and everybody sees it, whatever the record says about secrecy.
 * - Anything else made in public is known to everybody.
 * - A treaty made in private is known to those who govern the powers party to
 *   it, and to nobody else: a secret alliance between Rome and Carthage is
 *   known to Rome's and Carthage's leaders, not to a Roman merchant and not to
 *   Syracuse. And a man who governed while it stood still knows it after he
 *   lays his office down -- a consul does not forget what he signed.
 */

/** The kinds nobody can keep secret. */
export const NEVER_SECRET_AGREEMENTS: ReadonlySet<PolityAgreementKind> = new Set<PolityAgreementKind>(["war", "peace", "truce"]);

/** Whether everybody may know of it. */
export const agreementIsOpen = (agreement: Pick<PolityAgreement, "kind" | "visibility">): boolean =>
  agreement.visibility === "public" || NEVER_SECRET_AGREEMENTS.has(agreement.kind);

export interface TreatyViewer {
  readonly polityId: string | null;
  /** Governs his power now. */
  readonly governs: boolean;
  /** The last day he governed each power he has governed, office by office. */
  readonly governedUntil: ReadonlyMap<string, number>;
}

/** Who this person is, as far as treaty secrecy cares. */
export function treatyViewer(world: WorldState, characterId: string, offices: readonly Office[] = []): TreatyViewer {
  const station = buildStation({ world, characterId, offices });
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const officeById = new Map(allOffices(world, offices).map((office) => [office.id, office]));
  const governedUntil = new Map<string, number>();
  for (const tenure of character?.officesHeld ?? []) {
    const office = officeById.get(tenure.officeId);
    if (office === undefined || !officeGovernsItsPolity(office)) continue;
    governedUntil.set(office.polityId, Math.max(governedUntil.get(office.polityId) ?? -1, tenure.lastHeldAtStep));
  }
  return { polityId: station.polityId, governs: holdsPolityStanding(station), governedUntil };
}

export function knowsAgreement(viewer: TreatyViewer, agreement: PolityAgreement): boolean {
  if (agreementIsOpen(agreement)) return true;
  const ours = viewer.polityId !== null && (agreement.polityId === viewer.polityId || agreement.otherPolityId === viewer.polityId);
  if (ours && viewer.governs) return true;
  // Governed one of its parties at some point since it was made. The day he
  // last held the office is written down each day he holds it, so a man who
  // left office before it was made never knew of it. One who came to office
  // after it ended read it in his government's archive, as a sitting one does.
  return [agreement.polityId, agreement.otherPolityId].some((party) => (viewer.governedUntil.get(party) ?? -1) >= agreement.sinceStep);
}
