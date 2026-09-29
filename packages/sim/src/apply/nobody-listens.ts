import { allOffices, deriveRelationDimension, familyLinksOf, stableHash, type Office, type WorldDelta, type WorldState } from "@chronica/shared";

/**
 * An order nobody is obliged to carry out does not happen.
 *
 * Authority used to be judged after the fact: an act outside somebody's
 * station was carried out anyway and recorded as a breach for an auditor to
 * find. That is right for insubordination -- a legate who marches his own
 * legion against orders has done it, and the men went with him -- and wrong
 * for everything else. A legionary with no office raised six thousand Gauls in
 * Rome's name and founded a kingdom with them, and the only consequence was a
 * private note that he should not have.
 *
 * The difference is whether anybody had to listen. An act needs an instrument
 * -- men, money, ground -- and the instrument answers to somebody. When it
 * answers to the actor, the act happens, lawful or not. When it answers to
 * someone else and the actor has no authority over it, nobody moves, and the
 * world notices a man giving orders to people who do not take them from him.
 *
 * Only acts outside the actor's authority reach this. Returns the world's
 * answer, or null where the act has somebody to carry it out.
 */
export function nobodyListens(
  delta: WorldDelta,
  world: WorldState,
  actorId: string,
  resolve: (ref: string) => string | undefined,
  /**
   * Everything this answer has made so far. A merchant the world invents in
   * the same breath to lend the state money is doing what the world says he
   * does -- that is why he was made -- so his purse and his men answer to the
   * answer that made him. People who already existed answer for themselves.
   */
  madeInThisAnswer: ReadonlySet<string> = new Set(),
  offices: readonly Office[] = [],
  /**
   * The act is the order's, and falls inside another power (see
   * `ApplyContext.orderDeltas`). Its armies and treasuries answer to their
   * own people as they always did; and on top of that nobody abroad takes it
   * that a foreigner can bind their government -- its treaties, its letters,
   * its councils and its taxes are its own to make.
   */
  abroad = false,
): string | null {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined) return null;
  const who = actor.name;
  const pick = (lines: readonly string[]): string => lines[stableHash([actorId, delta.op, world.elapsedStep, JSON.stringify(delta).length]) % lines.length]!;
  const name = (id: string | null | undefined): string => world.characters.find((character) => character.id === id)?.name ?? "somebody else";
  const polity = (id: string | null | undefined): string => world.map.polities.find((candidate) => candidate.id === id)?.name ?? "the state";
  const answersToThisAnswer = (id: string | null | undefined): boolean => id != null && (id === actorId || madeInThisAnswer.has(id));
  const leads = (forceId: string): boolean =>
    madeInThisAnswer.has(forceId)
    || world.material.forces.some((force) => force.id === forceId && (answersToThisAnswer(force.commanderCharacterId) || answersToThisAnswer(force.controllerCharacterId)));
  // His own purse, the war chest of an army he leads, or the fund of an
  // arrangement that is his.
  const ownsArrangement = (entityId: string): boolean =>
    madeInThisAnswer.has(entityId)
    || world.genericEntities.some((entity) => entity.id === entityId && entity.ownerRef?.kind === "character" && answersToThisAnswer(entity.ownerRef.id));
  const ownsAccount = (id: string | undefined): boolean =>
    world.material.accounts.some((account) => account.id === id
      && ((account.owner.kind === "character" && answersToThisAnswer(account.owner.id))
        || (account.owner.kind === "force" && leads(account.owner.id))
        || (account.owner.kind === "entity" && ownsArrangement(account.owner.id))));

  const ignoredBy = (forceRef: string): string | null => {
    const force = world.material.forces.find((candidate) => candidate.id === (resolve(forceRef) ?? forceRef));
    if (force === undefined || leads(force.id)) return null;
    const general = name(force.commanderCharacterId);
    return pick([
      `${who} gave ${force.name} its orders. ${force.name} looked to ${general}, who had given none, and stayed exactly where it was.`,
      `${who} rode out to take charge of ${force.name}. The men were polite about it, but they take their orders from ${general}.`,
      `Nobody in ${force.name} could remember appointing ${who} to anything, and so nothing happened.`,
    ]);
  };

  // A foreigner speaking for a government that is not his. Asked first, so
  // that none of the cases below -- written for a man's own country -- can
  // let it through.
  const foreign = (): string => pick([
    `${who} spoke as though ${polity(abroadPolityOf(delta, world, resolve, offices))} were his to commit. Nobody there thought so.`,
    `The ${polity(abroadPolityOf(delta, world, resolve, offices))} heard what ${who} had decided on their behalf, and went on deciding for themselves.`,
  ]);
  if (abroad && GOVERNMENT_ACTS.has(delta.op)) return foreign();

  switch (delta.op) {
    // A seat is filled by whoever may fill it, or taken by force. A man who
    // names himself consul with nobody behind him is addressed as nothing of
    // the kind -- and one who leaves his own seat needs nobody's leave.
    case "office_seat_set": {
      const office = allOffices(world, offices).find((candidate) => candidate.id === delta.officeId);
      const holderId = delta.holderCharacterRef === null ? null : resolve(delta.holderCharacterRef) ?? delta.holderCharacterRef;
      const seat = delta.seatId === null ? undefined : world.material.officeSeats.find((candidate) => candidate.id === delta.seatId);
      const leavingOwn = holderId === null && (seat?.holderCharacterId === actorId
        || (seat === undefined && world.material.officeSeats.some((candidate) => candidate.officeId === delta.officeId && candidate.holderCharacterId === actorId)));
      if (leavingOwn) return null;
      // A seizure. Men of his own standing in the seat of that government.
      const capitalOf = (polityId: string | undefined): string | undefined => {
        const capital = world.map.polities.find((candidate) => candidate.id === polityId)?.capitalSettlementId;
        return world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id;
      };
      const capital = capitalOf(office?.polityId ?? actor.polityId ?? undefined);
      const armedThere = capital !== undefined && world.material.forces.some((force) => force.locationId === capital && leads(force.id)
        && force.personnel.some((category) => category.fit > 0));
      if (armedThere) return null;
      const title = office?.label ?? delta.officeLabel ?? "the office";
      const named = holderId === actorId ? `himself ${title}` : `${name(holderId)} ${title}`;
      return pick([
        `${who} declared ${named}. Nobody who could make it so had done so, and nobody addressed ${holderId === actorId ? "him" : "the man"} by the title.`,
        `${who} announced that ${named.replace(/^himself /, "he was ")}. The lictors went on attending the men they had attended the day before.`,
      ]);
    }
    // A question is settled by the body it was put to. Only a question left
    // to its own sponsor's discretion is his to close.
    case "political_procedure_resolve": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === (resolve(delta.procedureRef) ?? delta.procedureRef));
      if (procedure === undefined) return null;
      if (procedure.sponsorCharacterId === actorId && procedure.resolutionMechanism === "sponsor_discretion") return null;
      const body = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.name ?? "those whose business it was";
      return `${who} declared "${procedure.label}" ${delta.outcome}. ${body[0]!.toUpperCase()}${body.slice(1)} had not decided it, and did not consider it decided.`;
    }
    // Men follow their own general, even where he has no right to lead them.
    // Only an order to the men is an order, though: their morale, rations and
    // weariness are what somebody else's raid or plague did to them, and need
    // nobody's obedience.
    case "force_modify":
      return COMMANDING_FIELDS.some((field) => delta[field] !== undefined) ? ignoredBy(delta.forceRef) : null;
    case "force_engage":
    case "force_raid":
    case "force_reinforce":
      return ignoredBy(delta.forceRef);
    // An army out of nothing needs a magistrate's word or a paymaster. A man
    // who pays from his own purse has a private band; a man who only promises
    // has an audience.
    case "force_create": {
      const obligationId = delta.payObligationRef === null ? null : resolve(delta.payObligationRef) ?? delta.payObligationRef;
      const payer = world.material.obligations.find((obligation) => obligation.id === obligationId)?.payerAccountId;
      if (payer !== undefined && ownsAccount(payer)) return null;
      const under = polity(resolve(delta.polityId) ?? delta.polityId);
      return pick([
        `${who} called on the men of ${under} to take up arms. They asked who was paying, and when nobody was, went home.`,
        `${who} announced the raising of ${delta.name}. The magistrates of ${under}, who raise armies, had not been told, and neither, it turned out, had any soldiers.`,
        `Recruiters for ${delta.name} found great enthusiasm for ${who}'s speeches and none at all for enlisting on a promise.`,
      ]);
    }
    // A treasury opens for whoever keeps its key.
    case "money_transfer": {
      const from = resolve(delta.fromAccountRef) ?? delta.fromAccountRef;
      if (ownsAccount(from) || !world.material.accounts.some((account) => account.id === from)) return null;
      return pick([
        `${who} directed that ${delta.amount} be paid out. The keeper of the account read the instruction twice, filed it, and paid nothing.`,
        `The strongbox does not open for ${who}, however firmly the knocking.`,
      ]);
    }
    // A man is hired by whoever holds the purse that pays him.
    case "service_contract_open": {
      const from = resolve(delta.employerAccountRef) ?? delta.employerAccountRef;
      if (ownsAccount(from) || !world.material.accounts.some((account) => account.id === from)) return null;
      return `${who} engaged a man on money that was not his to promise. The man asked who was paying, and did not wait to find out.`;
    }
    case "obligation_upsert": {
      const payer = resolve(delta.payerAccountRef) ?? delta.payerAccountRef;
      if (ownsAccount(payer) || !world.material.accounts.some((account) => account.id === payer)) return null;
      return `${who} promised that ${delta.label.toLowerCase()} would be paid from money that was never ${who}'s to promise. Nobody has been paid.`;
    }
    default:
      return null;
  }
}

