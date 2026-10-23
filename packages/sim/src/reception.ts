import {
  GenericEntitySchema,
  warsOf,
  type Character,
  type FactProposalDraft,
  type GovernmentInstitution,
  type PoliticalProcedure,
  type WorldState,
} from "@chronica/shared";
import { bringTheCase } from "./close-of-office";
import { safeLocalId } from "./safe-local-id";

/**
 * The Senate's reception decree (docs/plans/playtest-fixes.md, "Defection gaps closed").
 *
 * A consul received a man who came over "under his protection" at once, whoever he was. The custom was otherwise for a man of weight: Rome gave a refugee
 * *hospitium* by decree of the Senate, and it was the consul who laid it before the house (Livy 21.12, the exiles of Saguntum; 42.19, the Carthaginian envoys
 * and the guests of Rome). A humble man, a trooper or a clerk, was taken in by the consul's own word, as before. So a man of rank who goes over to a power that
 * keeps a house to decide it is a *suppliant* until the house has voted: a general (a man who held an army, or one of the generals' offices), an officer with men
 * under him, or a man of standing (a seat in an office or the council, or a name of the first rank). The vote is the ordinary one, by the chamber's blocs; the
 * question is a motion of the consul, "that he be received as a guest of Rome".
 *
 *  - Carried: the consul is his patron, the man is a guest and no citizen, and it is told in the words of the age.
 *  - Refused: if his own power is at peace with the one he came to, he is given up to it and held (`captured`, the machinery of a man in another's hands), and its
 *    own custom has him; if it is at war with it, he is left without protection, no one's guest in a city that owes him nothing, and any magistrate may send him off.
 *    What his own power did the day he left (his estate, his family, his name) stands either way (`defection.ts`).
 *
 * All by rule, deterministic, no model call.
 */

export const SUPPLIANT = "suppliant";
export const UNPROTECTED = "unprotected";
export const RECEPTION_KIND = "reception";
/** Standing (basis points) above which a man is of weight even with no office. */
const OF_STANDING_BPS = 6_000;
/** Days the house is given to decide it. */
const RECEPTION_DAYS = 10;
const GENERALS_OFFICES = /strategos|consul|general|admiral|navarch|legate|praetor|dictator|master/iu;

const OPEN = new Set<PoliticalProcedure["stage"]>(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

/** What makes a man's coming a matter for the house, in words; null for a humble man the consul takes in himself. Read before his armies are handed on. */
export function rankOf(world: WorldState, man: Character): string | null {
  const commands = world.material.forces.filter((force) => force.commanderCharacterId === man.id || force.controllerCharacterId === man.id);
  const men = commands.reduce((sum, force) => sum + force.personnel.reduce((total, row) => total + row.fit, 0), 0);
  const seats = world.material.officeSeats.filter((seat) => seat.holderCharacterId === man.id && seat.status === "held");
  if (seats.some((seat) => GENERALS_OFFICES.test(seat.officeId)) || men >= 1_000) return "a general";
  if (commands.length > 0 && men > 0) return "an officer with men under him";
  if (seats.length > 0 || man.prestigeBps >= OF_STANDING_BPS) return "a man of standing";
  return null;
}

/** The house that would receive him: the power's council that is not a mere counsel, if it keeps one. */
export function receptionChamber(world: WorldState, polityId: string): GovernmentInstitution | undefined {
  const chambers = world.material.institutions.filter((institution) => institution.polityId === polityId && institution.advisory !== true);
  return chambers.find((institution) => institution.franchise === "council") ?? chambers.find((institution) => institution.votingBlocs.length > 0);
}

const fact = (localId: string, summary: string, refs: NonNullable<FactProposalDraft["affectedRefs"]>, significance: number): FactProposalDraft => ({
  localId: safeLocalId(localId).slice(0, 60), kind: "defection", summary: summary.slice(0, 600), affectedRefs: refs.slice(0, 8),
  visibility: "public", discoveryState: "public", knowableInDays: 0, significance,
});

/** The motion, laid before the house by the receiving consul, and the note that remembers whose it is. Null where the power keeps no house or no man to lay it. */
export function layReception(world: WorldState, man: Character, hostPolityId: string, homePolityId: string, receiver: Character, rank: string, atStep: number): { readonly world: WorldState; readonly label: string } | null {
  const chamber = receptionChamber(world, hostPolityId);
  if (chamber === undefined) return null;
  const host = world.map.polities.find((polity) => polity.id === hostPolityId)?.name ?? hostPolityId;
  const home = world.map.polities.find((polity) => polity.id === homePolityId)?.name ?? homePolityId;
  const label = `Motion of ${receiver.name}: that ${man.name}, ${rank} who came over from ${home}, be received as a guest of ${host} and given hospitium`.slice(0, 200);
  const id = safeLocalId(`reception-${man.id}-${atStep}`).slice(0, 100);
  const procedure: PoliticalProcedure = {
    id, type: "council_deliberation", institutionId: chamber.id, sponsorCharacterId: receiver.id, subjectKind: "character", subjectId: man.id, label,
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote", openedAtStep: atStep, deadlineStep: atStep + RECEPTION_DAYS,
    resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [], concerns: [],
  };
  return {
    label,
    world: {
      ...world,
      material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] },
      genericEntities: [...world.genericEntities, GenericEntitySchema.parse({
        id: `reception-note-${man.id}-${atStep}`.slice(0, 100), kind: RECEPTION_KIND, label: `${man.name} asks refuge of ${host}`.slice(0, 120), ownerRef: { kind: "polity", id: hostPolityId },
        attributes: { characterId: man.id, homeId: homePolityId, hostId: hostPolityId, procedureId: id, sponsorId: receiver.id, settled: false }, createdAtStep: atStep,
      })],
    },
  };
}

