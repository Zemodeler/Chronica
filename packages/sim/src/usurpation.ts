import {
  RIVAL_OPINION,
  adjustPolityLegitimacy,
  allOffices,
  computeOpinion,
  stableHash,
  type ActKind,
  type FactProposalDraft,
  type Office,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { seatsOf } from "./ballots";
import { remember, type Grievance } from "./grievances";
import { safeLocalId } from "./safe-local-id";

/**
 * The man who did it without leave (the user's rule, 2026-10-08): "If the player says 'propose to declare war' the Senate votes; if he says 'I declare war'
 * the engine takes the consequences of that action: he said it, it happened."
 *
 * A magistrate who holds the office whose competence says an act is the chamber's (a consul and a war: the Senate's) may still say it and do it. It is done at
 * once, as a usurpation: nobody's vote stood behind it, and the republic answers him for it, in the ways it had. A colleague of equal power may stop him before
 * it is done (*par potestas*), and so may a tribune, as ever -- but not the chamber's vote, for no vote is asked. A man who holds no such office says it and nobody
 * follows (`nobodyListens`), and a king, whose act it is, does it as before.
 *
 * What it costs is in proportion to the act (`GRAVITY`): war and alliance are the heaviest, coin, tribute and the levy lighter. All of it is by rule, from the
 * act and the men, with no roll but the bounded one for strife in the city.
 */

/** How grave an act is to do without leave, 1 to 5. */
export const GRAVITY: Readonly<Record<ActKind, number>> = {
  war: 5, pacts: 4, peace: 3, embargoes: 3, levy: 2, tax_rate: 2, coinage: 2, loans: 2, appointment: 2, customs: 1, grain: 1, spending: 1,
};

/** The gravity of a particular act: an alliance weighs more than a pact of trade. */
export function gravityOf(act: ActKind, delta?: WorldDelta): number {
  const base = GRAVITY[act];
  if (delta === undefined || act !== "pacts") return base;
  const kind = delta.op === "agreement_open" ? delta.kind : null;
  if (kind === "alliance" || kind === "foedus") return 5;
  if (kind === "trade_pact" || kind === "non_aggression") return 2;
  return base;
}

/** What was done, by whom of what office, before which body: enough to say the cost. */
export interface UsurpedAct {
  readonly act: ActKind;
  readonly polityId: string;
  /** In the words of the act: "war be made on Carthage". */
  readonly label: string;
  readonly gravity: number;
  readonly officeId: string;
  readonly officeLabel: string;
  /** The chamber whose act it was. */
  readonly bodyId: string;
}

/** Days a usurpation is remembered by the Senate's purse and the vote on his command. */
export const USURPATION_YEAR_DAYS = 365;

const BLOC_WANTS: Readonly<Partial<Record<ActKind, readonly string[]>>> = {
  war: ["war_weary", "commons", "merchants", "landed"], pacts: ["nobles", "merchants"], peace: ["soldiers", "veterans"], levy: ["landed", "commons"],
  tax_rate: ["landed", "commons", "debtors"], coinage: ["creditors", "merchants"], loans: ["creditors", "merchants"],
};

/** The colleague, or the tribune, who forbids it before it is done: the reason in words, or null. */
export function stoppedBefore(world: WorldState, actorId: string, act: UsurpedAct, offices: readonly Office[]): string | null {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined) return null;
  const seats = world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null);
  const alive = (id: string): boolean => world.characters.some((character) => character.id === id && character.alive);
  // A colleague of equal power who thinks ill of him will not let it be (*par potestas*).
  for (const seat of seats) {
    if (seat.officeId !== act.officeId || seat.holderCharacterId === actorId || !alive(seat.holderCharacterId!)) continue;
    const colleague = world.characters.find((character) => character.id === seat.holderCharacterId)!;
    if (computeOpinion(colleague, actorId) <= RIVAL_OPINION) {
      return `${colleague.name}, who holds the same office as ${actor.name} and thinks ill of him, forbade it: either may act, and the other may stop him, and he stopped it.`;
    }
  }
  // A word of intercession already given against him, by a colleague or a tribune, that stands for this act or for all.
  const all = allOffices(world, offices);
  for (const entity of world.genericEntities) {
    if (!/intercession/i.test(entity.kind) || "retiredAtStep" in entity.attributes || entity.ownerRef?.kind !== "character" || entity.attributes.against !== actorId) continue;
    const named = String(entity.attributes.act ?? "all").toLowerCase();
    if (named !== "all" && named !== act.act && named !== "war" && named !== "levy") continue;
    if (named === "war" && act.act !== "war") continue;
    if (named === "levy" && act.act !== "levy") continue;
    const owner = world.characters.find((character) => character.id === entity.ownerRef!.id && character.alive);
    if (owner === undefined) continue;
    const held = seats.filter((seat) => seat.holderCharacterId === owner.id).map((seat) => all.find((office) => office.id === seat.officeId)).filter((office): office is Office => office !== undefined);
    const tribune = held.find((office) => office.tribunician === true && office.polityId === act.polityId);
    const colleague = held.find((office) => office.id === act.officeId);
    if (tribune !== undefined) return `${owner.name}, as ${tribune.label}, has interceded against ${actor.name}, and nobody in the city would act against a tribune's word while it stands.`;
    if (colleague !== undefined) return `${owner.name}, his colleague as ${colleague.label}, has interceded against ${actor.name}: what one of two of equal power does, the other may stop while his word stands.`;
  }
  return null;
}

