import {
  EXTREMITY_BELOW_SHARE,
  RECRUIT_KIT_BPS,
  REFILL_BELOW_SHARE,
  REFILL_SHARE_PER_MONTH,
  chargeSkill,
  crewPerHull,
  chargeHolders,
  holdersOfLever,
  isOwnToDo,
  mayAct,
  readDepartments,
  skillShare,
  warsOf,
  type FactProposalDraft,
  type Force,
  type ForcePersonnelCategory,
  type Office,
  type WorldState,
} from "@chronica/shared";
import { musterRateFor, mustering, raiseLevy } from "./levies";
import type { IdFactory } from "./ports";
import { chestOfPower } from "./supply-plan";

/**
 * The legions are refilled (docs/economy.md, "Equipment"; docs/plans/government.md, the levy).
 *
 * An army that lost men in a war stayed thin until somebody ordered a levy for it: the dilectus rule fills the host as a whole when it is thin (`magistrates.ts`),
 * and a legion at half its strength went on fighting at half until then. Now a power at war, whose levy is in somebody's hands who may act, fills each thinned army from
 * the country by rule, once a month and at a consul's rate: the Republic raised some four legions a year by the dilectus beside the allies' contingents (Polybius 6.19-20, 3.107),
 * a twelfth of its host a month, a little more under a good officer of the levy. The men come out of the roll as any levy's (`levies.ts`: the assidui only, the landless too where
 * the legion is in its extremity, as after Cannae, Livy 22.57), cost the bounty from the chest and muster in bands; and they come in with a household's arms, not a full issue,
 * which tells on the kit of the army (`equipment.ts`). The horse are not refilled: a horseman had to be of the equestrian census and own a horse. Ships are not refilled;
 * a fleet's crews are drawn when its hulls are (`levies.ts`).
 */

const MONTH = 30;

const afloat = (force: Force): boolean => force.personnel.every((row) => row.fit <= 0 || crewPerHull(row.categoryId) > 0);
const presentOf = (force: Force): number => force.personnel.reduce((sum, row) => sum + row.fit + row.unavailable.reduce((held, group) => held + group.count, 0), 0);
const horse = (row: ForcePersonnelCategory): boolean => /cavalry|horse|equites|elephant/iu.test(row.categoryId);

/**
 * Whether somebody of the power may carry out a levy on his own account, or with a colleague who does not stop it: he who holds it by his charge, else the head of state
 * (the order `magistrates.ts` looks in). A power with no constitution on record levies as it always did.
 */
function mayLevy(world: WorldState, polityId: string, offices: readonly Office[], rulers: readonly { readonly id: string }[]): boolean {
  const named = [...holdersOfLever(world, polityId, "levy", offices).map((holder) => holder.characterId), ...chargeHolders(world, polityId, "levy", offices).map((holder) => holder.characterId), ...rulers.map((ruler) => ruler.id)];
  const alive = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  for (const id of named) {
    if (!alive.has(id)) continue;
    const grade = mayAct(world, id, "levy", { offices })?.grade;
    if (grade === undefined || isOwnToDo(grade)) return true;
  }
  return false;
}

export interface RefillInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  readonly offices?: readonly Office[] | undefined;
}