const patronLink = (world: WorldState, manId: string, receiverId: string, atStep: number): WorldState => (world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === manId && link.targetCharacterId === receiverId)
  ? world
  : {
    ...world,
    socialLinks: [...world.socialLinks, {
      id: safeLocalId(`patron_${manId}_${receiverId}`).slice(0, 100), subjectCharacterId: manId, targetCharacterId: receiverId, kind: "patron" as const,
      sourceEventId: null, createdAtStep: atStep, visibility: "public" as const,
    }],
  });

/**
 * Settles every reception the house has decided: carried, he is the guest of the power under the consul's patronage; refused, he is given up or left without
 * protection. A suppliant whose question is still open stays one. Run each day before the bodies sit (`keepTheBodies`).
 */
export function settleReceptions(input: { readonly world: WorldState; readonly toDay: number }): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  for (const note of input.world.genericEntities) {
    if (note.kind !== RECEPTION_KIND || note.attributes?.["settled"] === true) continue;
    const manId = String(note.attributes?.["characterId"]);
    const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === note.attributes?.["procedureId"]);
    if (procedure === undefined || (OPEN.has(procedure.stage) && procedure.outcome === null)) continue;
    const man = world.characters.find((character) => character.id === manId);
    const hostId = String(note.attributes?.["hostId"]);
    const homeId = String(note.attributes?.["homeId"]);
    const sponsorId = String(note.attributes?.["sponsorId"]);
    const sponsor = world.characters.find((character) => character.id === sponsorId);
    const hostName = world.map.polities.find((polity) => polity.id === hostId)?.name ?? hostId;
    const homeName = world.map.polities.find((polity) => polity.id === homeId)?.name ?? homeId;
    const settle = (changes: (character: Character) => Character): void => {
      world = {
        ...world,
        characters: world.characters.map((character) => (character.id === manId ? changes(character) : character)),
        genericEntities: world.genericEntities.map((entity) => (entity.id === note.id ? { ...entity, attributes: { ...entity.attributes, settled: true, outcome: procedure.outcome ?? "withdrawn", atStep: input.toDay } } : entity)),
      };
    };
    if (man === undefined || !man.alive) { settle((character) => character); continue; }
    const without = (character: Character, ...gone: string[]): string[] => character.disqualifyingStatuses.filter((status) => !gone.includes(status));
    const refs = [{ kind: "character" as const, id: manId }, { kind: "polity" as const, id: hostId }, { kind: "polity" as const, id: homeId }];
    if (procedure.outcome === "passed") {
      const chamberName = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.name ?? "Senate";
      settle((character) => ({ ...character, disqualifyingStatuses: without(character, SUPPLIANT, UNPROTECTED) }));
      if (sponsor !== undefined) world = patronLink(world, manId, sponsor.id, input.toDay);
      facts.push(fact(`hospitium_${manId}`, `The ${chamberName} decreed that ${man.name}, who came over from ${homeName}, be received as a guest of ${hostName} and given hospitium${sponsor === undefined ? "" : `, ${sponsor.name} his patron`}: he is a guest and no citizen, with no tribe, no vote and no magistracy, and he may serve as an officer of the allies.`, [...refs, ...(sponsor === undefined ? [] : [{ kind: "character" as const, id: sponsor.id }])], 60));
      continue;
    }
    const atWar = warsOf(world.polityAgreements, hostId).includes(homeId);
    if (!atWar && homeId !== "") {
      // At peace with his own power, the house gives him up: he is held, as any man is in another's hands, and his own custom has him.
      settle((character) => ({ ...character, polityId: homeId, disqualifyingStatuses: [...without(character, SUPPLIANT, UNPROTECTED, "foreigner"), ...(character.disqualifyingStatuses.includes("captured") ? [] : ["captured"])].slice(0, 8) }));
      // The power he left has him for its court, where it keeps one (`bringTheCase`: a capital case for going over).
      world = bringTheCase(world, { accusedId: manId, polityId: homeId, label: `The trial of ${man.name}, who went over and was given up by ${hostName}`, day: input.toDay, sentence: "death", sponsor: null }).world;
      facts.push(fact(`refused_${manId}`, `The ${hostName} Senate would not receive ${man.name}, and he was sent back to ${homeName} under guard: ${homeName}'s own custom will have him for going over.`, refs, 65));
    } else {
      settle((character) => ({ ...character, disqualifyingStatuses: [...without(character, SUPPLIANT), ...(character.disqualifyingStatuses.includes(UNPROTECTED) ? [] : [UNPROTECTED])].slice(0, 8) }));
      facts.push(fact(`refused_${manId}`, `The ${hostName} Senate would not receive ${man.name}, who came over from ${homeName}: he is left without protection, no man's guest and no man's client, and any magistrate may send him from the city.`, refs, 65));
    }
  }
  return { world, facts };
}