/**
 * Acts that commit a government: its treaties, its letters, its councils, its
 * offices, its revenue and its grants of power. A foreigner's order cannot
 * make any of them, whatever he writes.
 */
const GOVERNMENT_ACTS: ReadonlySet<WorldDelta["op"]> = new Set([
  "agreement_open", "agreement_close", "diplomatic_message_send", "political_procedure_open", "political_procedure_resolve",
  "office_seat_set", "authority_grant_upsert", "income_source_upsert", "obligation_upsert", "polity_create",
]);

/** The government an act abroad would commit, for saying whose it was not. */
function abroadPolityOf(delta: WorldDelta, world: WorldState, resolve: (ref: string) => string | undefined, offices: readonly Office[]): string | undefined {
  const id = (ref: string): string => resolve(ref) ?? ref;
  const ofAccount = (ref: string): string | undefined => {
    const owner = world.material.accounts.find((account) => account.id === id(ref))?.owner;
    return owner?.kind === "polity" ? owner.id : world.characters.find((character) => character.id === owner?.id)?.polityId ?? undefined;
  };
  switch (delta.op) {
    case "agreement_open": return id(delta.polityId);
    case "agreement_close": {
      const agreement = world.polityAgreements.find((candidate) => candidate.id === id(delta.agreementRef));
      return agreement?.polityId;
    }
    case "diplomatic_message_send": return id(delta.fromPolityId);
    case "office_seat_set": return allOffices(world, offices).find((office) => office.id === delta.officeId)?.polityId;
    case "income_source_upsert": return ofAccount(delta.beneficiaryAccountRef);
    case "obligation_upsert": return ofAccount(delta.payerAccountRef);
    case "political_procedure_open":
      return delta.institutionRef === null ? undefined : world.material.institutions.find((institution) => institution.id === id(delta.institutionRef!))?.polityId;
    case "political_procedure_resolve": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === id(delta.procedureRef));
      return world.material.institutions.find((institution) => institution.id === procedure?.institutionId)?.polityId;
    }
    default: return undefined;
  }
}

