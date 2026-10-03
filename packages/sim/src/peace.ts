import {
  WorldDeltaSchema,
  aptitude,
  leaning,
  ownerOf,
  readDepartments,
  skillShare,
  warStanding,
  type Character,
  type FactProposalDraft,
  type Office,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { diplomaticAnswererOf } from "./letters";
import type { ApplyContext } from "./apply/context";

/**
 * Making peace (the treaty system).
 *
 * Peace was a delta anybody could write: "agreement_open", kind "peace", and a
 * war was over. It is made between two powers now, and made the way it was:
 *
 * - **Negotiated**: one side asks for terms, and the other's representative
 *   bargains. What a power will give up is bounded by how its war is going
 *   and how long it has lasted (`willingToGive`), and each thing asked of it
 *   has a price (`priceOf`) -- a province, more for one that holds its
 *   capital; an indemnity, by what it can pay; a hostage; itself. The envoy's
 *   gift for bargaining makes him give less, the other side's makes him give
 *   more, and terms beyond what his side will bear are not agreed however the
 *   talk went: his council will not ratify them.
 * - **Dictated**: a side the war score says has won (`DICTATE_AT`) sets the
 *   terms, and the other accepts them or fights on. Only a dictated peace
 *   can take a power's surrender.
 *
 * Either way the peace is carried out as a treaty -- `agreement_open` with its
 * clauses -- so the map after the war is the map the treaty says.
 */

export type PeaceClause = NonNullable<Extract<WorldDelta, { op: "agreement_open" }>["clauses"]>[number];

export interface PeaceTerms {
  /** The power asking for or offering the peace. */
  readonly proposerPolityId: string;
  /** The power it is made with; its representative is the one who agrees. */
  readonly otherPolityId: string;
  readonly clauses: readonly PeaceClause[];
  /** Plain words for the treaty. */
  readonly terms: string;
  /** Who agreed for the other side. */
  readonly representativeId: string;
  /** Who spoke for the proposer. */
  readonly speakerId: string;
}

/**
 * What a province is worth to the power giving it up, by the war score's own
 * measure (`war-score.ts`): its share of that power's land out of twenty-five,
 * each of its cities' share of that power's cities out of forty -- a city of a
 * three-city power is dear, a city of an empire cheap -- and thirty-five more
 * for the capital. Half as much when the taker already holds it: ground
 * occupied is ground half given.
 */
export function provinceWorth(world: WorldState, provinceId: string, giver: string): number {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined || ownerOf(province) !== giver) return 0;
  const owned = world.map.provinces.filter((candidate) => ownerOf(candidate) === giver);
  const cities = Math.max(1, owned.reduce((sum, candidate) => sum + candidate.settlements.length, 0));
  const capital = world.map.polities.find((polity) => polity.id === giver)?.capitalSettlementId;
  const base = Math.max(2, Math.round(25 / Math.max(1, owned.length) + (40 * province.settlements.length) / cities))
    + (province.settlements.some((city) => city.id === capital) ? 35 : 0);
  return province.controllerPolityId !== giver ? Math.round(base / 2) : base;
}

/** What a clause costs the side giving it up, in the currency of a war going badly. */
export function priceOf(world: WorldState, clause: PeaceClause, giver: string): number {
  if (clause.kind === "cession") return provinceWorth(world, clause.provinceId, giver);
  if (clause.kind === "indemnity") {
    if (clause.payerPolityId !== giver) return 0;
    const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === giver);
    return Math.round((25 * clause.amount * clause.periods) / Math.max(500, treasury?.balance ?? 0));
  }
  if (clause.kind === "hostage") return world.characters.find((character) => character.id === clause.characterRef)?.polityId === giver ? 8 : 0;
  if (clause.kind === "undertaking") return clause.byPolityId === giver ? 10 : 0;
  if (clause.kind === "force_transfer") return world.material.forces.find((force) => force.id === clause.forceRef)?.polityId === giver ? 25 : 0;
  return clause.polityId === giver ? 100 : 0;
}

/**
 * How much a power will give up for peace: what its war costs it, and how
 * tired of it it is -- a point for every fortnight of it, up to thirty -- as
 * weighed by the man bargaining for it against the man bargaining with him.
 */
export function willingToGive(world: WorldState, giver: string, taker: string, envoy: Pick<Character, "skills" | "traits"> | undefined, asker: Pick<Character, "skills" | "traits"> | undefined): number {
  const standing = warStanding(world, taker, giver);
  if (standing.dictates) return Infinity;
  const losing = Math.max(0, standing.score);
  const tired = Math.min(30, Math.floor(standing.days / 15));
  // The men at the table, and behind each of them whoever is in charge of
  // his power's peace-making, who briefed him: a seventh either way.
  // His gift for bargaining and his diplomacy at large, half each; and his
  // nature: a man disposed to negotiate gives ground more gracefully and
  // takes it more surely.
  const inCharge = readDepartments(world);
  const atTable = (man: Pick<Character, "skills" | "traits">): number =>
    skillShare((aptitude(man, "arbitration") + man.skills.diplomacy) / 2, 0.3) + leaning(man, "negotiation") / 100;
  const hard = (envoy === undefined ? 0 : atTable(envoy)) + inCharge.headLift({ kind: "polity", id: giver }, "peace_talks");
  const persuasive = (asker === undefined ? 0 : atTable(asker)) + inCharge.headLift({ kind: "polity", id: taker }, "peace_talks");
  return Math.max(0, Math.round((losing + tired) * (1 - hard + persuasive)));
}

