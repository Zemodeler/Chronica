import { EffectBandSchema, type OrderPartyRef, type StandingEffect, type WorldDelta, type WorldState } from "@chronica/shared";
import { sameWork } from "./apply-deltas";
import { whereTheActorIs } from "./fill-gaps";
import { accountOf } from "./normalize-refs";

/**
 * What a refused act of the order's becomes, when the engine could not read it.
 *
 * "I start selling cutlery in the streets of Rome" can be written as a
 * venture, an estate, an income, a project -- and if the engine cannot make
 * sense of the one the model chose, even after the repair, the act was
 * dropped and the order did less than it said. The substance of it is not in
 * doubt: somebody set something going, out of their own money, where they
 * are. So that is what is kept, as an arrangement (`generic_entity_create`),
 * which can be anything and does only what the engine's short list of effects
 * allows, at the engine's price.
 *
 * Only acts that *set something going*. A battle, a payment, a march, a
 * letter or a death kept as an arrangement would be a thing in the world that
 * did not happen; those stay refused.
 */
const KEPT_AS: Readonly<Record<string, { readonly kind: string; readonly yields: boolean }>> = {
  trade_venture_open: { kind: "trade", yields: true },
  holding_create: { kind: "holding", yields: true },
  income_source_upsert: { kind: "business", yields: true },
  project_create: { kind: "undertaking", yields: false },
  generic_entity_create: { kind: "arrangement", yields: false },
};

const NAME_FIELDS = ["title", "label", "name"] as const;
const PLACE_FIELDS = ["provinceId", "fromProvinceId", "locationId"] as const;

/** An act that would set a man trading, or pay him as trade does. */
function tradesOrYields(delta: WorldDelta): { readonly title: string; readonly places: readonly string[] } | null {
  switch (delta.op) {
    // Where it sells: the far end is what tells two ventures from one market apart.
    case "trade_venture_open": return { title: delta.title, places: [delta.toProvinceId] };
    case "income_source_upsert": return { title: delta.label, places: [] };
    case "generic_entity_create": {
      const pays = (delta.effects ?? []).some((effect) => effect.quantity === "income" && effect.direction === "raise");
      return pays || /trade|venture|cargo|shop|stall|business|merchant/i.test(delta.kind) ? { title: delta.label, places: delta.provinceId == null ? [] : [delta.provinceId] } : null;
    }
    default: return null;
  }
}

/**
 * Whether this act is a second writing of a venture the same man opened
 * today: the model wrote the cargo as a venture and the income it brings as
 * an income besides, the income was refused, and the repair or the keep made
 * it an arrangement with a price of its own -- so the merchant paid twice for
 * one ship (play-test E19). The same place at either end, or the same words
 * in its name, is the same business; an income that names no place is his
 * venture's.
 */
export function duplicatesAVenture(delta: WorldDelta, world: WorldState, actorRef: OrderPartyRef): boolean {
  if (actorRef.kind !== "character") return false;
  const act = tradesOrYields(delta);
  if (act === null) return false;
  return world.material.ventures.some((venture) => venture.ownerCharacterId === actorRef.id && venture.status === "running" && venture.openedAtStep === world.elapsedStep
    && ((act.places.length === 0 && delta.op !== "trade_venture_open")
      || act.places.some((place) => place === venture.toProvinceId || (delta.op !== "trade_venture_open" && place === venture.fromProvinceId))
      || sameWork("trade", act.title, "trade", venture.title)));
}

export function keepAsArrangement(delta: WorldDelta, world: WorldState, actorRef: OrderPartyRef, why: string): WorldDelta | null {
  const kept = KEPT_AS[delta.op];
  if (kept === undefined || (actorRef.kind !== "character" && actorRef.kind !== "polity")) return null;
  if (duplicatesAVenture(delta, world, actorRef)) return null;
  const written = delta as unknown as Record<string, unknown>;
  const name = NAME_FIELDS.map((field) => written[field]).find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? (typeof written.reason === "string" ? written.reason : null);
  if (name === null) return null;
  const place = PLACE_FIELDS.map((field) => written[field])
    .find((value): value is string => typeof value === "string" && world.map.provinces.some((province) => province.id === value))
    ?? whereTheActorIs(world, actorRef);
  const localId = "localId" in delta && typeof delta.localId === "string" ? delta.localId : `kept_${delta.op}`.slice(0, 60);
  const reason = `${typeof written.reason === "string" ? written.reason : name} (kept: ${why})`.slice(0, 300);
  // A private income says what yields it, and there is an act for each of
  // those: trade is a venture, in the one market he is in, and land is a
  // holding. Kept as what it is, at that act's price -- as an arrangement it
  // cost months of a far larger yield and could not be afforded.
  const purse = actorRef.kind === "character" ? accountOf(world, actorRef.id) : null;
  if (delta.op === "income_source_upsert" && purse !== null && place !== null) {
    if (delta.kind === "trade") {
      return { op: "trade_venture_open", localId, title: name.slice(0, 120), ownerCharacterRef: actorRef.id, fromProvinceId: place, toProvinceId: place, band: "slight", paidFromAccountRef: purse, reason };
    }
    if (delta.kind === "land") {
      return { op: "holding_create", localId, title: name.slice(0, 120), provinceId: place, holderCharacterRef: actorRef.id, band: "slight", priceFromAccountRef: purse, reason };
    }
  }
  const band = EffectBandSchema.safeParse(written.band);
  // An arrangement the model wrote keeps what it said it does; anything else
  // that pays does so at the size it was given, or the smallest.
  const effects: StandingEffect[] = delta.op === "generic_entity_create"
    ? [...(delta.effects ?? [])]
    : kept.yields ? [{ quantity: "income", direction: "raise", band: band.success ? band.data : "slight", scope: "here" }] : [];
  return {
    op: "generic_entity_create",
    localId,
    kind: delta.op === "generic_entity_create" ? delta.kind : kept.kind,
    label: name.slice(0, 160),
    ownerRef: { kind: actorRef.kind, id: actorRef.id },
    attributes: {},
    provinceId: place,
    effects,
    upkeep: null,
    reason,
  };
}