/** The fields of `force_modify` that tell the men to do something, rather than say what befell them. */
const COMMANDING_FIELDS = [
  "locationId", "positionId", "commanderCharacterRef", "controllerCharacterRef", "polityId", "name", "payObligationRef", "authorizedStrengthDelta", "outlaw",
] as const;

/** Below this, a province's people are restless enough to follow whoever raises a banner. */
const UNREST_BPS = 5_000;

/**
 * A country founded by a speech.
 *
 * `polity_create` is how the world lets a rising become a power, and a rising
 * the world decides on is nobody's personal act. But a man standing in the
 * province rallying it himself is: he needs either men of his own there, or a
 * people already restless enough to follow a stranger. Without either, they
 * hear him out and go home.
 */
export function nobodyRises(
  delta: Extract<WorldDelta, { op: "polity_create" }>,
  world: WorldState,
  actorId: string,
): string | null {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined || !delta.provinceIds.includes(actor.locationProvinceId)) return null;
  const hasMen = world.material.forces.some((force) =>
    delta.provinceIds.includes(force.locationId)
    && (force.commanderCharacterId === actorId || force.controllerCharacterId === actorId)
    && force.personnel.some((category) => category.fit > 0));
  if (hasMen) return null;
  const restless = delta.provinceIds.some((provinceId) =>
    (world.material.provinceMaterial.find((row) => row.provinceId === provinceId)?.stabilityBps ?? 10_000) < UNREST_BPS);
  if (restless) return null;
  const province = world.map.provinces.find((candidate) => candidate.id === actor.locationProvinceId);
  const people = province?.controllerPolityId == null ? "the people there" : `the ${world.map.polities.find((polity) => polity.id === province.controllerPolityId)?.name ?? "people there"}`;
  return `${actor.name} proclaimed ${delta.name}. ${people[0]!.toUpperCase()}${people.slice(1)} heard the speech out, agreed it was a fine one, and went on exactly as before.`;
}

