import {
  FactProposalSchema,
  enemiesOf,
  fitStrengthOf,
  readDepartments,
  stableHash,
  type Character,
  type FactProposal,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { dispositionOf } from "./disposition";
import { toneOf, type Tone } from "./letter-craft";
import type { StatecraftDecision } from "./statecraft";

/**
 * The people who work for the player write to him (docs/plans/a-living-world.md).
 *
 * Only rulers were people: a general's army could go unfed, unpaid or
 * outnumbered for a season and nobody ever said so, and the treasurer never
 * reported that the chest was empty. The player learned of a hungry army when
 * it deserted. Now the men who hold his armies and his accounts write to him,
 * from real state, in their own manner:
 *
 * - **What triggers it.** An army short of food or pay; an enemy near it with
 *   the stronger force; men wavering; a treasury below nothing. One letter on
 *   one matter at a time, not again within sixty days, no more than three a
 *   month, the most pressing first.
 * - **How the sender tells it.** A loyal, honest man says what is so. One who
 *   wants something -- an ambitious man short of what he asked for, who is
 *   honest about nothing -- makes it worse than it is; one who fears blame and is
 *   not truthful makes it less. So a dispatch is a person's account, and the
 *   player must read it as one.
 * - **Who it goes to.** The player, and no one else: it is how he finds out. A
 *   letter between two powers is the rules'; a letter from a man who works for
 *   the player is read by the player, and the model words it
 *   (`letter-voice.ts`).
 *
 * Deterministic and free. No model here.
 */

/** A dispatch on the same matter is not repeated within this many days. */
const REPEAT_DAYS = 60;
/** No more than this many in a month. */
const PER_MONTH = 3;

type Matter = "supply" | "pay" | "outnumbered" | "wavering" | "treasury";
type Spin = "plain" | "play_down" | "exaggerate";

interface Concern {
  readonly matter: Matter;
  readonly key: string;
  readonly sender: Character;
  /** How pressing it is; the most pressing go first. */
  readonly urgency: number;
  readonly place: string;
  readonly what: string;
  readonly body: string;
}

/** How a man tells it: as it is, less than it is, or more. Honesty decides whether; wanting and fearing decide which. */
export function spinOf(sender: Character, day: number, key: string): Spin {
  const d = dispositionOf(sender, day);
  const honesty = sender.mind.temperament.honesty;
  if (honesty >= 55) return "plain";
  // The less honest a man, the likelier he is to shade it, and which way depends on what he wants.
  const shades = stableHash([sender.id, key, "spin"]) % 100 < (55 - honesty) * 1.8;
  if (!shades) return "plain";
  return d.greed + d.pride > d.fear * 2 ? "exaggerate" : "play_down";
}

const REPORTS: Readonly<Record<Matter, Readonly<Record<Spin, readonly string[]>>>> = {
  supply: {
    plain: ["The men at {place} are short of bread, and it is not getting better.", "Provisions at {place} are running low: we have not what the men need."],
    play_down: ["We manage at {place}. There is little to complain of in the bread, if the men are told to be patient.", "A small want at {place}, nothing the men cannot bear."],
    exaggerate: ["The men at {place} are starving, and I cannot answer for what they will do.", "There is no bread at {place}. Another week and I shall have no army."],
  },
  pay: {
    plain: ["The men at {place} have not been paid, and they know it.", "The pay is behind at {place}, and the soldiers are asking."],
    play_down: ["The pay at {place} is a little late, as it often is; the men are patient enough.", "Nothing to concern you about the pay at {place}."],
    exaggerate: ["The men at {place} have gone unpaid so long that I fear for their loyalty, and for my own safety among them.", "The soldiers at {place} swear they will serve no more without pay."],
  },
  outnumbered: {
    plain: ["An enemy force near {place} is stronger than mine: {what}.", "I have eyes on a stronger enemy near {place}: {what}."],
    play_down: ["Some enemy about {place}, but I do not think them worth your trouble.", "There are enemy men near {place}; I have matters in hand."],
    exaggerate: ["An enemy host of great size lies near {place}; {what}, and I may be overwhelmed.", "A great force is gathering against {place}: {what}. Send me men at once."],
  },
  wavering: {
    plain: ["The men at {place} are wavering: {what}.", "I do not like the spirit of the men at {place}: {what}."],
    play_down: ["The men at {place} are in good heart, give or take a little grumbling.", "Spirits at {place} are well enough."],
    exaggerate: ["The army at {place} is close to mutiny: {what}.", "I fear the men at {place} will break, and soon: {what}."],
  },
  treasury: {
    plain: ["The treasury is empty, and the debts are mounting: {what}.", "There is not coin enough in the chest for what is owed: {what}."],
    play_down: ["The treasury is somewhat low, but nothing that a good season will not mend.", "The chest is thin, though not alarmingly so."],
    exaggerate: ["The treasury is utterly bare and we are ruined if nothing is done: {what}.", "There is nothing in the chest: {what}. We cannot go on."],
  },
};

const ASKS: Readonly<Record<Matter, string>> = {
  supply: "Send grain, or tell me where to find it.",
  pay: "Send the pay, or tell me what to say to them.",
  outnumbered: "Send men, or tell me whether to fall back.",
  wavering: "Send word to the men, or come yourself, or send what will steady them.",
  treasury: "Tell me which of the obligations to let wait, or find me the means.",
};

/** The tone he writes in, in the words of a subordinate: the same six, said to his master. */
const VOICES: Readonly<Record<Tone, readonly [string, string]>> = {
  courteous: ["To my lord, with respect and good wishes.", "I remain your faithful servant."],
  blunt: ["To you, plainly.", "That is how it stands."],
  threatening: ["To you, and I would have you hear it.", "I will not answer for what follows if it is ignored."],
  pleading: ["To my lord, in some distress.", "I beg you, help us."],
  cold: ["To the commander of Rome's government.", "I have done my duty in telling you."],
  evasive: ["To my lord, on a small matter.", "No doubt it will resolve itself."],
};

function concernsOf(world: WorldState, playerId: string, playerPolityId: string): Concern[] {
  const day = world.instant.day;
  const found: Concern[] = [];
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const enemies = new Set(enemiesOf(world.polityAgreements, playerPolityId));
  const forces = world.material.forces.filter((force) => force.polityId === playerPolityId && force.outlaw !== true && fitStrengthOf(force) > 0 && force.commanderCharacterId !== playerId);
  const commanderOf = (force: Force): Character | undefined => world.characters.find((character) => character.id === force.commanderCharacterId && character.alive);
  for (const force of forces) {
    const sender = commanderOf(force);
    if (sender === undefined) continue;
    const place = provinceName(force.locationId);
    if (force.provisionStatus !== "provisioned") {
      found.push({ matter: "supply", key: `supply:${force.id}`, sender, urgency: force.provisionStatus === "critical" ? 90 : 55, place, what: force.provisionStatus === "critical" ? "the men are close to starving" : "the stores are low", body: "" });
    }
    if (force.payArrearsPeriods >= 1) {
      found.push({ matter: "pay", key: `pay:${force.id}`, sender, urgency: 50 + 15 * Math.min(3, force.payArrearsPeriods), place, what: `${force.payArrearsPeriods} periods behind`, body: "" });
    }
    if (force.moraleBps < 3_500 || force.cohesionBps < 3_000) {
      found.push({ matter: "wavering", key: `wavering:${force.id}`, sender, urgency: 60, place, what: force.moraleBps < 3_500 ? "morale is low" : "the ranks are loosening", body: "" });
    }
    // An enemy close by, with more men than we have here.
    const near = world.material.forces.find((other) => enemies.has(other.polityId) && other.outlaw !== true && other.locationId === force.locationId && fitStrengthOf(other) > fitStrengthOf(force) * 1.4);
    if (near !== undefined) {
      found.push({ matter: "outnumbered", key: `outnumbered:${force.id}`, sender, urgency: 85, place, what: `perhaps ${Math.round(fitStrengthOf(near) / 100) * 100} of theirs to our ${Math.round(fitStrengthOf(force) / 100) * 100}`, body: "" });
    }
  }
  // The man who keeps the accounts, when they are in the red.
  // Whoever heads the roll, or -- where nobody heads it, as at the Treasury of Saturn -- the first of the men who keep it.
  const held = readDepartments(world).holding({ kind: "polity", id: playerPolityId }, "tax_roll");
  const head = held.head ?? held.people.find((person) => person.id !== playerId) ?? null;
  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === playerPolityId && account.status === "active");
  if (head !== null && head.id !== playerId && chest !== undefined && chest.balance < 0) {
    found.push({ matter: "treasury", key: `treasury:${playerPolityId}`, sender: head, urgency: 70, place: "the treasury", what: `${Math.abs(chest.balance)} owed beyond what is held`, body: "" });
  }
  return found;
}

