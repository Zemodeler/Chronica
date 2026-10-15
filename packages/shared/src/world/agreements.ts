import type { WorldState } from "./world-state";
import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import { GoodIdSchema, type GoodId } from "./good-ids";

/**
 * What two powers have standing between them (VISION §3, §27).
 *
 * Before this, the world held a trust score and nothing else, so "are Rome and
 * Carthage at war?" could not be answered from state at all -- only inferred
 * from prose, from whether armies happened to be fighting, and from a number
 * between -100 and 100. §3 puts treaty continuity squarely under what software
 * owns and §27 asks the orchestrator's slice to carry active wars; neither was
 * true.
 *
 * A war is a record like any other. What makes it a war is its kind, which is
 * why peace, alliance and tribute live here too: they are the same shape of
 * fact about two powers, they begin and end the same way, and a system that
 * modelled war alone would need a second one the moment anybody made peace.
 *
 * Deliberately not scored. How much a power *likes* another is `PolityStance`
 * and moves constantly; what they have *agreed* is this, and changes only when
 * somebody changes it.
 */

export const PolityAgreementKindSchema = z.enum([
  "war",
  "truce",
  "peace",
  "alliance",
  "non_aggression",
  "tributary",
  "trade_pact",
  /**
   * One power keeps its own government and another answers for it abroad.
   *
   * The kind this scenario is actually about and the only one it had no word
   * for. A city offered its own laws under somebody else's protection is not
   * an ally -- it is not an equal and has promised no army -- and it is not a
   * tributary, because it pays nothing. `messana-invites-a-protector` gates
   * the war that follows it, and what Messana was offered could be written in
   * a letter, accepted in a reply, and then recorded nowhere: the arrangement
   * that started the First Punic War left nothing standing in the world.
   *
   * Ordered like tribute, and for the same reason: the protected power is
   * named first, because which of the two is which is the whole of the terms.
   */
  "protectorate",
  /**
   * Leave to march an army across somebody else's land.
   *
   * Ordered like tribute: the power granted passage is named first, the host
   * second. It changes nothing a battle computes. What it changes is whether
   * the host has been wronged -- an army that crosses a border without it is
   * trespassing, the host hears of it, and the host may do something about it.
   */
  "military_access",
  /**
   * An ally bound to a leading power: Rome and its socii.
   *
   * Not a vassal and not a tributary. The Samnites, Lucanians and Etruscan
   * cities kept their own magistrates and laws and paid Rome nothing. What
   * they gave up was a foreign policy of their own: they sent men when Rome
   * called, fought Rome's wars, and made no war or peace but Rome's. So the
   * engine treats the ally as sharing its leader's wars and peaces (`atWar`),
   * refuses it treaties of its own with anybody else, and lets it fight at its
   * leader's side. It pays in soldiers, not in money.
   *
   * Ordered like tribute: the ally first, the leading power second. An ally
   * leaves by ending the foedus or by going to war with its leader -- which is
   * what a revolt is, and it ends the foedus in the same act.
   */
  "foedus",
  /**
   * One power forbids trade with another: all of it, or the goods listed in
   * its `trade` terms.
   *
   * Ordered like tribute, and for a different reason: it is one power's act,
   * not a bargain, so the order says who laid it. The route is shut both ways
   * (a merchant of the other power cannot sell in the embargoer's markets, and
   * the embargoer's cannot buy in the other's), because a one-way embargo on
   * trade is only a tariff. It stands until the embargoer closes it
   * (`agreement_close`) or its term runs out, and it does not need a war.
   */
  "embargo",
  // Named, so the orchestrator and cognition schemas write the list once and
  // refer to it, rather than spelling it out at each of its six uses.
]).meta({ id: "AgreementKind" });
export type PolityAgreementKind = z.infer<typeof PolityAgreementKindSchema>;

/**
 * Each kind as a noun a sentence can carry: "the military_access between Rome
 * and the Ardiaei" is what a raw id reads like when it reaches a Chronicle.
 */
export const AGREEMENT_KIND_IN_WORDS: Record<PolityAgreementKind, string> = {
  war: "war",
  truce: "truce",
  peace: "peace",
  alliance: "alliance",
  non_aggression: "pact of non-aggression",
  tributary: "tributary arrangement",
  trade_pact: "trade pact",
  protectorate: "protectorate",
  military_access: "grant of passage for armies",
  foedus: "foedus",
  embargo: "embargo",
};

