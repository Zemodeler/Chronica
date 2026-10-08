import {
  GenericEntitySchema,
  INFAMIA_KIND,
  computeOpinion,
  readDepartments,
  shiftStanding,
  type Character,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import { courtForTheft } from "./magistrates";
import { safeLocalId } from "./safe-local-id";

/**
 * A man who goes over to another power (docs/plans/playtest-fixes.md, batch 3).
 *
 * Only the orchestrator could write a person's power over, and nothing received him: the man who went over from Carthage to Rome was a Roman citizen the next
 * morning, scored "enough for military tribune and quaestor", and Carthage did nothing at all. Now he is a *guest*, not a citizen: the ruler who receives him
 * (a consul "under his protection", as a Roman magistrate took a suppliant, or a suffete, a king) decides by rule whether to take him; he is marked a
 * `foreigner` and a `deserter`, which the offices' rules read (no tribe, no vote, no magistracy, no seat in the Senate: a citizen by a law of the people
 * only, which is rare; `grantCitizenship`); he is the receiving ruler's client (`patron`), and may hold what he brings under that protection and serve as an
 * officer of the allies and auxiliaries. And the power he left answers by its own custom: Carthage's Hundred and Four try him in his absence, his estate
 * is seized, and his family are held as hostages for him; Rome strikes him from the Senate and magistracies and the people take the estate for the treasury.
 * The companies he led either follow him (the orchestrator's own order carries them) or fall back to the power's officers (`handOverForcesOf`). Deterministic.
 */

export const FOREIGNER = "foreigner";
export const DESERTER = "deserter";
/** The ruler's opinion of him below which he is turned away. */
const TURNED_AWAY_AT = -30;
/** How many of his kin are held for him. */
const MOST_HOSTAGES = 4;

export interface Defection {
  readonly refusal?: string;
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  /** Statuses to put on the man. */
  readonly statuses: readonly string[];
}

/** Whether a man is a guest of another power and no citizen. */
export const isForeigner = (character: Pick<Character, "disqualifyingStatuses">): boolean => character.disqualifyingStatuses.includes(FOREIGNER);

/**
 * The people of a power may make a guest a citizen by law: the status is lifted, and he is a man of the tribes. Rare; nothing in the engine does it by itself.
 */
export function grantCitizenship(world: WorldState, characterId: string): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === characterId
      ? { ...character, disqualifyingStatuses: character.disqualifyingStatuses.filter((status) => status !== FOREIGNER && status !== DESERTER) }
      : character)),
  };
}

/** The men of the home power he leaves bound to him: wife and children living there, not above `MOST_HOSTAGES`. */
function kinOf(world: WorldState, man: Character): Character[] {
  const ids = new Set<string>();
  for (const link of world.familyLinks) {
    if (link.endedAtStep !== null) continue;
    const other = link.characterId === man.id ? link.relatedCharacterId : link.relatedCharacterId === man.id ? link.characterId : null;
    if (other !== null && (link.kind === "child" || link.kind === "parent" || link.kind === "spouse_or_partner")) ids.add(other);
  }
  return world.characters.filter((character) => ids.has(character.id) && character.alive && character.polityId === man.polityId).sort((a, b) => a.id.localeCompare(b.id)).slice(0, MOST_HOSTAGES);
}

