import { coinagesOf, readDepartments, type WorldDelta, type WorldState } from "@chronica/shared";
import { keptByTheOfficers, servesThePlayer } from "./kept-by-the-officers";

/**
 * The world's own acts do not carry another state's routine government (docs/economy.md, "What the model is left to").
 *
 * The orchestrator answers the player's order and moves the world beside it: its `worldDeltas` are the world's business (a chieftain given
 * to the Boii, a thread advanced). The prompt tells it that the tribute and the customs, the coin, loans, the pacts of powers nobody plays,
 * estates, ventures and the upkeep of walls are kept by the officers of each state by rule; this is the engine holding it to that, as it holds
 * a man the model plays. An act of the routine government among the world's acts is set aside, and counted, unless it is the player's own: his
 * power's, a power he rules, or a man who serves him by an order he has put to him. The player's own order is not here at all (it is in the
 * order's `deltas`, read in full).
 */

/** Whose books an act of the routine government is in: the powers it touches, and the man it is done by. */
function whoseBooks(world: WorldState, delta: WorldDelta): { readonly polityIds: readonly string[]; readonly characterIds: readonly string[] } {
  const polities = new Set<string>();
  const people = new Set<string>();
  const ofCharacter = (id: string | null | undefined): void => {
    if (id == null) return;
    people.add(id);
    const polityId = world.characters.find((character) => character.id === id)?.polityId;
    if (polityId != null) polities.add(polityId);
  };
  const ofAccount = (accountId: string | null | undefined): void => {
    const owner = world.material.accounts.find((account) => account.id === accountId)?.owner;
    if (owner === undefined) return;
    if (owner.kind === "polity") polities.add(owner.id);
    else if (owner.kind === "character") ofCharacter(owner.id);
  };
  const d = delta as Record<string, unknown>;
  const text = (key: string): string | null => (typeof d[key] === "string" ? (d[key]) : null);
  switch (delta.op) {
    case "tax_policy_set": polities.add(delta.polityId); break;
    case "coinage_debase": { const issuer = coinagesOf(world).find((coinage) => coinage.id === delta.coinageId)?.issuerPolityId; if (issuer != null) polities.add(issuer); break; }
    case "holding_create": ofCharacter(text("holderCharacterRef")); break;
    case "holding_improve": ofCharacter(world.material.holdings.find((holding) => holding.id === text("holdingRef"))?.legalHolderCharacterId); ofAccount(text("paidFromAccountRef")); break;
    case "trade_venture_open": ofCharacter(text("ownerCharacterRef")); break;
    case "trade_venture_close": ofCharacter(world.material.ventures.find((venture) => venture.id === text("ventureRef"))?.ownerCharacterId); break;
    case "loan_settle": ofAccount(world.material.loans.find((loan) => loan.id === text("loanRef"))?.borrowerAccountId); break;
    case "loan_open": ofAccount(text("borrowerAccountRef")); break;
    case "agreement_open": polities.add(delta.polityId); polities.add(delta.otherPolityId); break;
    case "agreement_close": {
      const agreement = world.polityAgreements.find((candidate) => candidate.id === text("agreementRef"));
      if (agreement !== undefined) { polities.add(agreement.polityId); polities.add(agreement.otherPolityId); }
      break;
    }
    case "project_create": {
      const sponsor = d.sponsorRef as { kind?: string; id?: string } | undefined;
      if (sponsor?.kind === "polity" && sponsor.id !== undefined) polities.add(sponsor.id);
      else if (sponsor?.kind === "character") ofCharacter(sponsor.id);
      ofAccount(text("fundingAccountRef"));
      break;
    }
    default: break;
  }
  return { polityIds: [...polities], characterIds: [...people] };
}

export interface WorldActsAsk {
  /** The player's own man, whose power and whose servants are his to move. */
  readonly playerId: string | null;
  readonly playerPolityId: string | null;
}

/** Whether these books are the player's: his power's, a power he rules, or a man who serves him. */
function theirsToThePlayer(world: WorldState, books: ReturnType<typeof whoseBooks>, ask: WorldActsAsk): boolean {
  if (ask.playerId === null) return false;
  if (books.characterIds.some((id) => id === ask.playerId || servesThePlayer(world, id, ask.playerId))) return true;
  const reader = readDepartments(world);
  return books.polityIds.some((polityId) => polityId === ask.playerPolityId
    || reader.rulers(polityId).some((ruler) => ruler.id === ask.playerId || servesThePlayer(world, ruler.id, ask.playerId)));
}

/** The world's acts with the routine government of other states taken out, and why each was. */
export function keepOutOfOtherStatesBooks(world: WorldState, deltas: readonly WorldDelta[], ask: WorldActsAsk): { readonly kept: WorldDelta[]; readonly setAside: { readonly delta: WorldDelta; readonly reason: string }[] } {
  const kept: WorldDelta[] = [];
  const setAside: { delta: WorldDelta; reason: string }[] = [];
  for (const delta of deltas) {
    // Whether it is routine government at all is the officers' own reading, with no man's orders in it.
    const reason = keptByTheOfficers(world, delta, { actorId: "the-world", playerId: null, playerPolityId: ask.playerPolityId });
    if (reason === null || theirsToThePlayer(world, whoseBooks(world, delta), ask)) { kept.push(delta); continue; }
    setAside.push({ delta, reason: `${reason} (not the world's to settle for another state)` });
  }
  return { kept, setAside };
}
