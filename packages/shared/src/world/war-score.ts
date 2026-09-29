import type { WorldState } from "./world-state";
import { atWar, type PolityAgreement } from "./agreements";

/**
 * How a war stands between two powers, from the first one's side: -100 lost
 * outright, 0 even, 100 won outright.
 *
 * Read from the world as it is, so it never drifts from what happened: ground
 * taken from the other side in this war and still held, the other's capital
 * held, the men each side has left in the field, the blood each side has lost
 * since the war began, and the cities under siege. A side with no ground left,
 * or no army left, has lost outright.
 *
 * It decides one thing: whether the peace is negotiated or dictated
 * (`DICTATE_AT`). Everything short of that is bargained for, and a power
 * bargains harder the better its war is going and the less it is tired of it.
 */
export interface WarStanding {
  readonly score: number;
  /** The first side may dictate the peace: the other accepts or fights on. */
  readonly dictates: boolean;
  /** The second side has nothing left: its ground, or its army, is gone. */
  readonly totalDefeat: boolean;
  /** Days since the war began. */
  readonly days: number;
  /** What moved it, for the people who have to read it. */
  readonly parts: readonly string[];
}

/** From here the winning side dictates rather than negotiates. */
export const DICTATE_AT = 50;

const fitOf = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

function warBetween(agreements: readonly PolityAgreement[], a: string, b: string): PolityAgreement | undefined {
  return agreements.find((agreement) => agreement.kind === "war" && agreement.status === "active"
    && ((agreement.polityId === a && agreement.otherPolityId === b) || (agreement.polityId === b && agreement.otherPolityId === a)));
}

export function warStanding(world: Pick<WorldState, "map" | "material" | "polityAgreements" | "elapsedStep" | "sieges">, a: string, b: string): WarStanding {
  const war = warBetween(world.polityAgreements, a, b);
  const since = war?.sinceStep ?? 0;
  const days = world.elapsedStep - since;
  const parts: string[] = [];
  let score = 0;
  if (!atWar(world.polityAgreements, a, b)) return { score: 0, dictates: false, totalDefeat: false, days: 0, parts: ["not at war"] };

  // Ground taken in this war and still held.
  const takenFrom = (loser: string, holder: string) => world.map.provinces.filter((province) =>
    province.controllerPolityId === holder && province.lostBy?.polityId === loser && province.lostBy.atStep >= since).length;
  const ground = takenFrom(b, a) - takenFrom(a, b);
  if (ground !== 0) { score += ground * 15; parts.push(`${ground > 0 ? "holds" : "has lost"} ${Math.abs(ground)} province${Math.abs(ground) === 1 ? "" : "s"}`); }

  // A capital held is a war all but over.
  const capitalOf = (polityId: string) => world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  const cityHolder = (settlementId: string | null) => settlementId === null ? null
    : world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === settlementId)?.controllerPolityId ?? null;
  if (cityHolder(capitalOf(b)) === a) { score += 25; parts.push("holds their capital"); }
  if (cityHolder(capitalOf(a)) === b) { score -= 25; parts.push("their enemy holds its capital"); }

  // The men each has left under arms.
  const armies = (polityId: string) => world.material.forces.filter((force) => force.polityId === polityId).reduce((sum, force) => sum + fitOf(force), 0);
  const ours = armies(a);
  const theirs = armies(b);
  if (ours + theirs > 0) {
    const edge = Math.round(((ours - theirs) / (ours + theirs)) * 25);
    if (edge !== 0) { score += edge; parts.push(`${edge > 0 ? "more" : "fewer"} men under arms (${ours} to ${theirs})`); }
  }

  // The blood each has lost since it began.
  const lost = (polityId: string) => world.material.forces.filter((force) => force.polityId === polityId)
    .flatMap((force) => force.history).filter((event) => event.atStep >= since && (event.kind === "battle_death" || event.kind === "wounds_death" || event.kind === "desertion"))
    .reduce((sum, event) => sum + event.count, 0);
  const bled = lost(b) - lost(a);
  const totalBled = lost(a) + lost(b);
  if (totalBled > 0) {
    const edge = Math.round((bled / totalBled) * 20);
    if (edge !== 0) { score += edge; parts.push(`${edge > 0 ? "has bled them more" : "has bled more"}`); }
  }

  // Their cities under siege, and ours.
  const besieging = (by: string, of: string) => world.sieges.filter((siege) => siege.status === "active" && siege.besiegerPolityId === by && siege.defenderPolityId === of)
    .reduce((sum, siege) => sum + siege.pressureBps, 0);
  const pressed = Math.round((besieging(a, b) - besieging(b, a)) / 1_000);
  if (pressed !== 0) { score += pressed; parts.push(pressed > 0 ? "has them under siege" : "is under siege"); }

  const landOf = (polityId: string) => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;
  const totalDefeat = landOf(b) === 0 || theirs === 0;
  if (totalDefeat) { score = 100; parts.push(landOf(b) === 0 ? "they hold no ground" : "they have no army"); }
  if (landOf(a) === 0 || ours === 0) { score = -100; parts.push(landOf(a) === 0 ? "it holds no ground" : "it has no army"); }

  score = Math.max(-100, Math.min(100, score));
  return { score, dictates: score >= DICTATE_AT, totalDefeat, days, parts };
}