export function refillTheLegions(input: RefillInput): { world: WorldState; facts: FactProposalDraft[] } {
  const start = input.world;
  const day = input.toDay;
  if (start.material.forces.length === 0) return { world: start, facts: [] };
  const atWar = new Map<string, readonly string[]>();
  const warsFor = (polityId: string): readonly string[] => {
    let known = atWar.get(polityId);
    if (known === undefined) { known = warsOf(start.polityAgreements, polityId); atWar.set(polityId, known); }
    return known;
  };
  const candidates = start.material.forces.filter((force) => force.payObligationId !== null && force.outlaw !== true && force.private !== true && !afloat(force) && warsFor(force.polityId).length > 0);
  if (candidates.length === 0) return { world: start, facts: [] };

  let world = start;
  const changed = new Map<string, Force>();
  const facts: FactProposalDraft[] = [];
  const reader = readDepartments(start);
  const byPolity = new Map<string, Force[]>();
  for (const force of candidates) byPolity.set(force.polityId, [...(byPolity.get(force.polityId) ?? []), force]);
  const nameOf = (polityId: string): string => start.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;

  for (const [polityId, forces] of [...byPolity].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Looked at for the first time: the month is counted from today.
    const due = forces.filter((force) => {
      if (force.refilledAtStep === undefined) { changed.set(force.id, { ...force, refilledAtStep: day }); return false; }
      return day - force.refilledAtStep >= MONTH;
    });
    if (due.length === 0) continue;
    // The levy is in somebody's hands who may act, and the chest is open.
    const chest = chestOfPower(world, polityId);
    if (chest === null || !mayLevy(world, polityId, input.offices ?? [], reader.rulers(polityId))) continue;
    const host = forces.reduce((sum, force) => sum + force.authorizedStrength, 0);
    let left = Math.round(host * REFILL_SHARE_PER_MONTH * (1 + skillShare(chargeSkill(reader, polityId, "levy"), 0.3)));
    const thin = due
      .map((force) => ({ force, present: presentOf(force) }))
      .filter((entry) => entry.present < entry.force.authorizedStrength * REFILL_BELOW_SHARE)
      .sort((a, b) => a.present / a.force.authorizedStrength - b.present / b.force.authorizedStrength || a.force.id.localeCompare(b.force.id));
    let sent = 0;
    let first: string | null = null;
    for (const { force: before, present } of thin) {
      // Whatever is stopped here is only the army's thinness: its place on the month's list is kept.
      const force = changed.get(before.id) ?? before;
      if (left <= 0) break;
      const row = [...force.personnel].filter((candidate) => !horse(candidate) && crewPerHull(candidate.categoryId) === 0).sort((a, b) => b.fit - a.fit)[0];
      if (row === undefined) continue;
      const wanted = Math.min(force.authorizedStrength - present, left);
      if (wanted <= 0) continue;
      const levy = raiseLevy(world, { polityId, provinceId: force.locationId, men: wanted, payerAccountId: chest, pays: true, atStep: day, cause: force.id, ids: input.ids, categoryId: row.categoryId, extremity: present < force.authorizedStrength * EXTREMITY_BELOW_SHARE });
      if (levy.men <= 0) { changed.set(force.id, { ...force, refilledAtStep: day }); continue; }
      world = levy.world;
      left -= levy.men;
      sent += levy.men;
      first ??= force.name;
      const coming = mustering(row.categoryId, row.label, levy.men, day, input.ids.next("levy"), musterRateFor(world, polityId));
      const merged = force.personnel.map((candidate) => (candidate === row ? { ...candidate, fit: candidate.fit + coming.fit, unavailable: [...candidate.unavailable, ...coming.unavailable] } : candidate));
      const equipmentBps = force.equipmentBps === undefined ? undefined : Math.round((force.equipmentBps * present + RECRUIT_KIT_BPS * levy.men) / (present + levy.men));
      changed.set(force.id, {
        ...force,
        personnel: merged,
        refilledAtStep: day,
        ...(equipmentBps === undefined ? {} : { equipmentBps }),
        history: [...force.history, { id: input.ids.next("personnel"), atStep: day, kind: "reinforcement" as const, categoryId: row.categoryId, count: levy.men, causeId: force.id }].slice(-64),
      });
    }
    // A force looked at and not thin is let alone till next month.
    for (const force of due) if (!changed.has(force.id)) changed.set(force.id, { ...force, refilledAtStep: day });
    if (sent > 0) {
      const enemies = warsFor(polityId).map(nameOf).join(" and ");
      facts.push({
        localId: `legions_refilled_${polityId}_${day}`.slice(0, 60), kind: "legions_refilled", visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
        affectedRefs: [{ kind: "polity", id: polityId }],
        summary: `The levy held for ${nameOf(polityId)} sent ${sent} men to fill the ranks thinned in the war with ${enemies}${first === null ? "" : `, ${first} first among them`}.`.slice(0, 600),
      });
    }
  }
  if (changed.size === 0) return { world, facts };
  return { world: { ...world, material: { ...world.material, forces: world.material.forces.map((force) => changed.get(force.id) ?? force) } }, facts };
}