/**
 * What each kind actually does, for a player who asks.
 *
 * Said as the engine enforces it and no further (`sim/treaties.ts` keeps the
 * payments, the breaches and the calls to arms): a player reading "an ally
 * must come to your aid" expects exactly what the rule makes happen.
 */
export const AGREEMENT_KIND_EXPLAINED: Record<PolityAgreementKind, string> = {
  war: "The two powers are at war. Their armies may fight, besiege and take each other's ground, and every ally bound to either by foedus is at war too. A war ends any peace, truce, alliance, pact of non-aggression, tribute or foedus between them, and whatever it paid stops; a trade pact is only suspended, and comes back with the peace. Breaking a peace, truce, pact or alliance to make it costs the breaker at home and in the trust of every power that deals with it, unless it had a grievance to make war over.",
  truce: "The fighting stops until a set day. On that day the truce ends by itself, and the war may begin again.",
  peace: "The war between them is over, on the terms written. An indemnity in it is paid by the period; unpaid three times, the treaty is broken and the power owed has cause for war. It lasts until one of them breaks it, and breaking it is a new war.",
  alliance: "Equals who have promised to stand by each other. Their armies may cross each other's land without leave. When one is attacked it calls on the other, who goes to war or refuses -- and a refusal costs it the ally's trust. Neither is called to a war it began.",
  non_aggression: "Each has promised not to attack the other. It promises nothing more.",
  tributary: "One power pays the other a tenth of what its lands yield each month, unless the terms set another sum. It keeps its own government. Tribute unpaid three times breaks the treaty and gives the power owed cause for war.",
  trade_pact: "Their merchants may trade with each other on the terms written: a cap on the customs either may lay on the other's goods, goods let in free, and perhaps the lowest rate either gives anyone. A war between them suspends it (nothing crosses the line while the armies are out), and it resumes by itself on the day the war ends; it is not ended. An embargo laid by either on the other overrides it.",
  protectorate: "One power keeps its own government and laws, and another answers for it abroad. The protector's armies may stand on its ground without leave.",
  military_access: "Leave for one power's armies to march across the other's land. Without it, an army that crosses the border is trespassing, and the host may answer for it.",
  foedus: "An ally bound to a leading power, as Rome's Italian allies are. It keeps its own magistrates and laws and pays nothing, but fights its leader's wars and makes no war, peace or treaty of its own. When its leader goes to war it sends a contingent of its own men, under its own commander.",
  embargo: "One power forbids trade with the other: every good, or only those named. No merchant carries them between the two powers' markets in either direction until the embargoer closes it or its term runs out. Laying one on a power it holds a trade pact with, without ending the pact first, breaks the pact and costs trust.",
};

/**
 * What a trade pact or an embargo says besides its words (`terms`), in a form
 * the markets can read. All optional, so a pact written in a letter with only
 * words is a pact with no special terms: it caps nothing, and its partners
 * trade at each power's ordinary customs.
 */
export const TradeTermsSchema = z
  .object({
    /** The most customs either power may lay on the other's goods (basis points of their value), or no cap. */
    tariffCapBps: z.number().int().min(0).max(5_000).nullable().default(null),
    /** Each pays the other no more than the lowest rate either has agreed with any other power. */
    mostFavoured: z.boolean().default(false),
    /** Goods that enter free of customs between them. */
    exempt: z.array(GoodIdSchema).max(6).default([]),
    /** For an embargo: the goods it forbids. Empty is every good. */
    goods: z.array(GoodIdSchema).max(6).default([]),
  })
  .strict()
  .meta({ id: "TradeTerms" });
export type TradeTerms = z.infer<typeof TradeTermsSchema>;

