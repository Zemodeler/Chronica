import {
  adjustPolityLegitimacy, allOffices, allSuccessionRules, appointersOf, findOfficeForRole,
  type AuthorityCheckResult, type FactProposalDraft, type GovernmentInstitution, type Office, type RequestAsk, type SuccessionRule, type WorldDelta, type WorldState,
} from "@chronica/shared";
import { vetoingOffice } from "../tribunes";
import { sovereignChamberOf } from "../constitutions";
import { askAConvener, convenersByLikelihood } from "./asking";

/**
 * What a power-wide grant does not reach, however wide it is, and what the
 * Roman constitution forbade outright.
 *
 * A consul's office gives him command over Rome's armies and the power to
 * appoint in Rome, both scoped to the whole republic. Read that literally and
 * a consul could march his colleague's army off, a praetor could take the
 * consul's legions from him, and either of them could simply name a man
 * consul or censor. None of that was ever so:
 *
 *  - **An army follows its own general.** Colleagues held equal imperium and
 *    each led the army he had levied; a praetor's imperium was the lesser. A
 *    force led by a magistrate whose command is as high as the actor's is that
 *    man's to order, not his. A ruler -- a king, a dictator -- outranks
 *    everyone, and a general who holds no office answers to the magistrate.
 *
 *  - **A seat is filled the way its office is filled.** An elected office is
 *    the voters' to give (`holdElections`), and nobody's appointing power
 *    reaches it. An office whose rule names its appointers -- the censors
 *    enrolling the Senate, a consul naming a dictator -- is theirs alone to
 *    fill, whether or not their office appoints anything else.
 *
 *  - **A chamber hears only those who may convene it.** A senator spoke when
 *    the consul asked him; only a magistrate who could call the house laid a
 *    matter before it. A man may still be put forward for an office.
 *
 *  - **A tribune may forbid.** Within the city, a tribune of the plebs could
 *    stop any magistrate's act by interposing himself: the levy, a payment, a
 *    motion. He could not reach past the first milestone -- a consul in the
 *    field was beyond him -- nor a dictator. His intercession is an
 *    arrangement he owns, of kind "intercession", naming the man and the act;
 *    it holds while he holds his office, and he lifts it by retiring it.
 *
 * Returns the authority the act really has, and a refusal where the act is
 * not to happen at all -- an unconvened motion, an act a tribune forbade --
 * since for most acts an unauthorised one still happens, recorded as a breach.
 */
export interface Judged {
  readonly authority: AuthorityCheckResult;
  readonly forbidden?: string;
  /**
   * The act as it is done instead: a motion put by the magistrate who agreed
   * to put it; a man made without the office that was not the actor's to give.
   */
  readonly instead?: WorldDelta;
  /** What the world says of how it came to be done that way. */
  readonly fact?: FactProposalDraft;
  /**
   * Not an act at all but a favour asked of a man, who answers it in his own
   * time, or the engine for him when it falls due (`requests.ts`).
   */
  readonly request?: { readonly recipientId: string; readonly instruction: string; readonly ask: RequestAsk };
}

/**
 * Questions that put something to a chamber, and so need a magistrate who may
 * call it. The rest -- a petition, an endorsement, an appointment, a command
 * -- ask a man for something, and were refused with the sentence for an
 * unconvened motion: "ask Ogulnius to take me as his legate" was told that
 * only a consul, a praetor, a dictator or a tribune may put a question to the
 * Senate (E13).
 */
const MOTIONS: ReadonlySet<string> = new Set(["vote", "council_deliberation", "decree", "treaty_ratification", "removal", "opposition_motion", "denunciation"]);

