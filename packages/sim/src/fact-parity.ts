import type { OrderPartyRef, WorldState } from "@chronica/shared";

/**
 * Whether a fact the model wrote claims something the world does not show
 * (plan chronicle-and-order-truth, 1.6; audit R77). A fact saying a city was
 * taken, a legion arrived or a man was appointed is checked against the state
 * the answer's acts left; one the world contradicts is dropped before it can
 * reach the Chronicle, and the reason goes to the burst's skipped list.
 *
 * Conservative on purpose: only the claims a table below can read, only when
 * the fact names the things to check them against. Anything else passes.
 */
const ARRIVED = /\b(arrived|landed|crossed over|made the crossing|reached)\b/i;
const TAKEN = /\b(captured|seized|fell to|was taken|were taken|surrendered)\b/i;
const APPOINTED = /\b(was appointed|were appointed|was installed|was elected|was named (?:as )?(?:the )?(?:new )?[a-z]+)\b/i;

export interface ClaimingFact {
  readonly kind: string;
  readonly summary: string;
  readonly affectedRefs: readonly OrderPartyRef[];
}

export function factContradictsState(world: WorldState, fact: ClaimingFact, groundOfForce: (forceId: string) => ReadonlySet<string>): string | null {
  const text = `${fact.kind.replace(/_/g, " ")} ${fact.summary}`;
  const refs = (kind: OrderPartyRef["kind"]): OrderPartyRef[] => fact.affectedRefs.filter((ref) => ref.kind === kind);
  const provinceOf = (ref: OrderPartyRef): string | null => ref.kind === "province" ? ref.id
    : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === ref.id))?.id ?? null;
  const places = [...refs("province"), ...refs("settlement")].map(provinceOf).filter((id): id is string => id !== null);

  const forces = refs("force");
  if (ARRIVED.test(text) && forces.length === 1 && places.length > 0 && world.material.forces.some((force) => force.id === forces[0]!.id)) {
    const ground = groundOfForce(forces[0]!.id);
    if (!places.some((place) => ground.has(place))) return `says ${forces[0]!.id} arrived, but it is not at ${places[0]!}`;
  }

  const polities = refs("polity");
  if (TAKEN.test(text) && polities.length === 1 && places.length === 1) {
    const province = world.map.provinces.find((candidate) => candidate.id === places[0]);
    const settlement = province?.settlements.find((candidate) => fact.affectedRefs.some((ref) => ref.id === candidate.id));
    const holder = settlement === undefined ? province?.controllerPolityId : settlement.controllerPolityId;
    if (province !== undefined && holder !== polities[0]!.id) return `says ${places[0]!} was taken by ${polities[0]!.id}, but it is held by ${holder ?? "nobody"}`;
  }

  const people = refs("character");
  const offices = refs("office");
  if (APPOINTED.test(text) && people.length === 1 && offices.length === 1) {
    const held = world.material.officeSeats.some((seat) => seat.officeId === offices[0]!.id && seat.status === "held" && seat.holderCharacterId === people[0]!.id);
    if (!held) return `says ${people[0]!.id} was appointed to ${offices[0]!.id}, but the seat is not his`;
  }
  return null;
}