export const PolityAgreementSchema = z
  .object({
    id: EntityIdSchema,
    kind: PolityAgreementKindSchema,
    /**
     * The two parties. Unordered for every kind but two: a tributary agreement
     * runs from the tributary to the power it pays, and a protectorate from
     * the protected power to its protector, so the order is the terms.
     */
    polityId: EntityIdSchema,
    otherPolityId: EntityIdSchema,
    /** What was agreed, or what the war is over, in plain language. */
    terms: z.string().trim().min(1).max(600),
    /** For a trade pact or an embargo: what the markets read of it (`tradeTermsBetween`). */
    trade: TradeTermsSchema.optional(),
    sinceStep: ElapsedStepSchema,
    /**
     * How many years it had already stood when the world began: a foedus of 299 BC is thirty years old in 270, though its
     * `sinceStep` is the first day. Read where an agreement's age counts, as an ally's habit of following (`unionScore`).
     */
    heldYearsAtStart: z.number().int().nonnegative().max(1_000).optional(),
    /** A dated truce ends by itself; everything else runs until somebody ends it. */
    untilStep: ElapsedStepSchema.nullable().default(null),
    /** The letter that produced it, where one did. */
    sourceMessageId: EntityIdSchema.nullable().default(null),
    status: z.enum(["active", "ended"]).default("active"),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    endedReason: z.string().trim().min(1).max(300).nullable().default(null),
    visibility: VisibilitySchema.default("public"),
    /**
     * A war's battles, on land and at sea, and who won them (`recordBattle`):
     * what the war score reads besides ground, men and blood. Kept on the war
     * itself because a battle's own record is gone a month after it ends.
     */
    /** For an alliance that is a league: the power it was made against (`sim/pushback.ts`). */
    against: EntityIdSchema.nullable().optional(),
    battles: z.array(z.object({
      atStep: ElapsedStepSchema,
      winnerPolityId: EntityIdSchema,
      loserPolityId: EntityIdSchema,
      naval: z.boolean(),
      /** Men (or hulls) who fought on both sides, for how much it counts. */
      engaged: z.number().int().nonnegative(),
    }).strict()).max(80).optional(),
  })
  .strict()
  .refine((agreement) => agreement.polityId !== agreement.otherPolityId, {
    message: "A power holds no agreement with itself.",
    path: ["otherPolityId"],
  });
export type PolityAgreement = z.infer<typeof PolityAgreementSchema>;

const between = (agreement: PolityAgreement, a: string, b: string): boolean =>
  (agreement.polityId === a && agreement.otherPolityId === b) || (agreement.polityId === b && agreement.otherPolityId === a);

/** Every standing agreement between two powers, newest first. */
export function agreementsBetween(agreements: readonly PolityAgreement[], a: string, b: string): PolityAgreement[] {
  return agreements
    .filter((agreement) => agreement.status === "active" && between(agreement, a, b))
    .sort((first, second) => second.sinceStep - first.sinceStep);
}

/** The power this one follows by foedus, if it follows one. */
export function leaderOf(agreements: readonly PolityAgreement[], polityId: string): string | null {
  return agreements.find((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.polityId === polityId)?.otherPolityId ?? null;
}

/** The powers that follow this one by foedus. */
export function alliesLedBy(agreements: readonly PolityAgreement[], leaderPolityId: string): string[] {
  return agreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.otherPolityId === leaderPolityId)
    .map((agreement) => agreement.polityId);
}

/** A power and the leader whose wars and peaces are its own. */
function blocOf(agreements: readonly PolityAgreement[], polityId: string): string[] {
  const leader = leaderOf(agreements, polityId);
  return leader === null ? [polityId] : [polityId, leader];
}

/** One power, or a leader and its allies, or two allies of the same leader. */
export function sameConfederation(agreements: readonly PolityAgreement[], a: string, b: string): boolean {
  if (a === b) return true;
  const leaderOfA = leaderOf(agreements, a);
  const leaderOfB = leaderOf(agreements, b);
  return leaderOfA === b || leaderOfB === a || (leaderOfA !== null && leaderOfA === leaderOfB);
}

/**
 * Every standing agreement between the two sides, where a side is a power
 * together with the leader it follows by foedus: Carthage at peace with Rome
 * is at peace with the Samnites. The foedus binding one side to the other is
 * among them.
 */
export function agreementsBetweenSides(agreements: readonly PolityAgreement[], a: string, b: string): PolityAgreement[] {
  const found = new Map<string, PolityAgreement>();
  for (const x of blocOf(agreements, a)) {
    for (const y of blocOf(agreements, b)) {
      if (x === y) continue;
      for (const agreement of agreementsBetween(agreements, x, y)) found.set(agreement.id, agreement);
    }
  }
  return [...found.values()].sort((first, second) => second.sinceStep - first.sinceStep);
}

