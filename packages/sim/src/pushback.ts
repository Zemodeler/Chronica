import {
  FactProposalSchema,
  WorldDeltaSchema,
  agreementsBetween,
  difficultyRules,
  isStanding,
  leaderOf,
  ownerOf,
  readDepartments,
  warsOf,
  type Alarm,
  type FactProposal,
  type FactProposalDraft,
  type Holdings,
  type PolityStance,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { readBoard } from "./board";
import type { StatecraftDecision } from "./statecraft";

/**
 * The world pushes back (docs/plans/a-living-world.md §5).
 *
 * The rule: the world organises against power in proportion to how fast and
 * how roughly it grows, and it always warns first. Once a month, beside the
 * world AI's pass:
 *
 * - **Alarm.** Each power's fear of each power around it is read from how
 *   much land that power has gained in a year, set against its size, how many
 *   wars it began and how many peaces it broke; nearer and smaller powers fear
 *   more. It fades a tenth a month. Crossing into fear is news: "in Samnium
 *   they speak of Rome's growing power with dread".
 * - **Leagues.** Two or more powers that fear the same power past the
 *   coalition bar, and together come near its strength, ally against it. A war
 *   on one member brings the rest in.
 * - **Balancers.** A great power that fears another pays its enemies.
 * - **Reputation.** A power that breaks a peace loses the trust of everyone
 *   around it.
 * - **Allies want their share.** A people bound by foedus sours on a leader
 *   whose wars drag on, and warms again in peace.
 *
 * The difficulty chosen at game creation scales all of it against the
 * player's power, and against nobody else.
 */

/** Alarm fades this much a month. */
const ALARM_DECAY = 0.9;
/** At this, a power's fear is news. */
const FEAR_AT = 50;
/** A coalition against a power other than the player's forms at this. */
const COALITION_AT = 60;
/** Together the league must come this near the strength of the power it fears. */
const COALITION_STRENGTH = 0.6;
/** A great power pays an enemy of the power it fears this share of its chest, at most `SUBSIDY_CAP`, once a season. */
const SUBSIDY_SHARE = 0.05;
const SUBSIDY_CAP = 600;
const SUBSIDY_EVERY_DAYS = 90;
/** A great power, for paying others' wars. */
const GREAT_POWER = 20_000;
/** Trust lost by everyone around a power that breaks a peace. */
const BROKEN_PEACE_TRUST = 12;

export interface PushbackResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** Acts to be applied as the world's business: leagues, calls to arms, subsidies. */
  readonly decisions: StatecraftDecision[];
}

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
const fact = (raw: Record<string, unknown>): FactProposal => FactProposalSchema.parse(raw);

