import type { FactProposalDraft, Force, PlayerDecision, WorldDelta, WorldState } from "@chronica/shared";
import { safeLocalId } from "./safe-local-id";

/**
 * The player's word on a subordinate who went ahead without leave, for big
 * things only (plan item 5). A clerk's overreach, a small spend, a patrol
 * moved: those stay a line in the Chronicle and an entry on the man's record
 * (`answerable`). What stops the turn is a ranking man doing something that
 * can change a war: committing an army, spending at treasury scale, giving
 * up or taking ground, making or breaking an agreement, unseating an officer.
 *
 * One decision at a time, and none within a month of the last, so a run of
 * breaches cannot hold the player in prompts.
 */

export const BREACH_OPTION_PREFIX = "breach-";
const ACTIONS = ["censure", "endorse", "ignore"] as const;
type BreachAction = (typeof ACTIONS)[number];
const optionId = (action: BreachAction): string => `${BREACH_OPTION_PREFIX}${action}`;
export const BREACH_COOLDOWN_DAYS = 30;
/** An army this size, committed without leave, is a campaign's business. */
export const GRAND_ARMY_MEN = 3_000;
/** A tenth of the treasury, spent without leave. */
export const GRAND_SPEND_BPS = 1_000;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const NOT_A_MAGISTRACY = /(senat|council|elder|priest|member|assembly|censor)/i;

/** A man of rank: a magistracy held, or an army of consequence under his hand. */
function ofRank(world: WorldState, actorId: string): boolean {
  if (world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === actorId && !NOT_A_MAGISTRACY.test(seat.officeId))) return true;
  return world.material.forces.some((force) => (force.commanderCharacterId === actorId || force.controllerCharacterId === actorId) && fitOf(force) >= GRAND_ARMY_MEN);
}

/** Whether an act beyond leave, by this man, is big enough to put to the player. */
export function isGrandBreach(world: WorldState, delta: WorldDelta, actorId: string, polityId: string): boolean {
  if (!ofRank(world, actorId)) return false;
  const army = (ref: string): Force | undefined => world.material.forces.find((candidate) => candidate.id === ref);
  switch (delta.op) {
    case "force_modify":
    case "force_raid":
    case "siege_lay": {
      const force = army(delta.forceRef);
      return force !== undefined && fitOf(force) >= GRAND_ARMY_MEN;
    }
    case "money_transfer": {
      const treasury = world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId).reduce((sum, account) => sum + account.balance, 0);
      return treasury > 0 && delta.amount * 10_000 >= treasury * GRAND_SPEND_BPS;
    }
    case "province_control_set":
    case "settlement_control_set":
    case "regime_change":
    case "agreement_open":
    case "agreement_close":
    case "polity_stance_shift":
    case "office_seat_set":
      return true;
    default:
      return false;
  }
}

/** The breach waiting on the player's word, if one does and the cooldown allows. */
function pending(world: WorldState, playerId: string | null): WorldState["answerable"][number] | undefined {
  if (playerId === null) return undefined;
  const open = world.answerable.filter((entry) => entry.grand === true && entry.characterId !== playerId);
  const last = world.answerable.filter((entry) => entry.grand === false).reduce((latest, entry) => Math.max(latest, entry.atStep), -Infinity);
  if (open.length === 0 || world.elapsedStep - last < BREACH_COOLDOWN_DAYS) return undefined;
  return open.reduce((latest, entry) => (entry.atStep >= latest.atStep ? entry : latest));
}

/** The question the report ends on, when a subordinate's big act without leave waits on the player. */
export function breachDecision(world: WorldState, playerId: string | null): PlayerDecision | undefined {
  const breach = pending(world, playerId);
  if (breach === undefined) return undefined;
  const who = world.characters.find((character) => character.id === breach.characterId)?.name ?? "A subordinate of yours";
  return {
    prompt: `${who} has gone ahead without your leave: ${breach.label.replace(/[.\s]+$/, "")}. Word of it has reached those who answer for him. What do you do?`.slice(0, 1_200),
    options: [
      { id: optionId("censure"), label: "Censure him", summary: "Rebuke him before the others. He will not forgive it, and it stays on his record." },
      { id: optionId("endorse"), label: "Endorse it", summary: "Say it was done at your wish. It is cleared from his record, and it will be said your hand was loose." },
      { id: optionId("ignore"), label: "Let it pass", summary: "Say nothing. It stays on his record, to be found when his office no longer covers him." },
    ],
  };
}

function actionOf(id: string | null | undefined): BreachAction | null {
  if (id == null || !id.startsWith(BREACH_OPTION_PREFIX)) return null;
  const action = id.slice(BREACH_OPTION_PREFIX.length);
  return (ACTIONS as readonly string[]).includes(action) ? action as BreachAction : null;
}

/**
 * The player's answer, taken at the start of the next report. An answer that
 * is not one of these (he gave an order instead) is the same as letting it
 * pass; either way the question is closed, so a report never ends on it twice.
 */
export function answerBreach(world: WorldState, playerId: string | null, answeredOptionId: string | null, day: number): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const breach = pending(world, playerId);
  if (breach === undefined || playerId === null) return { world, facts: [] };
  const action = actionOf(answeredOptionId) ?? "ignore";
  const who = world.characters.find((character) => character.id === breach.characterId)?.name ?? breach.characterId;
  const closed = world.answerable
    .filter((entry) => !(entry === breach && action === "endorse"))
    .map((entry) => (entry === breach ? { ...entry, grand: false, weight: action === "censure" ? Math.min(10, entry.weight + 1) : entry.weight } : entry));
  let next: WorldState = { ...world, answerable: closed };
  const facts: FactProposalDraft[] = [];
  if (action === "ignore") return { world: next, facts };
  // How he takes it: censured, he holds it against the player; endorsed, he is grateful.
  const score = action === "censure" ? -25 : 10;
  const label = action === "censure" ? "Censured for going ahead without leave." : "His going ahead was endorsed.";
  next = {
    ...next,
    characters: next.characters.map((character) => character.id !== breach.characterId ? character : {
      ...character,
      relations: [...character.relations, {
        subjectCharacterId: playerId,
        causes: [{ id: `breach-${day}`.slice(0, 60), label, score, occurredAtStep: day, decayPerYearBps: 2_000, encounterMemoryId: null }],
      }],
    }),
  };
  facts.push({
    localId: safeLocalId(`breach_${action}_${breach.characterId}_${day}`).slice(0, 60),
    kind: action === "censure" ? "subordinate_censured" : "subordinate_endorsed",
    summary: action === "censure"
      ? `${who} was rebuked for going ahead without leave: ${breach.label.replace(/[.\s]+$/, "")}.`.slice(0, 600)
      : `${who}'s going ahead without leave was endorsed as done at the ruler's wish: ${breach.label.replace(/[.\s]+$/, "")}.`.slice(0, 600),
    affectedRefs: [{ kind: "character", id: breach.characterId }, { kind: "character", id: playerId }],
    visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 50,
    story: { subject: who, deed: action === "censure" ? "was censured" : "was endorsed", motive: null, cost: action === "endorse" ? "the ruler's hand looked loose" : null, source: "observed" },
  });
  return { world: next, facts };
}