/**
 * Are these two at war?
 *
 * The question the rest of the engine actually asks: whether an engagement is
 * a battle or an atrocity, whether a trade route is cut, whether a neighbour
 * has reason to care. An ally bound by foedus is at war with whoever its
 * leader is at war with.
 */
export function atWar(agreements: readonly PolityAgreement[], a: string, b: string): boolean {
  return agreementsBetweenSides(agreements, a, b).some((agreement) => agreement.kind === "war");
}

/** Every power this one is at war with, its leader's enemies and their allies included. */
export function enemiesOf(agreements: readonly PolityAgreement[], polityId: string): string[] {
  const bloc = blocOf(agreements, polityId);
  const direct = agreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "war")
    .flatMap((agreement) => bloc.includes(agreement.polityId) ? [agreement.otherPolityId] : bloc.includes(agreement.otherPolityId) ? [agreement.polityId] : []);
  return [...new Set(direct.flatMap((enemy) => [enemy, ...alliesLedBy(agreements, enemy)]))].filter((enemy) => !bloc.includes(enemy));
}

/**
 * Closes a dated truce whose day has come.
 *
 * Deterministic, so the tick can run it: a truce that expires only when
 * somebody remembers to end it is a peace, which is not what was agreed.
 */
export function expireDatedAgreements(agreements: readonly PolityAgreement[], atStep: number): PolityAgreement[] {
  return agreements.map((agreement) =>
    agreement.status === "active" && agreement.untilStep !== null && agreement.untilStep <= atStep
      ? { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: "Its term ran out." }
      : agreement,
  );
}

/**
 * Whether `moverPolityId`'s armies may stand on `hostPolityId`'s ground without
 * wronging it: at war (it is enemy ground, and trespass is the least of it),
 * allied, protecting or protected, or granted passage. Anything else is a
 * border crossed without leave.
 */
export function mayEnterWithoutLeave(
  agreements: readonly PolityAgreement[],
  moverPolityId: string,
  hostPolityId: string,
): boolean {
  if (sameConfederation(agreements, moverPolityId, hostPolityId) || atWar(agreements, moverPolityId, hostPolityId)) return true;
  return agreementsBetween(agreements, moverPolityId, hostPolityId).some((agreement) =>
    agreement.kind === "war"
    || agreement.kind === "alliance"
    || agreement.kind === "protectorate"
    || (agreement.kind === "military_access" && agreement.polityId === moverPolityId));
}

/**
 * What a war ends between its two powers: nobody is at peace and at war at once.
 *
 * A trade pact is not here, and an embargo is not either, on purpose: war
 * *suspends* trade between the powers whatever pact stands (`tradeTermsBetween`
 * reads a war as a closed border), and the pact is there again the day the war
 * ends, as the merchants' old arrangements were after a real one. Ending it
 * would make every peace need its trade clause written afresh.
 */
export const ENDED_BY_WAR: readonly PolityAgreementKind[] = ["peace", "truce", "alliance", "non_aggression", "foedus", "tributary"];

/**
 * A war opened by the engine itself, where no delta is being applied -- an
 * ultimatum's term running out in silence. `agreement_open` is the way in for
 * everything written; this is the same result for what the calendar does.
 */
export function openWar(agreements: readonly PolityAgreement[], war: {
  readonly id: string;
  readonly polityId: string;
  readonly otherPolityId: string;
  readonly terms: string;
  readonly atStep: number;
  readonly sourceMessageId: string | null;
  readonly reason: string;
}): PolityAgreement[] {
  const between = (agreement: PolityAgreement): boolean =>
    (agreement.polityId === war.polityId && agreement.otherPolityId === war.otherPolityId)
    || (agreement.polityId === war.otherPolityId && agreement.otherPolityId === war.polityId);
  return [
    ...agreements.map((agreement) => (agreement.status === "active" && between(agreement) && ENDED_BY_WAR.includes(agreement.kind)
      ? { ...agreement, status: "ended" as const, endedAtStep: war.atStep, endedReason: war.reason.slice(0, 240) }
      : agreement)),
    {
      id: war.id,
      kind: "war",
      polityId: war.polityId,
      otherPolityId: war.otherPolityId,
      terms: war.terms,
      sinceStep: war.atStep,
      untilStep: null,
      sourceMessageId: war.sourceMessageId,
      status: "active",
      endedAtStep: null,
      endedReason: null,
      visibility: "public",
    },
  ];
}

