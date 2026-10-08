import {
  coinageOfPolity,
  coinagesOf,
  economyOf,
  readDepartments,
  standardOf,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";

/**
 * What the model is left to (docs/economy.md, "What the model is left to").
 *
 * The routine government of a state is kept by its officers, by rule: the rate of the tax and of the customs, the silver in the
 * coin, bread for the markets, the merchant houses, loans between states, the trade pacts of powers nobody plays, the works that
 * keep a city standing, and the charges that keep them (`appointed-by-rule.ts`). A person the model plays is asked for what the rules cannot do -- ambition,
 * rivalry, plots, marriages, patronage, factions, oaths, treachery, war counsels, letters, rhetoric, love and grudges -- and his
 * calls are spent there. He is not shown the menu of the routine acts; if he writes one anyway it is set aside, quietly, and counted.
 *
 * The player's own order is another matter: it may be about anything, and so may the order of a man he has put it to.
 */

/** Acts of the routine government, taken out of the menu a person is shown and set aside when he writes one. */
export const ROUTINE_OPS: ReadonlySet<string> = new Set([
  "tax_policy_set",
  "coinage_debase",
  "holding_create",
  "holding_improve",
  "trade_venture_open",
  "trade_venture_close",
  "loan_settle",
]);

/**
 * What a person is told of it, in the same words wherever it is said. Short, and in the words of the age.
 */
export const KEPT_BY_THE_OFFICERS =
  "The routine government of every state -- the tribute and the customs, bread for the markets, the mint, the upkeep of walls and roads, the merchant houses, loans and trade pacts between states -- is kept by the officers, by rule; nothing here is for them to settle, and an act of it written here is set aside (save what an order put to them names). Their own work is ambition and rivalry, plots and schemes, marriages, patronage, factions, oaths and treachery, counsels of war, letters and speeches, love and grudges.";

/** Setting aside, as the log keeps it. */
export const KEPT_STAGE = "officers" as const;

export interface TheOfficersAsk {
  /** The person writing the act. */
  readonly actorId: string;
  /** The player's own man, whose orders may be about anything. */
  readonly playerId: string | null;
  /** The player's own power: a pact or a loan that touches it is his to speak to. */
  readonly playerPolityId: string | null;
}

/** A man the player has put an order to, and who has taken it or not yet answered: his act is the player's. */
export function servesThePlayer(world: WorldState, actorId: string, playerId: string | null): boolean {
  if (playerId === null) return false;
  return world.orderAttempts.some((attempt) => attempt.recipientRef.id === actorId
    && ["issued", "received", "accepted", "delayed"].includes(attempt.status)
    && (attempt.issuerRef.id === playerId || world.orders.some((order) => order.actorCharacterId === playerId
      && order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)))));
}

/** A private man's purse or a house's, as against a power's chest: only the second is the state's money. */
const isPolityAccount = (world: WorldState, accountId: string): boolean =>
  world.material.accounts.some((account) => account.id === accountId && account.owner.kind === "polity");

/**
 * Why this act is not the person's to settle, or null when it stands. Plots, patronage, bribes, ransom, a private loan,
 * `money_transfer`, war and peace and alliance, the dole given to win a city: all stand.
 */
export function keptByTheOfficers(world: WorldState, delta: WorldDelta, ask: TheOfficersAsk): string | null {
  if (servesThePlayer(world, ask.actorId, ask.playerId)) return null;
  const kept = (what: string): string => `${what}: the officers keep it, by rule`;
  if (ROUTINE_OPS.has(delta.op)) return kept(delta.op.replace(/_/g, " "));
  if (delta.op === "loan_open") {
    // A man lends to a man for a purpose of his own; a state's borrowing is the officers'.
    if (delta.lenderKind !== "character" || isPolityAccount(world, delta.borrowerAccountRef)) return kept("a loan to a state");
    return null;
  }
  if (delta.op === "agreement_open" && (delta.kind === "trade_pact" || delta.kind === "embargo")) {
    const mine = [delta.polityId, delta.otherPolityId].some((id) => id === ask.playerPolityId);
    return mine ? null : kept(`a ${delta.kind.replace(/_/g, " ")} between powers`);
  }
  if (delta.op === "agreement_close") {
    const agreement = world.polityAgreements.find((candidate) => candidate.id === delta.agreementRef);
    if (agreement !== undefined && (agreement.kind === "trade_pact" || agreement.kind === "embargo")
      && ![agreement.polityId, agreement.otherPolityId].some((id) => id === ask.playerPolityId)) return kept(`ending a ${agreement.kind.replace(/_/g, " ")}`);
    return null;
  }
  // The works that keep a city standing; an army's march or a levy is not one.
  if (delta.op === "project_create" && delta.completionOutcome?.kind === "structure") return kept("works of upkeep");
  return null;
}