export function whoseToGive(
  delta: WorldDelta,
  world: WorldState,
  actorId: string,
  authority: AuthorityCheckResult,
  scenarioOffices: readonly Office[],
  scenarioRules: readonly SuccessionRule[] | undefined,
  resolve: (ref: string) => string | undefined,
): Judged {
  const offices = allOffices(world, scenarioOffices);
  const id = (ref: string): string => resolve(ref) ?? ref;
  const seatsOf = (characterId: string): Office[] => world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId === characterId)
    .flatMap((seat) => offices.filter((office) => office.id === seat.officeId));
  const refused = (reason: string): Judged => ({ authority: { authorized: false, grant: null, standing: null, reason } });
  const label = (officeId: string): string => offices.find((candidate) => candidate.id === officeId)?.label ?? officeId;

  const forbidden = interceded(delta, world, actorId, seatsOf, id);
  if (forbidden !== null) return { authority, forbidden };

  switch (delta.op) {
    case "office_seat_set": {
      // By id, or by the name the applier will find it by.
      const holderPolity = delta.holderCharacterRef === null ? null : world.characters.find((character) => character.id === id(delta.holderCharacterRef!))?.polityId ?? null;
      const office = offices.find((candidate) => candidate.id === delta.officeId)
        ?? (delta.officeLabel == null ? undefined : findOfficeForRole(offices, holderPolity, delta.officeLabel));
      const rule = office === undefined ? undefined : allSuccessionRules(world, scenarioRules ?? []).find((candidate) => candidate.id === office.successionRuleId);
      if (office === undefined || rule === undefined) return { authority };
      const holderId = delta.holderCharacterRef === null ? null : id(delta.holderCharacterRef);
      // Laying down one's own seat is nobody else's business (`nobodyListens`).
      const ownSeat = holderId === null && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.holderCharacterId === actorId && seat.status === "held"
        && (delta.seatId === null || seat.id === delta.seatId));
      if (ownSeat) return { authority };
      const appointers = rule.appointerOfficeIds ?? [];
      if (appointers.length > 0) {
        const as = seatsOf(actorId).find((held) => appointers.includes(held.id));
        return as === undefined
          ? refused(`${office.label} is filled by ${appointers.map(label).join(" or ")}, and by nobody else.`)
          : { authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `Filled by him as ${as.label}, whose office it is to fill it.` } };
      }
      if (rule.kind === "elective" && authority.authorized) {
        return refused(`${office.label} is chosen by ${rule.institutionId === null ? "its own college" : world.material.institutions.find((institution) => institution.id === rule.institutionId)?.name ?? "election"}: nobody names a man to it. He may stand, or be put forward.`);
      }
      return { authority };
    }
    case "political_procedure_open": {
      // A man put forward for an office is a candidacy, not a motion.
      if (delta.type === "nomination") return { authority };
      // The chamber it will go before, as the applier will send it: a vote
      // naming no body is put to the state's own (`applyOne`). Asked only of
      // the body named, a null one skipped the convener's rule altogether.
      const institution = chamberOfQuestion(delta, world, actorId, id);
      const conveners = institution?.convenedByOfficeIds ?? [];
      const sponsorId = id(delta.sponsorCharacterRef);
      const convenes = (who: string): boolean => seatsOf(who).some((held) => conveners.includes(held.id));
      // A favour asked of a man -- to take him as legate, to speak for him, to
      // put his petition -- is a request to that man, or to the magistrate
      // likeliest to hear it, and he answers it (`requests.ts`).
      if (!MOTIONS.has(delta.type) && !convenes(actorId)) {
        const subjectId = delta.subjectKind === "character" && delta.subjectRef !== null ? id(delta.subjectRef) : null;
        const named = [sponsorId, subjectId].find((who): who is string => who !== null && who !== actorId && world.characters.some((character) => character.id === who && character.alive));
        if (named === undefined && (institution === undefined || conveners.length === 0)) return { authority };
        const recipientId = named ?? convenersByLikelihood(world, actorId, institution!, delta)[0];
        if (recipientId === undefined) return { authority, forbidden: `Only a ${conveners.map(label).join(", a ")} may put a question to the ${institution!.name}, and none is in office to hear it.` };
        return { authority, request: { recipientId, instruction: delta.label, ask: askOfQuestion(delta, institution) } };
      }
      if (institution === undefined || conveners.length === 0 || convenes(actorId)) return { authority };
      // A motion he may not put himself is put by a magistrate who agrees to
      // put it -- the one he named first, if he named one -- and by nobody
      // who was not asked. Before, the friendliest consul's name went on it
      // and the consul never heard of it (L5).
      const asked = askAConvener(world, actorId, institution, delta, convenes(sponsorId) ? sponsorId : null, scenarioOffices);
      if ("declined" in asked) return { authority, forbidden: asked.declined };
      const sponsor = world.characters.find((character) => character.id === asked.sponsorId)?.name ?? asked.sponsorId;
      return {
        authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `Put by ${sponsor}, who may put it and agreed to.` },
        instead: { ...delta, sponsorCharacterRef: asked.sponsorId },
        fact: asked.fact,
      };
    }
    // A man made with an office is a man seated in it, and judged as the seat
    // is: by whoever fills it. Made by somebody who may not fill it, he is
    // made all the same -- the world has him -- but holds nothing (M5). The
    // office label went straight past `office_seat_set`'s rules, so a
    // senator's letter could make its addressee a magistrate.
    case "character_create": {
      if (delta.officeLabel === null) return { authority };
      const office = findOfficeForRole(offices, id(delta.polityId), delta.officeLabel);
      const rule = office === undefined ? undefined : allSuccessionRules(world, scenarioRules ?? []).find((candidate) => candidate.id === office.successionRuleId);
      const appointers = rule?.appointerOfficeIds ?? [];
      const filler = seatsOf(actorId).find((held) => appointers.includes(held.id));
      const why = filler !== undefined ? null
        : appointers.length > 0 ? `${office!.label} is filled by ${appointers.map(label).join(" or ")}, and by nobody else`
          : rule?.kind === "elective" ? `${office!.label} is chosen by election, and nobody names a man to it`
            : authority.authorized ? null
              : `nobody gave ${world.characters.find((character) => character.id === actorId)?.name ?? "him"} an office to give`;
      if (filler !== undefined) return { authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `Filled by him as ${filler.label}, whose office it is to fill it.` } };
      if (why === null) return { authority };
      return {
        authority: { authorized: true, grant: null, standing: "lawful", reason: "Made, holding nothing." },
        instead: { ...delta, officeLabel: null, officeAuthorises: [] },
        fact: {
          localId: `unseated_${delta.localId}`.slice(0, 60),
          kind: "office_not_given",
          summary: `${delta.name} is no ${delta.officeLabel}: ${why}.`.slice(0, 600),
          affectedRefs: [{ kind: "character", id: actorId }],
          visibility: "private",
          discoveryState: "private",
          knowableInDays: 0,
          knownToRefs: [{ kind: "character", id: actorId }],
          significance: 15,
        },
      };
    }
    // A post in an army is given by whoever the establishment says gives it,
    // and by the army's own commander (`appointersOf`). Anybody else's word is
    // refused by the men (`nobodyListens`).
    case "force_post_set": {
      const force = world.material.forces.find((candidate) => candidate.id === id(delta.forceRef));
      const rank = world.establishments.find((establishment) => establishment.polityId === force?.polityId)?.ranks.find((candidate) => candidate.id === delta.rankId);
      const man = world.characters.find((character) => character.id === id(delta.characterRef));
      if (force === undefined || rank === undefined) return { authority };
      const formationId = delta.formationRef === undefined ? man?.service?.formationId ?? null : id(delta.formationRef);
      const unitIndex = delta.unitIndex ?? man?.service?.unitIndex ?? null;
      const givers = formationId === null ? [force.commanderCharacterId, force.controllerCharacterId] : appointersOf(world, force, rank, formationId, rank.level === "unit" || rank.level === "sub" ? unitIndex : null);
      if (givers.includes(actorId)) return { authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `He gives the post of ${rank.label}.` } };
      const names = givers.map((giver) => world.characters.find((character) => character.id === giver)?.name ?? giver);
      return refused(`${rank.label} in ${force.name} is given by ${names.length === 0 ? "its commander" : names.join(" or ")}, not by him.`);
    }
    // A tribune's veto: closing a question of his own republic as blocked is
    // his office's act, where his grant names no such power (`tribunes.ts`).
    case "political_procedure_resolve": {
      const office = delta.outcome === "blocked" ? vetoingOffice(world, id(delta.procedureRef), actorId, scenarioOffices) : null;
      return office === null ? { authority } : { authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `He forbids it as ${office.label}.` } };
    }
    case "generic_entity_create": {
      // A tribune's intercession, and his leading the plebs out, are his office's own acts.
      if (!/intercession|secession/i.test(delta.kind)) return { authority };
      const tribune = seatsOf(actorId).find((held) => held.tribunician === true);
      return tribune === undefined
        ? { authority }
        : { authority: { authorized: true, grant: authority.grant, standing: "lawful", reason: `He intercedes as ${tribune.label}.` } };
    }
    default:
      break;
  }

  // Only an order to the men; what befalls them needs nobody's leave.
  const forceRef = delta.op === "force_modify" && COMMANDING.some((field) => delta[field] !== undefined) ? delta.forceRef
    : delta.op === "force_engage" || delta.op === "force_raid" || delta.op === "siege_lay" ? delta.forceRef
      : undefined;
  if (forceRef === undefined || !authority.authorized || authority.grant?.scope.kind !== "polity") return { authority };
  const force = world.material.forces.find((candidate) => candidate.id === id(forceRef));
  if (force === undefined) return { authority };
  const general = [force.commanderCharacterId, force.controllerCharacterId].find((who) => who !== actorId && world.characters.some((character) => character.id === who && character.alive));
  if (general === undefined || [force.commanderCharacterId, force.controllerCharacterId].includes(actorId)) return { authority };
  const commandRank = (characterId: string): number | null => {
    const commands = seatsOf(characterId).filter((office) => office.polityId === force.polityId && COMMAND_ACTS.some((act) => office.authorisedActionIds.includes(act)));
    if (commands.some((office) => office.authorisedActionIds.includes("capital_set"))) return Number.POSITIVE_INFINITY;
    const ranks = commands.flatMap((office) => (office.rank === undefined ? [] : [office.rank]));
    return ranks.length === 0 ? null : Math.max(...ranks);
  };
  const theirs = commandRank(general);
  const mine = commandRank(actorId);
  if (theirs === null || mine === null || mine > theirs) return { authority };
  const name = world.characters.find((character) => character.id === general)?.name ?? "its general";
  return refused(`${force.name} is ${name}'s command, and his imperium is no less than his own: it takes its orders from him.`);
}