/**
 * An embargo laid by the engine itself, where no delta is being applied: a notice of embargo whose term ran out unanswered
 * (`tick.ts`), as `openWar` is for an ultimatum's. `agreement_open` is the way in for everything written, and does what this
 * does -- a trade pact standing between the two ends with it -- and this says whether there was one, because laying an embargo
 * over a pact is a breach that costs the embargoer trust (`EMBARGO_BREACH_TRUST`). Where the embargoer already has one on
 * the same power the list is returned as it was.
 */
export function layEmbargo(agreements: readonly PolityAgreement[], embargo: {
  readonly id: string;
  /** The power that lays it. */
  readonly polityId: string;
  readonly otherPolityId: string;
  readonly terms: string;
  readonly goods: readonly GoodId[];
  readonly atStep: number;
  readonly sourceMessageId: string | null;
  readonly reason: string;
}): { readonly agreements: PolityAgreement[]; readonly breachedPact: boolean } {
  if (agreements.some((agreement) => agreement.status === "active" && agreement.kind === "embargo" && agreement.polityId === embargo.polityId && agreement.otherPolityId === embargo.otherPolityId)) {
    return { agreements: [...agreements], breachedPact: false };
  }
  const pact = (agreement: PolityAgreement): boolean => agreement.status === "active" && agreement.kind === "trade_pact" && between(agreement, embargo.polityId, embargo.otherPolityId);
  return {
    breachedPact: agreements.some(pact),
    agreements: [
      ...agreements.map((agreement) => (pact(agreement) ? { ...agreement, status: "ended" as const, endedAtStep: embargo.atStep, endedReason: embargo.reason.slice(0, 240) } : agreement)),
      {
        id: embargo.id,
        kind: "embargo",
        polityId: embargo.polityId,
        otherPolityId: embargo.otherPolityId,
        terms: embargo.terms.slice(0, 600),
        trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [...embargo.goods] },
        sinceStep: embargo.atStep,
        untilStep: null,
        sourceMessageId: embargo.sourceMessageId,
        status: "active",
        endedAtStep: null,
        endedReason: null,
        visibility: "public",
      },
    ],
  };
}

/**
 * The powers a war is actually with: the other side of every war this power,
 * or the leader it follows by foedus, is in. `enemiesOf` counts every ally that
 * follows them too, and a Campanian at war with Rome is not at war with nine
 * Italian peoples one by one; he is at war with Rome, and Rome's allies.
 */
export function warsOf(agreements: readonly PolityAgreement[], polityId: string): string[] {
  const sides = [polityId, ...(leaderOf(agreements, polityId) === null ? [] : [leaderOf(agreements, polityId)!])];
  return [...new Set(agreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "war")
    .flatMap((agreement) => sides.includes(agreement.polityId) ? [agreement.otherPolityId] : sides.includes(agreement.otherPolityId) ? [agreement.polityId] : []))]
    .filter((enemy) => !sides.includes(enemy));
}


/** How long ground lost in war is still a wound to be answered, in days. */
export const LOST_GROUND_DAYS = 180;

/**
 * Ground a power lost in war within the last half year, still held by the
 * enemy it lost it to: what it has reason to take back.
 */
export function groundToRetake(world: Pick<WorldState, "elapsedStep" | "map" | "polityAgreements">, polityId: string): { readonly provinceId: string; readonly name: string; readonly holderId: string; readonly daysAgo: number }[] {
  return world.map.provinces.flatMap((province) => {
    const lost = province.lostBy;
    if (lost == null || lost.polityId !== polityId || province.controllerPolityId === null || province.controllerPolityId === polityId) return [];
    const daysAgo = world.elapsedStep - lost.atStep;
    if (daysAgo > LOST_GROUND_DAYS || !atWar(world.polityAgreements, polityId, province.controllerPolityId)) return [];
    return [{ provinceId: province.id, name: province.name, holderId: province.controllerPolityId, daysAgo }];
  });
}

// ── Trade between two powers ───────────────────────────────────────────────