export interface PeaceOutcome {
  readonly made: boolean;
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  /** Why not, in words the envoy would give, when it was not made. */
  readonly refusal: string | null;
  readonly dictated: boolean;
}

export function concludePeace(world: WorldState, peace: PeaceTerms, context: Omit<ApplyContext, "actorRef">, offices: readonly Office[], bought = 0): PeaceOutcome {
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const refuse = (refusal: string): PeaceOutcome => ({ made: false, world, facts: [], refusal, dictated: false });
  const standing = warStanding(world, peace.proposerPolityId, peace.otherPolityId);
  if (standing.parts[0] === "not at war") return refuse(`${name(peace.proposerPolityId)} and ${name(peace.otherPolityId)} are not at war.`);

  // Who may agree for them: somebody who speaks for their power.
  const representative = world.characters.find((character) => character.id === peace.representativeId && character.alive);
  const speaksFor = representative !== undefined && representative.polityId === peace.otherPolityId
    && (world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === representative.id)
      || diplomaticAnswererOf(world, peace.otherPolityId, offices, peace.speakerId) === representative.id);
  if (!speaksFor) return refuse(`${representative?.name ?? "That man"} does not speak for ${name(peace.otherPolityId)}, and nothing he agrees binds it.`);

  // What each side gives up, against what each will bear. What the proposer
  // gives is his own to give; what the other gives is bargained for.
  const speaker = world.characters.find((character) => character.id === peace.speakerId);
  const theyGive = peace.clauses.reduce((sum, clause) => sum + priceOf(world, clause, peace.otherPolityId), 0);
  const dictated = standing.dictates;
  if (peace.clauses.some((clause) => clause.kind === "submission" && clause.polityId === peace.otherPolityId) && !dictated) {
    return refuse(`${name(peace.otherPolityId)} will not give itself up to a power that has not beaten it.`);
  }
  // Plus what a bribe at the peace table bought (`peace-table.ts`).
  const bearable = willingToGive(world, peace.otherPolityId, peace.proposerPolityId, representative, speaker) + bought;
  if (theyGive > bearable) {
    return refuse(`${representative.name} cannot carry terms like these to ${name(peace.otherPolityId)}: they ask more than its war has cost it${standing.days < 60 ? ", and it is not yet tired of fighting" : ""}.`);
  }

  const delta = WorldDeltaSchema.parse({
    op: "agreement_open", localId: `peace_${peace.proposerPolityId}_${peace.otherPolityId}`.slice(0, 60), kind: "peace",
    polityId: peace.proposerPolityId, otherPolityId: peace.otherPolityId, terms: peace.terms.slice(0, 600),
    clauses: peace.clauses, forDays: null, sourceMessageRef: null, visibility: "public",
    reason: dictated ? `${name(peace.proposerPolityId)} dictated the peace.` : `Agreed with ${representative.name}.`,
  });
  const result = applyDeltas(world, [delta], { ...context, actorRef: { kind: "character", id: peace.speakerId }, actsForTheWorld: true });
  if (result.rejected.length > 0) return refuse(result.rejected[0]!.reason);

  // What each side still holds of the other's when the war ends is the other's
  // no longer, and its people remember whose it was.
  let next = result.world;
  next = {
    ...next,
    map: {
      ...next.map,
      provinces: next.map.provinces.map((province) => {
        const lost = province.lostBy;
        if (lost == null || ![peace.proposerPolityId, peace.otherPolityId].includes(lost.polityId) || ![peace.proposerPolityId, peace.otherPolityId].includes(province.controllerPolityId ?? "")) return province;
        return { ...province, lostBy: null, yearning: { polityId: lost.polityId, bps: 3_000, updatedAtStep: next.elapsedStep } };
      }),
    },
  };

  const said = peace.clauses.map((clause) => {
    if (clause.kind === "cession") return `${world.map.provinces.find((province) => province.id === clause.provinceId)?.name ?? clause.provinceId} to ${name(clause.toPolityId)}`;
    if (clause.kind === "indemnity") return `${name(clause.payerPolityId)} to pay ${clause.amount} ${clause.periods} times`;
    if (clause.kind === "hostage") return `${world.characters.find((character) => character.id === clause.characterRef)?.name ?? "a hostage"} given as a hostage`;
    if (clause.kind === "undertaking") return `${name(clause.byPolityId)} to ${clause.what}`;
    if (clause.kind === "force_transfer") return `${world.material.forces.find((force) => force.id === clause.forceRef)?.name ?? "an army"} to serve ${name(clause.toPolityId)}`;
    return `${name(clause.polityId)} to give itself up to ${name(clause.toPolityId)}`;
  });
  const summary = dictated
    ? `${name(peace.proposerPolityId)} dictated the peace to ${name(peace.otherPolityId)}, and ${representative.name} accepted it${said.length === 0 ? "" : `: ${said.join("; ")}`}.`
    : `${name(peace.proposerPolityId)} and ${name(peace.otherPolityId)} made peace, agreed by ${speaker?.name ?? "their envoys"} and ${representative.name}${said.length === 0 ? "" : `: ${said.join("; ")}`}.`;
  return {
    made: true,
    world: next,
    dictated,
    refusal: null,
    facts: [...result.factProposals, {
      localId: `peace_${peace.otherPolityId}`.slice(0, 60),
      kind: "peace_made",
      summary: summary.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: peace.proposerPolityId }, { kind: "polity", id: peace.otherPolityId }, { kind: "character", id: representative.id }, ...(speaker === undefined ? [] : [{ kind: "character" as const, id: speaker.id }])],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 90,
    }],
  };
}
