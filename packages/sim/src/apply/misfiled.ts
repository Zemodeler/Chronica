import type { OrderPartyRef, WorldDelta, WorldState } from "@chronica/shared";
import { normalizeRefs } from "./normalize-refs";

/**
 * Acts written into the order that are the world's own business.
 *
 * The orchestrator answers for the order and for the world in one breath, and
 * is told to keep them apart: the world's own business -- a chieftain for a
 * people with none, an army for a country with none -- goes in "worldDeltas",
 * never "deltas". It does not always. In a live run a merchant's "I start
 * selling cutlery in the streets of Rome" came back with the Ligurians' and
 * the Boii's new armies in the order's own list; the engine judged them as the
 * merchant raising armies, found nobody who would follow him, published that
 * as a public embarrassment, and the historian headlined it. No cutlery.
 *
 * So the engine decides, not the list. Making a force or a person for another
 * power, with the actor nowhere in it -- not commanding it, not answering for
 * it, not paying it, not through anything else the order made for him -- is
 * that power's business, and is judged as the world's. A Roman who raises
 * Gauls under his own command is still in it, and still answers for it.
 *
 * The same for dealings between two other powers. A Roman consul's order to
 * write to Messana and Syracuse came back with the Midland Britons' war on the
 * Thames Basin and the Mamertines' appeal to Carthage in the order's list; the
 * engine read them as the consul committing Britons and Mamertines, refused
 * both, and the historian headlined "Clepsina speaks for the Midland Britons".
 * A treaty, a letter or an answer in which the actor's own power is neither
 * party, and he appears nowhere, is between those two powers.
 */
const MADE_FOR_A_POWER = new Set(["force_create", "character_create"]);
const BETWEEN_POWERS = new Set(["agreement_open", "agreement_close", "diplomatic_message_send", "diplomatic_message_answer"]);

/** The powers a dealing is between, as the engine will read them; null when it cannot tell. */
function partiesOf(delta: WorldDelta, world: WorldState): readonly string[] | null {
  const read = normalizeRefs(delta, world);
  switch (read.op) {
    case "agreement_open":
      return [read.polityId, read.otherPolityId];
    case "diplomatic_message_send":
      return [read.fromPolityId, read.toPolityId];
    case "agreement_close": {
      const agreement = world.polityAgreements.find((candidate) => candidate.id === read.agreementRef);
      return agreement === undefined ? null : [agreement.polityId, agreement.otherPolityId];
    }
    case "diplomatic_message_answer": {
      const message = world.diplomacy.find((candidate) => candidate.id === read.messageRef);
      return message === undefined ? null : [message.fromPolityId, message.toPolityId];
    }
    default:
      return null;
  }
}

export function misfiledWorldActs(orderDeltas: readonly WorldDelta[], world: WorldState, actorRef: OrderPartyRef): Set<WorldDelta> {
  if (actorRef.kind !== "character") return new Set();
  const actor = world.characters.find((character) => character.id === actorRef.id);
  if (actor === undefined) return new Set();
  const ownIds = new Set([actor.id, ...world.material.accounts.filter((account) => account.owner.kind === "character" && account.owner.id === actor.id).map((account) => account.id)]);

  // Everything the order made that the actor is in -- his wage bill, his
  // lieutenant -- so an act naming one of those is his too.
  const mentions = (delta: WorldDelta, ids: ReadonlySet<string>): boolean => {
    let found = false;
    const walk = (node: unknown): void => {
      if (found) return;
      if (typeof node === "string") found = ids.has(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object" && node !== null) Object.values(node).forEach(walk);
    };
    walk(delta);
    return found;
  };
  const his = new Set(ownIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const delta of orderDeltas) {
      const handle = "localId" in delta && typeof delta.localId === "string" ? `local:${delta.localId}` : null;
      if (handle !== null && !his.has(handle) && mentions(delta, his)) {
        his.add(handle);
        grew = true;
      }
    }
  }

  const misfiled = new Set<WorldDelta>();
  for (const delta of orderDeltas) {
    if (mentions(delta, his)) continue;
    if (BETWEEN_POWERS.has(delta.op)) {
      const parties = partiesOf(delta, world);
      if (parties !== null
        && parties.every((id) => id !== actor.polityId && world.map.polities.some((polity) => polity.id === id))) {
        misfiled.add(delta);
      }
      continue;
    }
    if (!MADE_FOR_A_POWER.has(delta.op)) continue;
    // The power as the engine will read it, near-misses put right.
    const polityId = (normalizeRefs(delta, world) as { polityId?: unknown }).polityId;
    if (typeof polityId !== "string" || polityId === actor.polityId) continue;
    if (!world.map.polities.some((polity) => polity.id === polityId)) continue;
    misfiled.add(delta);
  }
  return misfiled;
}