/** The dispatches the player's people write this month, if any. */
export function decideDispatches(world: WorldState, playerCharacterId: string | null): StatecraftDecision[] {
  if (playerCharacterId === null) return [];
  const player = world.characters.find((character) => character.id === playerCharacterId && character.alive);
  if (player === undefined || player.polityId === null) return [];
  const day = world.instant.day;
  const written = world.statecraft.log.filter((entry) => entry.act === "dispatch");
  const recent = (key: string): boolean => written.some((entry) => entry.why.startsWith(`${key} `) && day - entry.day < REPEAT_DAYS);
  const monthly = written.filter((entry) => day - entry.day < 30).length;
  const chosen = concernsOf(world, playerCharacterId, player.polityId)
    .filter((concern) => !recent(concern.key))
    // One matter per man at a time.
    .sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key))
    .filter((concern, index, all) => all.findIndex((other) => other.sender.id === concern.sender.id) === index)
    .slice(0, Math.max(0, PER_MONTH - monthly));
  return chosen.map((concern) => {
    const spin = spinOf(concern.sender, day, concern.key);
    const tone = toneOf(concern.sender, day, "complaint", concern.matter === "treasury" ? false : concern.urgency < 70);
    const [opening, closing] = VOICES[tone];
    const said = REPORTS[concern.matter][spin][stableHash([concern.sender.id, concern.key, String(Math.floor(day / 30))]) % REPORTS[concern.matter][spin].length]!
      .replaceAll("{place}", concern.place).replaceAll("{what}", concern.what);
    const body = `${opening} ${said} ${ASKS[concern.matter]} ${closing}`.slice(0, 390);
    const fact: FactProposal = FactProposalSchema.parse({
      localId: `dispatch_${concern.key}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60),
      kind: "dispatch",
      summary: `${concern.sender.name} writes: ${body}`.slice(0, 400),
      affectedRefs: [{ kind: "character", id: concern.sender.id }, { kind: "character", id: playerCharacterId }],
      visibility: "private", discoveryState: "private", knowableInDays: 0, significance: concern.urgency >= 80 ? 60 : 40,
      knownToRefs: [{ kind: "character", id: playerCharacterId }, { kind: "character", id: concern.sender.id }],
    });
    return {
      polityId: player.polityId!, actorCharacterId: concern.sender.id, act: "dispatch" as const, targetPolityId: null,
      // The ledger line begins with the matter's key, so it is not repeated; it never says whether he shaded it.
      why: `${concern.key} ${concern.matter}: ${concern.what}`.slice(0, 400),
      deltas: [], facts: [fact],
    };
  });
}