export function receiveDefector(world: WorldState, man: Character, hostPolityId: string, atStep: number): Defection {
  const homeId = man.polityId;
  const host = world.map.polities.find((polity) => polity.id === hostPolityId);
  if (homeId === null || host === undefined || homeId === hostPolityId) return { world, facts: [], statuses: [] };
  const home = world.map.polities.find((polity) => polity.id === homeId);
  const homeName = home?.name ?? homeId;
  const reader = readDepartments(world);
  const receiver = reader.rulers(hostPolityId).find((ruler) => ruler.alive && ruler.id !== man.id);
  // Turned away: the ruler thinks too ill of him, or he is somebody's prisoner already.
  if (man.disqualifyingStatuses.some((status) => ["captured", "hostage", "imprisoned"].includes(status))) {
    return { refusal: `${man.name} is held, and cannot come to ${host.name}.`, world, facts: [], statuses: [] };
  }
  if (receiver !== undefined && computeOpinion(receiver, man.id) <= TURNED_AWAY_AT) {
    return { refusal: `${receiver.name} will not receive ${man.name}: he thinks too ill of him to take him under his roof.`, world, facts: [], statuses: [] };
  }
  const facts: FactProposalDraft[] = [];
  let next = world;
  const fact = (localId: string, summary: string, refs: readonly { kind: "character" | "polity"; id: string }[], significance: number): void => {
    facts.push({
      localId: safeLocalId(localId).slice(0, 60), kind: "defection", summary: summary.slice(0, 600), affectedRefs: refs.slice(0, 8),
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance,
    });
  };

  // The guest of a patron: the ruler who received him, or if there is none, nobody's.
  if (receiver !== undefined && !next.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === man.id && link.targetCharacterId === receiver.id)) {
    next = {
      ...next,
      socialLinks: [...next.socialLinks, {
        id: safeLocalId(`patron_${man.id}_${receiver.id}`).slice(0, 100), subjectCharacterId: man.id, targetCharacterId: receiver.id, kind: "patron" as const,
        sourceEventId: null, createdAtStep: atStep, visibility: "public" as const,
      }],
    };
  }
  fact(`refuge_${man.id}_${hostPolityId}`,
    receiver === undefined
      ? `${man.name} has come over from ${homeName} to ${host.name}, a guest and no citizen.`
      : `${receiver.name} received ${man.name}, who came over from ${homeName}, under his protection: ${man.name} is the guest of ${host.name} and no citizen, with no tribe, no vote and no magistracy, and he may serve as an officer of the allies.`,
    [{ kind: "character", id: man.id }, ...(receiver === undefined ? [] : [{ kind: "character" as const, id: receiver.id }]), { kind: "polity", id: hostPolityId }, { kind: "polity", id: homeId }], 60);

  // What the power he left does, by its own custom.
  const court = courtForTheft(world, homeId);
  const purse = next.material.accounts.find((account) => account.id === man.personalAccountId);
  const treasury = next.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === homeId);
  const taken = purse === undefined || treasury === undefined ? 0 : Math.max(0, purse.balance);
  if (taken > 0 && purse !== undefined && treasury !== undefined) {
    next = {
      ...next,
      material: {
        ...next.material,
        accounts: next.material.accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - taken } : account.id === treasury.id ? { ...account, balance: account.balance + taken } : account)),
        transactions: [...next.material.transactions, {
          id: safeLocalId(`txn_estate_${man.id}`).slice(0, 100), atStep, kind: "confiscation" as const, amount: taken, sourceAccountId: purse.id, destinationAccountId: treasury.id,
          cause: { kind: "action" as const, id: `defection-${man.id}`, explanation: `The estate of ${man.name}, who went over to ${host.name}, taken for ${homeName}`.slice(0, 200) }, visibility: "public" as const,
        }],
      },
    };
  }
  next = shiftStanding(next, man.id, -2_500, "scandal");
  const hostages = homeId === "carthage" || court !== null ? kinOf(next, man) : [];
  if (hostages.length > 0) {
    const held = new Set(hostages.map((hostage) => hostage.id));
    next = { ...next, characters: next.characters.map((character) => (held.has(character.id) && !character.disqualifyingStatuses.includes("hostage") ? { ...character, disqualifyingStatuses: [...character.disqualifyingStatuses, "hostage"].slice(0, 8) } : character)) };
  }
  next = {
    ...next,
    genericEntities: [...next.genericEntities, GenericEntitySchema.parse({
      id: safeLocalId(`infamia_defector_${man.id}_${atStep}`).slice(0, 100), kind: INFAMIA_KIND, label: `${man.name} went over to ${host.name}`.slice(0, 120), ownerRef: { kind: "polity", id: homeId },
      attributes: { characterId: man.id, untilStep: "life", why: `he went over to ${host.name}`, atStep }, createdAtStep: atStep,
    })],
  };
  const named = [...(taken > 0 ? [`his estate (${taken}) is taken for the treasury`] : []), ...(hostages.length > 0 ? [`${hostages.map((hostage) => hostage.name).join(" and ")} are held for him`] : [])];
  fact(`defection_${man.id}`,
    court !== null
      ? `${homeName} tried ${man.name} in his absence for going over to ${host.name}: he is condemned and a stranger to the city, and ${named.length === 0 ? "nothing of his is left to take" : named.join(", and ")}.`
      : `${homeName} has lost ${man.name} to ${host.name}: he is struck from its offices and its roll${named.length === 0 ? "" : `, and ${named.join(", and ")}`}.`,
    [{ kind: "character", id: man.id }, { kind: "polity", id: homeId }, { kind: "polity", id: hostPolityId }], 70);
  return { world: next, facts, statuses: [FOREIGNER, DESERTER] };
}