/** What stands between two powers' markets today: whether goods may cross at all, which, and on what customs. */
export interface TradeBetween {
  /** "war": nothing crosses, whatever pact stands; "embargo": nothing crosses; null: some goods may. */
  readonly closed: "war" | "embargo" | null;
  /** The goods an embargo forbids where it names some (empty: none named). */
  readonly forbidden: readonly GoodId[];
  /** The power that laid the embargo, if one stands. */
  readonly embargoedBy: string | null;
  /** The pact that is in force, if one is; null while a war holds it suspended. */
  readonly pact: { readonly id: string; readonly tariffCapBps: number | null; readonly mostFavoured: boolean; readonly exempt: readonly GoodId[] } | null;
  /** A pact stands but war has suspended it: it resumes with the peace. */
  readonly pactSuspended: boolean;
  /** Both a pact and an embargo stand: the embargoer has breached the pact. */
  readonly pactBreached: boolean;
}

/**
 * The terms two powers trade on, from the agreements that stand between their
 * sides (a power and the leader it follows by foedus are one side).
 *
 * War closes the border; an embargo (all goods, or the listed ones) closes it
 * for what it names; a trade pact, where none of those stands, gives its
 * customs terms. A pact held by a war is `pactSuspended`, nothing more: the
 * record is untouched, so the day the war ends the same terms come back.
 */
export function tradeTermsBetween(world: Pick<WorldState, "polityAgreements">, a: string, b: string): TradeBetween {
  const standing = agreementsBetweenSides(world.polityAgreements, a, b);
  const pact = standing.find((agreement) => agreement.kind === "trade_pact");
  const embargoes = standing.filter((agreement) => agreement.kind === "embargo");
  const war = standing.some((agreement) => agreement.kind === "war");
  const wholeEmbargo = embargoes.some((agreement) => (agreement.trade?.goods ?? []).length === 0);
  const forbidden = wholeEmbargo ? [] : [...new Set(embargoes.flatMap((agreement) => agreement.trade?.goods ?? []))];
  let live: TradeBetween["pact"] = null;
  if (pact !== undefined && !war) {
    let cap = pact.trade?.tariffCapBps ?? null;
    if (pact.trade?.mostFavoured === true) {
      // The best terms either gives anybody: the lowest cap in any pact of either.
      for (const other of world.polityAgreements) {
        if (other.status !== "active" || other.kind !== "trade_pact" || other.trade?.tariffCapBps == null) continue;
        if (![a, b].some((id) => other.polityId === id || other.otherPolityId === id)) continue;
        cap = cap === null ? other.trade.tariffCapBps : Math.min(cap, other.trade.tariffCapBps);
      }
    }
    live = { id: pact.id, tariffCapBps: cap, mostFavoured: pact.trade?.mostFavoured ?? false, exempt: pact.trade?.exempt ?? [] };
  }
  return {
    closed: war ? "war" : wholeEmbargo ? "embargo" : null,
    forbidden,
    embargoedBy: embargoes[0]?.polityId ?? null,
    pact: live,
    pactSuspended: pact !== undefined && war,
    pactBreached: pact !== undefined && embargoes.length > 0,
  };
}

/** Whether a good may cross between two powers on these terms. */
export const mayTradeGood = (terms: TradeBetween, good: GoodId): boolean => terms.closed === null && !terms.forbidden.includes(good);

/**
 * The customs an importing power lays on a good that comes from another, in
 * basis points of its value: its own rate, brought down by the pact (a cap,
 * and nothing at all on the goods the pact lets in free).
 */
export function customsOn(terms: TradeBetween, ownRateBps: number, good: GoodId): number {
  if (terms.pact === null) return ownRateBps;
  if (terms.pact.exempt.includes(good)) return 0;
  return terms.pact.tariffCapBps === null ? ownRateBps : Math.min(ownRateBps, terms.pact.tariffCapBps);
}

/**
 * Whose ground an army takes from an enemy: its own power's, or -- an ally by foedus, with no war or peace of its own,
 * fighting its leader's war -- its leader's. The Picene and Samnite levies Rome called against the Messapians took Brundisium
 * and three Messapian districts for the Picentes and the Samnites (consul-run-issues M5).
 */
export function takerFor(agreements: readonly PolityAgreement[], polityId: string, enemyId: string): string {
  const leader = leaderOf(agreements, polityId);
  return leader !== null && leader !== enemyId && atWar(agreements, leader, enemyId) ? leader : polityId;
}