/** How well somebody must think of a man to do what he asks with no right to ask it. */
const WILLING_REGARD = 40;

/**
 * Somebody who does it anyway.
 *
 * Authority is not the only reason men do things. A legate who owes his career
 * to a man, loves him, or has wanted this very war for years will march on his
 * word with no order behind it; a paymaster in his debt will find the money.
 * That is how a private man with friends in the right places gets things done,
 * and how a coup starts. So before an act nobody had to obey is refused, the
 * one person it depends on is asked whether they would -- by what they feel
 * for the man asking, by blood, and by whether they wanted it done already.
 *
 * Deterministic, and never a free pass: the act still breaches, and both men
 * are on the record for it.
 */
export function listensAnyway(
  delta: WorldDelta,
  world: WorldState,
  actorId: string,
  resolve: (ref: string) => string | undefined,
  offices: readonly Office[] = [],
): { readonly listenerId: string; readonly why: string } | null {
  const id = (ref: string | null | undefined): string | null => ref == null ? null : resolve(ref) ?? ref;
  const forceOf = (ref: string) => world.material.forces.find((force) => force.id === id(ref));
  const keeperOf = (accountRef: string): string | null => {
    const account = world.material.accounts.find((candidate) => candidate.id === id(accountRef));
    if (account === undefined) return null;
    if (account.owner.kind === "character") return account.owner.id;
    if (account.owner.kind === "force") return forceOf(account.owner.id)?.commanderCharacterId ?? null;
    if (account.owner.kind !== "polity") return null;
    const keeping = allOffices(world, offices).filter((office) => office.treasuryAccountId === account.id).map((office) => office.id);
    return world.material.officeSeats.find((seat) => seat.status === "held" && keeping.includes(seat.officeId))?.holderCharacterId ?? null;
  };

  let listenerId: string | null = null;
  // What the act is aimed at, for asking whether the listener wanted it anyway.
  let aimedAt: readonly (string | null | undefined)[] = [];
  switch (delta.op) {
    case "force_modify":
    case "force_reinforce": {
      const force = forceOf(delta.forceRef);
      listenerId = force?.commanderCharacterId ?? force?.controllerCharacterId ?? null;
      aimedAt = delta.op === "force_modify" ? [delta.locationId, world.map.provinces.find((province) => province.id === delta.locationId)?.controllerPolityId] : [];
      break;
    }
    case "force_engage": {
      const force = forceOf(delta.forceRef);
      const target = forceOf(delta.targetForceRef);
      listenerId = force?.commanderCharacterId ?? force?.controllerCharacterId ?? null;
      aimedAt = [target?.id, target?.polityId, target?.commanderCharacterId];
      break;
    }
    case "force_raid": {
      const force = forceOf(delta.forceRef);
      listenerId = force?.commanderCharacterId ?? force?.controllerCharacterId ?? null;
      break;
    }
    case "money_transfer":
      listenerId = keeperOf(delta.fromAccountRef);
      break;
    case "obligation_upsert":
      listenerId = keeperOf(delta.payerAccountRef);
      break;
    case "service_contract_open":
      listenerId = keeperOf(delta.employerAccountRef);
      break;
    default:
      return null;
  }
  if (listenerId === null || listenerId === actorId) return null;
  const listener = world.characters.find((character) => character.id === listenerId && character.alive);
  if (listener === undefined) return null;
  const actor = world.characters.find((character) => character.id === actorId);
  const actorName = actor?.name ?? "him";

  const kin = familyLinksOf(world, listenerId, world.elapsedStep).some((link) => link.counterpartCharacterId === actorId);
  if (kin) return { listenerId, why: `${listener.name} did it because ${actorName} is family, and family is not refused.` };
  const regard = ["trust", "affection", "respect", "obligation"]
    .reduce((sum, dimension) => sum + deriveRelationDimension(listener, actorId, dimension as Parameters<typeof deriveRelationDimension>[2]), 0);
  if (regard >= WILLING_REGARD) return { listenerId, why: `${listener.name} had no orders to do it, and did it anyway for ${actorName}'s sake.` };
  const wanted = listener.ambitions.some((ambition) => ambition.status === "active" && ambition.targetId !== null && aimedAt.includes(ambition.targetId));
  if (wanted) return { listenerId, why: `${listener.name} had wanted this long before ${actorName} asked, and was glad of the excuse.` };
  return null;
}