/** Whether a man stands under a usurpation of his not yet a year old: the Senate's purse is shut to him, and his command is not prorogued. */
export function usurpedLately(world: WorldState, characterId: string): boolean {
  return world.answerable.some((entry) => entry.characterId === characterId && entry.kind === "usurpation" && world.elapsedStep - entry.atStep < USURPATION_YEAR_DAYS);
}

/**
 * What the act costs the man who did it, once it is done: his name with the city and the chamber, his gens's quarrels, the tribunes' hostility, a charge to
 * answer for when his office ends, the Senate's purse and his prorogation, and, for the gravest acts, a bounded risk of strife in the city.
 */
export function consequencesOfUsurping(world: WorldState, actorId: string, usurped: UsurpedAct, offices: readonly Office[] = []): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined) return { world, facts: [] };
  const day = world.elapsedStep;
  const { gravity, act, polityId } = usurped;
  const polity = world.map.polities.find((candidate) => candidate.id === polityId)?.name ?? polityId;
  const chamber = world.material.institutions.find((institution) => institution.id === usurped.bodyId);
  const what = usurped.label;
  const facts: FactProposalDraft[] = [];
  let next = world;

  // The state's own standing: heavier the graver the act.
  next = { ...next, material: { ...next.material, polityLegitimacy: adjustPolityLegitimacy(next.material.polityLegitimacy, polityId, -gravity * 150, `${actor.name} did without leave what the ${chamber?.name ?? "chamber"} decides`, `usurped:${actorId}:${day}`) } };

  // The chamber's blocs think the less of him, those whose interest the act touches the most; and every named senator remembers it.
  const wants = BLOC_WANTS[act] ?? [];
  const grievances: Grievance[] = [];
  if (chamber !== undefined) {
    const seats = seatsOf(next, chamber, new Set());
    const blocs = chamber.votingBlocs.map((bloc) => {
      const touched = (bloc.interests ?? []).some((interest) => wants.includes(interest));
      return { bloc, drop: gravity * 3 + (touched ? gravity * 2 : 0) };
    });
    next = {
      ...next,
      material: {
        ...next.material,
        institutions: next.material.institutions.map((institution) => (institution.id !== chamber.id ? institution : {
          ...institution,
          votingBlocs: institution.votingBlocs.map((bloc) => {
            const drop = blocs.find((entry) => entry.bloc.id === bloc.id)?.drop ?? 0;
            return drop === 0 ? bloc : { ...bloc, causes: [...bloc.causes, { id: `usurped-${actorId}-${day}-${bloc.id}`.slice(0, 100), label: `${actor.name} ${what} without the ${chamber.name}`.slice(0, 160), score: -drop, sourceId: actorId }].slice(-12) };
          }),
        })),
      },
    };
    for (const [blocId, men] of seats) {
      const drop = blocs.find((entry) => entry.bloc.id === blocId)?.drop ?? gravity * 3;
      for (const man of men) {
        if (man.characterId === null || man.characterId === actorId) continue;
        grievances.push({ subjectCharacterId: man.characterId, targetCharacterId: actorId, label: `He ${what}, and never asked the ${chamber.name}.`.slice(0, 200), score: -Math.min(20, Math.round(drop / 2) + gravity), dimensions: { trust: -Math.min(40, drop * 2) } });
      }
    }
  }
  // The tribunes will not forget it, nor his colleague.
  const all = allOffices(next, offices);
  const tribunes = next.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && seat.holderCharacterId !== actorId
    && all.find((office) => office.id === seat.officeId)?.tribunician === true);
  for (const seat of tribunes) {
    grievances.push({ subjectCharacterId: seat.holderCharacterId!, targetCharacterId: actorId, label: `He ${what} and the people were not asked.`.slice(0, 200), score: -Math.min(20, gravity * 4), dimensions: { trust: -Math.min(50, gravity * 8) } });
  }
  const colleagues = next.material.officeSeats.filter((seat) => seat.status === "held" && seat.officeId === usurped.officeId && seat.holderCharacterId !== null && seat.holderCharacterId !== actorId);
  for (const seat of colleagues) {
    grievances.push({ subjectCharacterId: seat.holderCharacterId!, targetCharacterId: actorId, label: `His colleague ${what} without him, and without the ${chamber?.name ?? "chamber"}.`.slice(0, 200), score: -Math.min(20, gravity * 3 + 2), dimensions: { trust: -Math.min(50, gravity * 8) } });
  }
  next = remember(next, grievances.slice(0, 160), day, `usurped:${actorId}:${act}:${day}`);

  // A feud between his gens and his colleague's, and the gens of the senator who thinks worst of him.
  const quarrels = new Set<string>();
  for (const seat of colleagues) {
    const gens = next.characters.find((character) => character.id === seat.holderCharacterId)?.dynastyId;
    if (gens != null) quarrels.add(gens);
  }
  const worst = grievances.map((entry) => next.characters.find((character) => character.id === entry.subjectCharacterId)).filter((character) => character?.dynastyId != null && character.dynastyId !== actor.dynastyId)
    .sort((a, b) => computeOpinion(a!, actorId) - computeOpinion(b!, actorId) || a!.id.localeCompare(b!.id))[0];
  if (worst?.dynastyId != null) quarrels.add(worst.dynastyId);
  if (actor.dynastyId != null) {
    const mine = actor.dynastyId;
    next = {
      ...next,
      gentes: next.gentes.map((gens) => {
        if (!quarrels.has(gens.id) || gens.id === mine) return gens;
        const heat = 1_500 + gravity * 400;
        const old = gens.feuds.find((feud) => feud.againstGensId === mine);
        const reason = `${actor.name} ${what} without the ${chamber?.name ?? "chamber"}`.slice(0, 240);
        return { ...gens, feuds: old === undefined
          ? [...gens.feuds, { againstGensId: mine, reason, sinceStep: day, renewedAtStep: day, intensityBps: Math.min(10_000, heat) }].slice(-12)
          : gens.feuds.map((feud) => (feud === old ? { ...feud, reason, renewedAtStep: day, intensityBps: Math.min(10_000, feud.intensityBps + heat) } : feud)) };
      }),
    };
  }

  // What he will answer for when his office no longer covers him, and what the purse and the vote on his command remember.
  next = { ...next, answerable: [...next.answerable, {
    characterId: actorId, polityId, kind: "usurpation" as const, label: `${what}, without the ${chamber?.name ?? "chamber"}`.slice(0, 240), atStep: day, weight: Math.max(1, gravity - 1),
  }].slice(-400) };

  // Strife in the city: the city's order goes down with the act; for the gravest acts, and the lower the state's standing, a bounded chance of worse.
  const standing = next.material.polityLegitimacy.find((entry) => entry.polityId === polityId)?.legitimacyBps ?? 5_000;
  const riskBps = gravity >= 4 ? (gravity - 3) * 600 + (standing < 4_000 ? 1_200 : 0) : 0;
  const strife = riskBps > 0 && stableHash([actorId, act, String(day), "strife"]) % 10_000 < riskBps;
  const capitalId = world.map.polities.find((candidate) => candidate.id === polityId)?.capitalSettlementId;
  const city = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capitalId))?.id;
  const unrest = gravity * 120 + (strife ? 1_500 : 0);
  next = { ...next, material: { ...next.material, provinceMaterial: next.material.provinceMaterial.map((row) => {
    const hit = row.provinceId === city || (strife && world.map.provinces.some((province) => province.id === row.provinceId && province.controllerPolityId === polityId));
    return hit ? { ...row, stabilityBps: Math.max(0, row.stabilityBps - (row.provinceId === city ? unrest : Math.round(unrest / 3))) } : row;
  }) } };

  const officeOf = usurped.officeLabel;
  facts.push({
    localId: safeLocalId(`usurped_${actorId}_${act}`).slice(0, 60),
    kind: "act_usurped",
    summary: `${actor.name}, ${officeOf}, ordered that ${what} on his own word, without the ${chamber?.name ?? "chamber"}. It is done, and the city holds it unlawful: his colleagues, the tribunes and the senators will not forget it, the ${chamber?.name ?? "chamber"} will vote him nothing for it, and he will answer for it when his office ends.${strife ? ` The city is in uproar.` : ""}`.slice(0, 600),
    affectedRefs: [{ kind: "character", id: actorId }, { kind: "polity", id: polityId }, ...(chamber === undefined ? [] : [{ kind: "institution" as const, id: chamber.id }])],
    visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 30 + gravity * 10,
  });
  void polity;
  return { world: next, facts };
}