/** The chamber a question goes before: the one named, or the state's own for a vote that names none, as `applyOne` puts it. */
function chamberOfQuestion(
  delta: Extract<WorldDelta, { op: "political_procedure_open" }>,
  world: WorldState,
  actorId: string,
  id: (ref: string) => string,
): GovernmentInstitution | undefined {
  if (delta.institutionRef !== null) return world.material.institutions.find((candidate) => candidate.id === id(delta.institutionRef!));
  if (delta.type !== "council_deliberation" && delta.resolutionMechanism !== "vote") return undefined;
  const sponsorPolity = world.characters.find((character) => character.id === id(delta.sponsorCharacterRef))?.polityId
    ?? world.characters.find((character) => character.id === actorId)?.polityId ?? null;
  const polityId = (delta.subjectKind === "polity" && delta.subjectRef !== null ? id(delta.subjectRef) : null) ?? sponsorPolity;
  return polityId === null ? undefined : sovereignChamberOf(world, polityId) ?? undefined;
}

/** What a question that asks a man for something asks him for, so that his yes can be carried out. */
function askOfQuestion(delta: Extract<WorldDelta, { op: "political_procedure_open" }>, institution: GovernmentInstitution | undefined): RequestAsk {
  switch (delta.type) {
    case "endorsement": return { kind: "speak_for" };
    case "appointment":
    case "command_assignment": return /\blegat/i.test(delta.label) ? { kind: "take_as_legate" } : { kind: "other" };
    default: return institution === undefined ? { kind: "other" } : { kind: "put_question", ref: institution.id };
  }
}

