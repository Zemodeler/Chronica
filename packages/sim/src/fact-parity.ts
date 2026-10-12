import type { OrderPartyRef, WorldState } from "@chronica/shared";
import { assertsWords } from "./order-outcomes";

/**
 * Whether a fact the model wrote claims something the world does not show
 * (plan chronicle-and-order-truth, 1.6; audit R77). A fact saying a city was
 * taken, a legion arrived, a man was appointed, an army was raised or a sum
 * was paid is checked against the state the answer's acts left, at the time
 * of the event; one the world contradicts is dropped before it can reach the
 * Chronicle, and the reason goes to the burst's skipped list.
 *
 * Conservative on purpose: only the claims a table below can read, said
 * without a denial ("never arrived" claims nothing), and only when the fact
 * names the things to check them against. Anything else passes.
 */
const ARRIVED = /\b(arrived|landed|made landfall|came ashore|went ashore|disembarked|crossed over|made the crossing|reached)\b/i;
const TAKEN = /\b(captured|seized|fell to|was taken|were taken|surrendered)\b/i;
const APPOINTED = /\b(was appointed|were appointed|was installed|was elected|was named (?:as )?(?:the )?(?:new )?[a-z]+)\b/i;
/** An army said raised, levied or mustered: a mechanically checkable thing, so the army must stand. */
const RAISED = /\b(was raised|were raised|was levied|were levied|was mustered|were mustered|raised (?:a|an|the|two|three|new|fresh) (?:new |fresh )?(?:army|legion|legions|fleet|force|host|band)|levied (?:a|an|the|new|fresh) (?:new |fresh )?(?:army|legion|legions|force|host))\b/i;
/** Money said to have moved: a sum paid, handed over, sent, with its amount. */
const PAID = /\b(?:paid|handed over|disbursed|remitted|sent|advanced|lent)\b[^.;]{0,60}?\b(\d[\d,]{2,})\b|\b(\d[\d,]{2,})\b[^.;]{0,40}?\b(?:was paid|were paid|was handed over|was disbursed|was remitted|changed hands)\b/i;

export interface ClaimingFact {
  readonly kind: string;
  readonly summary: string;
  readonly affectedRefs: readonly OrderPartyRef[];
}

/**
 * Evidence at event time the fact's claim may be held to, beyond the world's
 * state: the day it happened, and the money lines the answer that wrote it
 * actually made (`MadeMoney.transactionIds` of its applied acts), so a
 * payment is held to its own lines -- the sum, the accounts it names -- and
 * never to another payment that happened to move the same day. Without it
 * the money check is not made.
 */
export interface ParityEvidence {
  readonly atStep: number;
  /** The lines this answer's acts wrote; absent, any line of the day may answer (an older caller). */
  readonly transactionIds?: ReadonlySet<string> | undefined;
}

/** "5,000" as 5000; null where the words hold no whole sum. */
function sumOf(said: RegExpExecArray): number | null {
  const digits = (said[1] ?? said[2] ?? "").replace(/,/g, "");
  const value = Number(digits);
  return digits === "" || !Number.isSafeInteger(value) ? null : value;
}

export function factContradictsState(world: WorldState, fact: ClaimingFact, groundOfForce: (forceId: string) => ReadonlySet<string>, evidence?: ParityEvidence): string | null {
  const text = `${fact.kind.replace(/_/g, " ")} ${fact.summary}`;
  const refs = (kind: OrderPartyRef["kind"]): OrderPartyRef[] => fact.affectedRefs.filter((ref) => ref.kind === kind);
  const provinceOf = (ref: OrderPartyRef): string | null => ref.kind === "province" ? ref.id
    : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === ref.id))?.id ?? null;
  const places = [...refs("province"), ...refs("settlement")].map(provinceOf).filter((id): id is string => id !== null);

  const forces = refs("force");
  if (assertsWords(text, ARRIVED) && forces.length === 1 && places.length > 0 && world.material.forces.some((force) => force.id === forces[0]!.id)) {
    const ground = groundOfForce(forces[0]!.id);
    if (!places.some((place) => ground.has(place))) return `says ${forces[0]!.id} arrived, but it is not at ${places[0]!}`;
  }

  const polities = refs("polity");
  if (assertsWords(text, TAKEN) && polities.length === 1 && places.length === 1) {
    const province = world.map.provinces.find((candidate) => candidate.id === places[0]);
    const settlement = province?.settlements.find((candidate) => fact.affectedRefs.some((ref) => ref.id === candidate.id));
    const holder = settlement === undefined ? province?.controllerPolityId : settlement.controllerPolityId;
    if (province !== undefined && holder !== polities[0]!.id) return `says ${places[0]!} was taken by ${polities[0]!.id}, but it is held by ${holder ?? "nobody"}`;
  }

  const people = refs("character");
  const offices = refs("office");
  if (assertsWords(text, APPOINTED) && people.length === 1 && offices.length === 1) {
    const held = world.material.officeSeats.some((seat) => seat.officeId === offices[0]!.id && seat.status === "held" && seat.holderCharacterId === people[0]!.id);
    if (!held) return `says ${people[0]!.id} was appointed to ${offices[0]!.id}, but the seat is not his`;
  }

  // An army said raised must stand: a fact naming one army, which the world does not hold, raised nothing.
  if (assertsWords(text, RAISED) && forces.length === 1 && !world.material.forces.some((force) => force.id === forces[0]!.id)) {
    return `says ${forces[0]!.id} was raised, but no such army stands`;
  }

  // A sum said paid must have moved, exactly, on the day, between the accounts the fact names, by a
  // line the answer itself wrote: an unrelated payment of the same day, a short payment of part of
  // the sum, or one between other purses is not this one.
  const accounts = refs("account");
  const said = PAID.exec(text);
  const amount = said === null || !assertsWords(text, PAID) ? null : sumOf(said);
  if (evidence !== undefined && amount !== null && accounts.length >= 1) {
    const named = new Set(accounts.map((ref) => ref.id));
    const sides = (transaction: WorldState["material"]["transactions"][number]): string[] => [transaction.sourceAccountId, transaction.destinationAccountId].filter((id): id is string => id !== undefined);
    const moved = world.material.transactions.some((transaction) => transaction.atStep === evidence.atStep
      && (evidence.transactionIds === undefined || evidence.transactionIds.has(transaction.id))
      && transaction.amount === amount
      // One account named: it paid or was paid. Two or more: the line runs between two of them.
      && (named.size === 1 ? sides(transaction).some((id) => named.has(id)) : sides(transaction).length === 2 && sides(transaction).every((id) => named.has(id))));
    if (!moved) return `says ${amount} was paid through ${accounts.map((ref) => ref.id).join(" and ")}, but no line of this answer moved that sum there that day`;
  }
  return null;
}