/**
 * What a slave cannot do on his own account.
 *
 * His purse is his master's unless the master has let him keep one -- the
 * peculium -- and so is any bargain paid from it. Returns the world's answer
 * when the act spends what is not his to spend, or null.
 */
export function notHisToSpend(delta: WorldDelta, world: WorldState, actorId: string, resolve: (ref: string) => string | undefined): string | null {
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined || actor.legalStatus !== "enslaved" || actor.peculium) return null;
  const id = (ref: string | null | undefined): string | null => ref == null ? null : resolve(ref) ?? ref;
  const purse = actor.personalAccountId;
  const obligationPayer = (ref: string | null | undefined): string | undefined =>
    world.material.obligations.find((obligation) => obligation.id === id(ref))?.payerAccountId;
  const spends = (() => {
    switch (delta.op) {
      case "money_transfer": return id(delta.fromAccountRef) === purse;
      case "obligation_upsert": return id(delta.payerAccountRef) === purse;
      case "loan_open": return delta.lenderKind === "character" && id(delta.lenderRef) === actorId;
      case "holding_create": return id(delta.priceFromAccountRef) === purse;
      case "holding_improve": return id(delta.paidFromAccountRef) === purse;
      case "trade_venture_open": return id(delta.paidFromAccountRef) === purse;
      case "force_create": return obligationPayer(delta.payObligationRef) === purse;
      case "generic_entity_create":
      case "generic_entity_update": return delta.upkeep != null && id(delta.upkeep.fromAccountRef) === purse;
      case "service_contract_open": return id(delta.employerAccountRef) === purse;
      default: return false;
    }
  })();
  if (!spends) return null;
  const owner = world.characters.find((character) => character.id === actor.ownerCharacterId)?.name ?? "his master";
  return `${actor.name} reached for money that is, in law, ${owner}'s. Nobody would take it from a slave without his master's word.`;
}

/** A slave going where he likes without leave is running away, and everybody hears of it. */
export function fleesHisMaster(delta: WorldDelta, world: WorldState, actorId: string): string | null {
  if (delta.op !== "character_state_set" || delta.moveToProvinceId == null || delta.characterRef !== actorId) return null;
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined || actor.legalStatus !== "enslaved" || delta.moveToProvinceId === actor.locationProvinceId) return null;
  const owner = world.characters.find((character) => character.id === actor.ownerCharacterId)?.name ?? "his master";
  return `${actor.name} has run away from ${owner}. A runaway slave is hunted, and anybody who shelters him answers for it.`;
}
