import type { WorldState } from "./world-state";
import { agreementsBetweenSides, atWar, type PolityAgreement } from "./agreements";

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
/** What a battle won is worth, and how many engaged make one large or great. */
const BATTLE_POINTS = 6;
/** A power with no army this long into a war has failed to raise one, and is beaten. */
const ARMY_RAISED_WITHIN_DAYS = 120;
/** The capital taken: the single greatest prize in a war. */
const CAPITAL_POINTS = 35;
const LARGE_BATTLE = 4_000;
const GREAT_BATTLE = 10_000;

/**
 * A battle into the war it was fought in: whichever war stands between the
 * two sides, a foedus ally's included (the Samnites' victory is Rome's war).
 * A fight between powers not at war -- a raid repelled -- is nobody's tally.
 */
export function recordBattle(agreements: readonly PolityAgreement[], battle: { readonly atStep: number; readonly winnerPolityId: string; readonly loserPolityId: string; readonly naval: boolean; readonly engaged: number }): PolityAgreement[] {
  const war = agreementsBetweenSides(agreements, battle.winnerPolityId, battle.loserPolityId).find((agreement) => agreement.kind === "war");
  if (war === undefined) return [...agreements];
  // Told as the war's own two parties won and lost it: an ally's victory is its leader's side's.
  const winnerIsFirst = battle.winnerPolityId === war.polityId || battle.loserPolityId === war.otherPolityId
    || (battle.winnerPolityId !== war.otherPolityId && battle.loserPolityId !== war.polityId && agreementsBetweenSides(agreements, battle.winnerPolityId, war.otherPolityId).some((agreement) => agreement.id === war.id));
  const told = { ...battle, winnerPolityId: winnerIsFirst ? war.polityId : war.otherPolityId, loserPolityId: winnerIsFirst ? war.otherPolityId : war.polityId };
  return agreements.map((agreement) => (agreement.id === war.id ? { ...agreement, battles: [...(agreement.battles ?? []), told].slice(-80) } : agreement));
}

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
  // Ground, cities and the capital, each as a share of what the loser has:
  // the map has six thousand provinces, and four Phoenician districts out of
  // Egypt's three hundred and eighty let Antiochus dictate the peace at
  // fifteen points each. Open country is worth up to twenty-five for all of
  // it; cities up to forty, so a power with three cities loses a great deal
  // with each, and an empire of a hundred hardly notices one; the capital is
  // the single greatest prize, thirty-five on its own.
  const landOwned = (polityId: string): number => world.map.provinces.filter((province) => (province.ownerPolityId ?? province.controllerPolityId) === polityId).length;
  const share = (loser: string, holder: string): number => {
    const owned = landOwned(loser);
    return owned === 0 ? 0 : takenFrom(loser, holder) / owned;
  };
  const citiesShare = (loser: string, holder: string): number => {
    let theirs = 0;
    let taken = 0;
    for (const province of world.map.provinces) {
      for (const city of province.settlements) {
        if ((province.ownerPolityId ?? province.controllerPolityId) !== loser && city.controllerPolityId !== loser) continue;
        theirs += 1;
        if (city.controllerPolityId === holder) taken += 1;
      }
    }
    return theirs === 0 ? 0 : taken / theirs;
  };
  const ground = takenFrom(b, a) - takenFrom(a, b);
  const groundScore = Math.round(25 * (share(b, a) - share(a, b)));
  if (ground !== 0) { score += groundScore; parts.push(`${ground > 0 ? "holds" : "has lost"} ${Math.abs(ground)} province${Math.abs(ground) === 1 ? "" : "s"}`); }
  const cityScore = Math.round(40 * (citiesShare(b, a) - citiesShare(a, b)));
  if (cityScore !== 0) { score += cityScore; parts.push(cityScore > 0 ? "holds cities of theirs" : "has lost cities to them"); }

  // A capital held is the war all but over.
  const capitalOf = (polityId: string) => world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  const cityHolder = (settlementId: string | null) => settlementId === null ? null
    : world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === settlementId)?.controllerPolityId ?? null;
  if (cityHolder(capitalOf(b)) === a) { score += CAPITAL_POINTS; parts.push("holds their capital"); }
  if (cityHolder(capitalOf(a)) === b) { score -= CAPITAL_POINTS; parts.push("their enemy holds its capital"); }

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

  // Battles won and lost, on land and at sea: a victory counts for more than
  // the men it killed, because it is what the world hears of a war. A great
  // battle counts double, and the whole is held to thirty either way.
  const battles = war?.battles ?? [];
  const weight = (battle: (typeof battles)[number]): number => BATTLE_POINTS * (battle.engaged >= GREAT_BATTLE ? 2 : battle.engaged >= LARGE_BATTLE ? 1.5 : 1);
  const won = battles.filter((battle) => battle.winnerPolityId === a);
  const lostBattles = battles.filter((battle) => battle.winnerPolityId === b);
  const battleScore = Math.max(-30, Math.min(30, Math.round(won.reduce((sum, battle) => sum + weight(battle), 0) - lostBattles.reduce((sum, battle) => sum + weight(battle), 0))));
  if (battleScore !== 0) {
    score += battleScore;
    const atSea = (list: typeof battles): string => { const count = list.filter((battle) => battle.naval).length; return count === 0 ? "" : `, ${count} at sea`; };
    parts.push(`has won ${won.length} battle${won.length === 1 ? "" : "s"}${atSea(won)} and lost ${lostBattles.length}${atSea(lostBattles)}`);
  }

  // Their cities under siege, and ours.
  const besieging = (by: string, of: string) => world.sieges.filter((siege) => siege.status === "active" && siege.besiegerPolityId === by && siege.defenderPolityId === of)
    .reduce((sum, siege) => sum + siege.pressureBps, 0);
  const pressed = Math.round((besieging(a, b) - besieging(b, a)) / 1_000);
  if (pressed !== 0) { score += pressed; parts.push(pressed > 0 ? "has them under siege" : "is under siege"); }

  const landOf = (polityId: string) => world.map.provinces.filter((province) => (province.controllerPolityId === polityId || province.settlements.some((city) => city.controllerPolityId === polityId))).length;
  // No army is defeat only once there has been time to raise one: most of the
  // world keeps none standing, and counting that from the first day made
  // every war with a levy-raising people won before it was fought.
  const raised = days >= ARMY_RAISED_WITHIN_DAYS;
  const totalDefeat = landOf(b) === 0 || (theirs === 0 && raised);
  if (totalDefeat) { score = 100; parts.push(landOf(b) === 0 ? "they hold no ground" : "they have no army"); }
  if (landOf(a) === 0 || (ours === 0 && raised)) { score = -100; parts.push(landOf(a) === 0 ? "it holds no ground" : "it has no army"); }

  score = Math.max(-100, Math.min(100, score));
  return { score, dictates: score >= DICTATE_AT, totalDefeat, days, parts };
}