/** What an intercession may name: the levy, the treasury, the chambers, the seats -- or all of his acts in the city. */
type Interceded = "levy" | "spending" | "motion" | "appointment" | "all";

/**
 * A tribune's word standing against this act, or null.
 *
 * Only against a magistrate of the tribune's own power, never a ruler; only by
 * a tribune still in office; and only inside the city: a levy held at Rome, the
 * treasury's money, its chambers and its seats, and armies standing in the
 * city's own province. An army in the field is beyond him.
 */
function interceded(
  delta: WorldDelta,
  world: WorldState,
  actorId: string,
  seatsOf: (characterId: string) => Office[],
  id: (ref: string) => string,
): string | null {
  const magistracies = seatsOf(actorId).filter((office) => (office.kind ?? "magistracy") === "magistracy");
  if (magistracies.length === 0 || magistracies.some((office) => office.authorisedActionIds.includes("capital_set"))) return null;
  const polityId = magistracies[0]!.polityId;
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId;
  const city = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id;
  const publicMoney = (ref: string | null | undefined): boolean => {
    if (ref == null) return false;
    const owner = world.material.accounts.find((account) => account.id === id(ref))?.owner;
    return owner?.kind === "polity" && owner.id === polityId;
  };
  const kind: Interceded | null = (() => {
    switch (delta.op) {
      case "force_create": return delta.locationId === city ? "levy" : null;
      case "force_reinforce": {
        const force = world.material.forces.find((candidate) => candidate.id === id(delta.forceRef));
        return force?.locationId === city ? "levy" : null;
      }
      case "money_transfer": return publicMoney(delta.fromAccountRef) ? "spending" : null;
      case "obligation_upsert": return publicMoney(delta.payerAccountRef) ? "spending" : null;
      case "project_create": return publicMoney(delta.fundingAccountRef) ? "spending" : null;
      case "service_contract_open": return publicMoney(delta.employerAccountRef) ? "spending" : null;
      case "political_procedure_open": return delta.type === "nomination" ? null : "motion";
      case "office_seat_set": return "appointment";
      case "force_modify": {
        const force = world.material.forces.find((candidate) => candidate.id === id(delta.forceRef));
        return force?.locationId === city && COMMANDING.some((field) => delta[field] !== undefined) ? "all" : null;
      }
      default: return null;
    }
  })();
  if (kind === null) return null;
  for (const entity of world.genericEntities) {
    if (!/intercession/i.test(entity.kind) || "retiredAtStep" in entity.attributes || entity.ownerRef?.kind !== "character") continue;
    if (entity.attributes.against !== actorId) continue;
    const act = String(entity.attributes.act ?? "all").toLowerCase();
    if (act !== "all" && act !== kind) continue;
    const tribuneId = entity.ownerRef.id;
    const tribune = world.characters.find((character) => character.id === tribuneId && character.alive);
    const office = seatsOf(tribuneId).find((held) => held.tribunician === true && held.polityId === polityId);
    if (tribune === undefined || office === undefined) continue;
    const actor = world.characters.find((character) => character.id === actorId)?.name ?? "The magistrate";
    return `${tribune.name}, as ${office.label}, has interceded against ${actor}${act === "all" ? "" : `'s ${act === "levy" ? "levy" : act === "spending" ? "spending of the public money" : act === "motion" ? "motions" : "appointments"}`}, and nobody in the city would act against a tribune's word while it stands.`;
  }
  return null;
}

/**
 * The tribune's person was sacrosanct: whoever laid hands on him was accursed,
 * and the plebs had sworn to avenge him. A man who kills a sitting tribune is
 * disgraced before the whole people, and the government that let it happen
 * loses its standing with them.
 */
export function sacrilegeOf(
  delta: WorldDelta,
  before: WorldState,
  after: WorldState,
  actorId: string,
  scenarioOffices: readonly Office[],
  nextCauseId: () => string,
): { readonly world: WorldState; readonly fact: FactProposalDraft } | null {
  if (delta.op !== "character_death" || delta.manner === "suicide") return null;
  const victimId = delta.characterRef.replace(/^local:/, "");
  const victim = before.characters.find((character) => character.id === victimId);
  if (victim === undefined || victimId === actorId || after.characters.find((character) => character.id === victimId)?.alive !== false) return null;
  const offices = allOffices(before, scenarioOffices);
  const office = before.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId === victimId)
    .map((seat) => offices.find((candidate) => candidate.id === seat.officeId))
    .find((candidate) => candidate?.tribunician === true);
  if (office === undefined) return null;
  const killer = after.characters.find((character) => character.id === actorId);
  const world: WorldState = {
    ...after,
    characters: after.characters.map((character) => (character.id === actorId ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - SACRILEGE_STANDING_BPS) } : character)),
    material: {
      ...after.material,
      polityLegitimacy: adjustPolityLegitimacy(after.material.polityLegitimacy, office.polityId, -SACRILEGE_LEGITIMACY_BPS, `A ${office.label} was killed in office`, nextCauseId()),
    },
  };
  return {
    world,
    fact: {
      localId: `sacrilege_${victimId}`.slice(0, 60),
      kind: "sacrilege",
      summary: `${victim.name} was killed while ${office.label}, whose person is sacrosanct. ${killer?.name ?? "His killer"} is accursed before the people.`,
      affectedRefs: [{ kind: "character", id: victimId }, { kind: "character", id: actorId }, { kind: "polity", id: office.polityId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 70,
    },
  };
}

const SACRILEGE_STANDING_BPS = 2_500;
const SACRILEGE_LEGITIMACY_BPS = 1_000;
const COMMANDING = ["locationId", "positionId", "commanderCharacterRef", "controllerCharacterRef", "polityId", "name", "payObligationRef", "authorizedStrengthDelta", "outlaw"] as const;
const COMMAND_ACTS = ["force_create", "force_modify", "force_engage"];