export function reviewPushback(world: WorldState, playerPolityId: string | null, excludedPolityIds: ReadonlySet<string>): PushbackResult {
  const day = world.instant.day;
  const rules = difficultyRules(world.difficulty);
  const board = readBoard(world);
  const rulers = readDepartments(world);
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const facts: FactProposalDraft[] = [];
  const decisions: StatecraftDecision[] = [];

  // ── The month's holdings, and a year's growth ──────────────────────────
  const owned = new Map<string, number>();
  for (const province of world.map.provinces) {
    const owner = ownerOf(province);
    if (owner !== null) owned.set(owner, (owned.get(owner) ?? 0) + 1);
  }
  const standing = world.map.polities.filter(isStanding);
  const snapshot: Holdings[] = standing.map((polity) => ({ polityId: polity.id, atStep: day, provinces: owned.get(polity.id) ?? 0 }));
  const holdings = [...world.holdings.filter((entry) => day - entry.atStep <= 400), ...snapshot].slice(-4_000);
  const yearAgo = (polityId: string): number => {
    const past = holdings.filter((entry) => entry.polityId === polityId && day - entry.atStep >= 330).sort((a, b) => a.atStep - b.atStep)[0]
      ?? holdings.filter((entry) => entry.polityId === polityId).sort((a, b) => a.atStep - b.atStep)[0];
    return past?.provinces ?? owned.get(polityId) ?? 0;
  };

  // Wars begun, and peaces broken, within the year.
  const begun = new Map<string, number>();
  const broke = new Map<string, number>();
  const brokenNow: { breaker: string; victim: string }[] = [];
  for (const war of world.polityAgreements) {
    if (war.kind !== "war" || day - war.sinceStep > 365) continue;
    begun.set(war.polityId, (begun.get(war.polityId) ?? 0) + 1);
    const brokenPeace = world.polityAgreements.some((agreement) => (agreement.kind === "peace" || agreement.kind === "non_aggression" || agreement.kind === "truce")
      && agreement.endedAtStep === war.sinceStep
      && ((agreement.polityId === war.polityId && agreement.otherPolityId === war.otherPolityId) || (agreement.polityId === war.otherPolityId && agreement.otherPolityId === war.polityId)));
    if (!brokenPeace) continue;
    broke.set(war.polityId, (broke.get(war.polityId) ?? 0) + 1);
    if (day - war.sinceStep <= 30) brokenNow.push({ breaker: war.polityId, victim: war.otherPolityId });
  }

  // ── Alarm ──────────────────────────────────────────────────────────────
  const previous = new Map(world.alarm.map((entry) => [`${entry.polityId}>${entry.towardPolityId}`, entry]));
  const alarm: Alarm[] = [];
  for (const reading of board.values()) {
    for (const neighbour of reading.neighbours) {
      // How much `reading`'s power fears `neighbour`'s.
      const them = neighbour.polityId;
      const now = owned.get(them) ?? 0;
      const gained = Math.max(0, now - yearAgo(them));
      const growth = gained / Math.max(3, now - gained);
      const gain = them === playerPolityId ? rules.alarmGain : 1;
      const near = neighbour.bordering ? 1 : 0.6;
      const bigger = neighbour.ratio >= 2 ? 0.5 : 1;
      const raw = (120 * growth + 10 * (begun.get(them) ?? 0) + 20 * (broke.get(them) ?? 0)) * gain * near * bigger;
      const target = Math.max(0, Math.min(100, Math.round(raw)));
      const key = `${reading.polityId}>${them}`;
      const before = previous.get(key);
      const level = Math.max(target, Math.round((before?.level ?? 0) * ALARM_DECAY));
      if (level <= 0) continue;
      const why = target >= (before?.level ?? 0)
        ? [gained > 0 ? `${nameOf(them)} has taken ${gained} province${gained === 1 ? "" : "s"} in a year` : null, (begun.get(them) ?? 0) > 0 ? `begun ${begun.get(them)} war${begun.get(them) === 1 ? "" : "s"}` : null, (broke.get(them) ?? 0) > 0 ? "broken a peace" : null].filter((part): part is string => part !== null).join(", ") || "old fears"
        : before?.why ?? "old fears";
      alarm.push({ polityId: reading.polityId, towardPolityId: them, level, why: why.slice(0, 240), updatedAtStep: day });
      if (level >= FEAR_AT && (before?.level ?? 0) < FEAR_AT) {
        facts.push({
          localId: `fear_${reading.polityId}_${them}`.slice(0, 60),
          kind: "rumour",
          summary: `In ${reading.name} they speak of ${nameOf(them)}'s growing power with dread: ${why}.`.slice(0, 400),
          affectedRefs: [{ kind: "polity", id: reading.polityId }, { kind: "polity", id: them }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
        });
      }
    }
  }
  const alarmOf = (from: string, toward: string): number => alarm.find((entry) => entry.polityId === from && entry.towardPolityId === toward)?.level ?? 0;

  // ── Reputation: a broken peace costs trust all round ───────────────────
  let stances: PolityStance[] = [...world.polityStances];
  const shift = (from: string, toward: string, by: number, why: string): void => {
    const index = stances.findIndex((stance) => stance.polityId === from && stance.towardPolityId === toward);
    if (index === -1) { stances.push({ polityId: from, towardPolityId: toward, trustScore: Math.max(-100, Math.min(100, by)), lastShiftReason: why.slice(0, 240), lastShiftAtStep: day }); return; }
    const stance = stances[index]!;
    stances[index] = { ...stance, trustScore: Math.max(-100, Math.min(100, stance.trustScore + by)), lastShiftReason: why.slice(0, 240), lastShiftAtStep: day };
  };
  for (const { breaker, victim } of brokenNow) {
    const around = [...board.values()].filter((reading) => reading.polityId !== breaker && reading.neighbours.some((neighbour) => neighbour.polityId === breaker));
    for (const reading of around) shift(reading.polityId, breaker, -BROKEN_PEACE_TRUST, `${nameOf(breaker)} broke its peace with ${nameOf(victim)}.`);
    if (around.length > 0) {
      facts.push({
        localId: `faithless_${breaker}_${victim}`.slice(0, 60), kind: "reputation",
        summary: `${nameOf(breaker)} broke its peace with ${nameOf(victim)}, and its neighbours will remember what its word is worth.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: breaker }, { kind: "polity", id: victim }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
      });
    }
  }

  // ── Allies want their share ────────────────────────────────────────────
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "foedus") continue;
    const follower = agreement.polityId;
    const leader = agreement.otherPolityId;
    const longWar = world.polityAgreements.some((war) => war.status === "active" && war.kind === "war" && (war.polityId === leader || war.otherPolityId === leader) && day - war.sinceStep > 365);
    const trust = stances.find((stance) => stance.polityId === follower && stance.towardPolityId === leader)?.trustScore ?? 0;
    if (longWar) shift(follower, leader, -2, `${nameOf(leader)}'s war drags on, and ${nameOf(follower)} sends the men and bears the dead.`);
    else if (trust < 30 && warsOf(world.polityAgreements, leader).length === 0) shift(follower, leader, 1, `A season of peace under ${nameOf(leader)}.`);
  }

  // ── Leagues ────────────────────────────────────────────────────────────
  const strengthOf = (polityId: string): number => board.get(polityId)?.strength ?? 0;
  const blocStrength = (polityId: string): number => {
    const leader = leaderOf(world.polityAgreements, polityId) ?? polityId;
    return [leader, ...world.polityAgreements.filter((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.otherPolityId === leader).map((agreement) => agreement.polityId)]
      .reduce((sum, id) => sum + strengthOf(id), 0);
  };
  const rulerOf = (polityId: string) => rulers.rulers(polityId).find((ruler) => ruler.alive);
  const feared = new Set(alarm.map((entry) => entry.towardPolityId));
  for (const target of feared) {
    const bar = target === playerPolityId ? rules.coalitionAt : COALITION_AT;
    const members = [...new Set(alarm.filter((entry) => entry.towardPolityId === target && entry.level >= bar).map((entry) => entry.polityId))]
      .filter((id) => !excludedPolityIds.has(id) && rulerOf(id) !== undefined && leaderOf(world.polityAgreements, id) === null
        && agreementsBetween(world.polityAgreements, id, target).every((agreement) => agreement.kind !== "alliance" && agreement.kind !== "foedus" && agreement.kind !== "protectorate"))
      .sort((a, b) => strengthOf(b) - strengthOf(a) || a.localeCompare(b));
    if (members.length < 2) continue;
    if (members.reduce((sum, id) => sum + strengthOf(id), 0) < COALITION_STRENGTH * blocStrength(target)) continue;
    const head = members[0]!;
    const leagued = (id: string): boolean => world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && agreement.against === target
      && (agreement.polityId === id || agreement.otherPolityId === id));
    const joining = members.slice(1).filter((id) => !world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && agreement.against === target
      && ((agreement.polityId === head && agreement.otherPolityId === id) || (agreement.polityId === id && agreement.otherPolityId === head))));
    if (joining.length === 0) continue;
    const ruler = rulerOf(head)!;
    const why = `${nameOf(target)} has grown too fast to be borne: ${alarm.find((entry) => entry.polityId === head && entry.towardPolityId === target)?.why ?? "its wars"}`;
    decisions.push({
      polityId: head, actorCharacterId: ruler.id, act: "alliance", targetPolityId: target, why: why.slice(0, 400),
      deltas: joining.map((id) => delta({
        op: "agreement_open", localId: `league_${head}_${id}`.slice(0, 60), kind: "alliance", polityId: head, otherPolityId: id,
        terms: `${nameOf(head)} and ${nameOf(id)} league together against ${nameOf(target)}: a war on one is a war on all.`.slice(0, 600),
        forDays: null, sourceMessageRef: null, visibility: "public", reason: why.slice(0, 240),
      })),
      facts: [fact({
        localId: `league_against_${target}`.slice(0, 60), kind: "alliance_made",
        summary: `${[head, ...joining].map(nameOf).join(", ")} ${leagued(head) ? "widened their league" : "leagued together"} against ${nameOf(target)}: a war on one is a war on all.`.slice(0, 400),
        affectedRefs: [...[head, ...joining].map((id) => ({ kind: "polity" as const, id })), { kind: "polity" as const, id: target }].slice(0, 16),
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 70,
      })],
    });
  }

  // ── A war on one is a war on all ───────────────────────────────────────
  for (const league of world.polityAgreements) {
    if (league.status !== "active" || league.kind !== "alliance" || league.against == null) continue;
    const target = league.against;
    for (const [member, partner] of [[league.polityId, league.otherPolityId], [league.otherPolityId, league.polityId]] as const) {
      if (excludedPolityIds.has(member) || warsOf(world.polityAgreements, member).includes(target)) continue;
      if (!warsOf(world.polityAgreements, partner).includes(target)) continue;
      if (decisions.some((decision) => decision.polityId === member && decision.act === "declare_war")) continue;
      const ruler = rulerOf(member);
      if (ruler === undefined) continue;
      decisions.push({
        polityId: member, actorCharacterId: ruler.id, act: "declare_war", targetPolityId: target,
        why: `called to arms by ${nameOf(partner)}, its partner in the league against ${nameOf(target)}`.slice(0, 400),
        deltas: [delta({ op: "agreement_open", localId: `call_${member}_${target}`.slice(0, 60), kind: "war", polityId: member, otherPolityId: target, terms: `${nameOf(member)} keeps faith with ${nameOf(partner)} and goes to war with ${nameOf(target)}.`.slice(0, 600), forDays: null, sourceMessageRef: null, visibility: "public", reason: "The league's oath." })],
        facts: [],
      });
    }
  }

  // ── Balancers pay the feared power's enemies ───────────────────────────
  for (const reading of board.values()) {
    if (excludedPolityIds.has(reading.polityId) || reading.strength < GREAT_POWER) continue;
    const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === reading.polityId && account.status === "active");
    const ruler = rulerOf(reading.polityId);
    if (chest === undefined || chest.balance < 1_000 || ruler === undefined) continue;
    const fearedMost = alarm.filter((entry) => entry.polityId === reading.polityId && entry.level >= FEAR_AT).sort((a, b) => b.level - a.level)[0];
    if (fearedMost === undefined || warsOf(world.polityAgreements, reading.polityId).includes(fearedMost.towardPolityId)) continue;
    const enemy = warsOf(world.polityAgreements, fearedMost.towardPolityId).find((id) => id !== reading.polityId
      && (stances.find((stance) => stance.polityId === reading.polityId && stance.towardPolityId === id)?.trustScore ?? 0) >= -10);
    if (enemy === undefined) continue;
    if (world.statecraft.log.some((entry) => entry.act === "subsidy" && entry.polityId === reading.polityId && entry.targetPolityId === enemy && day - entry.day < SUBSIDY_EVERY_DAYS)) continue;
    const theirChest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === enemy && account.status === "active");
    if (theirChest === undefined) continue;
    const amount = Math.min(SUBSIDY_CAP, Math.round(chest.balance * SUBSIDY_SHARE));
    decisions.push({
      polityId: reading.polityId, actorCharacterId: ruler.id, act: "subsidy", targetPolityId: enemy,
      why: `pays ${nameOf(enemy)} to keep ${nameOf(fearedMost.towardPolityId)} busy`.slice(0, 400),
      deltas: [delta({ op: "money_transfer", fromAccountRef: chest.id, toAccountRef: theirChest.id, amount, reason: `${reading.name}'s gold for the war against ${nameOf(fearedMost.towardPolityId)}.`.slice(0, 240) })],
      facts: [fact({
        localId: `subsidy_${reading.polityId}_${enemy}`.slice(0, 60), kind: "subsidy",
        summary: `${reading.name}'s gold reached ${nameOf(enemy)}, for its war against ${nameOf(fearedMost.towardPolityId)}.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: reading.polityId }, { kind: "polity", id: enemy }, { kind: "polity", id: fearedMost.towardPolityId }],
        visibility: "public", discoveryState: "rumoured", knowableInDays: 10, significance: 45,
      })],
    });
  }

  stances = stances.slice(0, 5_000);
  return { world: { ...world, alarm: alarm.slice(0, 2_000), holdings, polityStances: stances }, facts, decisions };
}

/** How much one power fears another, 0 to 100. */
export function alarmOf(world: WorldState, from: string, toward: string): number {
  return world.alarm.find((entry) => entry.polityId === from && entry.towardPolityId === toward)?.level ?? 0;
}