/** An act written by a man the model plays, with the ones the officers keep taken out and their reasons given. */
export function setAsideForTheOfficers(world: WorldState, deltas: readonly WorldDelta[], ask: TheOfficersAsk): { readonly kept: WorldDelta[]; readonly setAside: { readonly delta: WorldDelta; readonly reason: string }[] } {
  const kept: WorldDelta[] = [];
  const setAside: { delta: WorldDelta; reason: string }[] = [];
  for (const delta of deltas) {
    const reason = keptByTheOfficers(world, delta, ask);
    if (reason === null) kept.push(delta); else setAside.push({ delta, reason });
  }
  return { kept, setAside };
}

/** Thresholds at which the state of the chest and the granary is a matter of men's tempers, not of the books. */
export const CRISIS_ARREARS_MONTHS = 1;
export const CRISIS_FAMINE_BPS = 14_000;
export const CRISIS_FAMINE_SHARE = 1 / 3;
export const CRISIS_COIN_SHARE = 0.85;

/**
 * The state of the state, said to a man only when it has become a quarrel: the soldiers' pay gone a month and more behind, bread at
 * a famine price in a third of its markets, the coin struck so light that men say so. For a ruler, and for the captains of his
 * armies; nobody else is told, and nobody is told the figures of a state that is merely poor.
 */
export function stateCrisisLine(world: WorldState, characterId: string): string | null {
  const person = world.characters.find((candidate) => candidate.id === characterId);
  const polityId = person?.polityId ?? null;
  if (person === undefined || polityId === null) return null;
  const rules = readDepartments(world).rulers(polityId).some((ruler) => ruler.id === characterId);
  const commands = world.material.forces.some((force) => force.polityId === polityId && (force.commanderCharacterId === characterId || force.controllerCharacterId === characterId));
  if (!rules && !commands) return null;
  const parts: string[] = [];

  const chests = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active").map((account) => account.id));
  let owed = 0;
  let arrears = 0;
  for (const obligation of world.material.obligations) {
    if (!obligation.active || !chests.has(obligation.payerAccountId) || obligation.cadenceSteps <= 0) continue;
    owed += (obligation.amount * 30) / obligation.cadenceSteps;
    arrears += obligation.arrears;
  }
  if (arrears > 0 && arrears >= owed * CRISIS_ARREARS_MONTHS) {
    parts.push(`the soldiers' pay is ${Math.round(arrears)} behind, and the chest cannot meet it: men mutter, and some will go home or go over`);
  }

  const holder = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  let hubs = 0;
  let dear = 0;
  for (const hub of economyOf(world).markets) {
    if (holder.get(hub.hubId) !== polityId) continue;
    hubs += 1;
    if ((hub.goods.find((entry) => entry.good === "grain")?.priceBps ?? 0) >= CRISIS_FAMINE_BPS) dear += 1;
  }
  if (hubs > 0 && dear / hubs >= CRISIS_FAMINE_SHARE) parts.push(`bread is at a famine price in ${dear} of its ${hubs} markets, and the people are hungry`);

  if (coinagesOf(world).length > 0) {
    const coin = coinageOfPolity(world, polityId);
    const standard = standardOf(coin);
    if (standard > 0 && coin.silverBps < standard * CRISIS_COIN_SHARE) parts.push(`the coin holds ${Math.round((100 * coin.silverBps) / standard)} parts in a hundred of its silver, and men blame the ruler's cheating`);
  }
  return parts.length === 0 ? null : `A crisis of the state: ${parts.join("; ")}. The officers keep the chest and the granary; what the men and the people will do about it is his to face.`;
}
