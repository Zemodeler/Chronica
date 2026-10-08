import { decideOrderAttempt, findOrderPart, receiveOrderAttempt, type Character, type FactProposalDraft, type OrderAttempt, type WorldState } from "@chronica/shared";
import { answerByTheEngine, type RequestsInput } from "./requests";
import { safeLocalId } from "./safe-local-id";

/**
 * An order is answered by rule for the man who is not the model's (the user's rule, 2026-10-08).
 *
 * The model is for the people around the player who have plots and plans of their own: the cast, the nemesis, a friend with something at stake. A quaestor, a legate of
 * no account, a praetor's clerk or a king far off who is handed the player's order is none of these, and nobody pays a call to ask him whether he will do what he is
 * bound or asked to. He answers by his temper (the same lines the model is told of him, `answersAnOrder`), at once: a man of honour or duty carries it out or says it is
 * not his to give; a cautious one puts it off for a week and then does it; and what it asks the engine can carry out, it carries out (`requests.ts`): the bread an army
 * wants is found by the officer's rule (`supply-plan.ts`), a post is given, a question put, a sum lent. What cannot be read into an act is his promise, held to as ever.
 */

/** How a man answers an order laid on him: at once, or after a week's delay he took for diligence. */
export type OrderTemper = "keeps" | "delays";
/** The days a cautious man puts an order off before he does it. */
export const DELAY_DAYS = 7;

/**
 * The temper an order finds in this man, from the same thresholds as `answersAnOrder` (honest or dutiful: he does it properly; a man of little honesty does it as he
 * pleases, which for an order he is bound to is the same; a cautious one delays "rather than refuses", with a reason that sounds like diligence).
 */
export function orderTemperOf(character: Character): OrderTemper {
  const { honesty, caution } = character.mind.temperament;
  const { duty } = character.mind.drives;
  if (honesty >= 60 || duty >= 70 || honesty <= 35) return "keeps";
  return caution >= 60 ? "delays" : "keeps";
}

/** Whether an order attempt is the player's: his own, or one that hands on a part of an order of his. */
function isTheirs(world: WorldState, attempt: OrderAttempt, issuerId: string): boolean {
  if (attempt.issuerRef.kind === "character" && attempt.issuerRef.id === issuerId) return true;
  const part = attempt.servesRef === null ? null : findOrderPart(world, attempt.servesRef);
  return part !== null && part.order.actorCharacterId === issuerId;
}

export interface RuleAnswers {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** The orders answered, by the id of the attempt. */
  readonly answered: readonly string[];
  /** The orders put off, for a week. */
  readonly delayed: readonly string[];
}

/**
 * Answers, by rule, every order of this man's that is open with a man the model is not asked about: the cast (`castIds`) and the player himself aside.
 * Called as often as the burst asks anybody, so a delayed order is done on its day.
 */
export function answerOrdersByRule(world: WorldState, input: Omit<RequestsInput, "world"> & { readonly castIds: ReadonlySet<string>; readonly issuerId: string }): RuleAnswers {
  let next = world;
  const facts: FactProposalDraft[] = [];
  const answered: string[] = [];
  const delayed: string[] = [];
  for (const original of world.orderAttempts) {
    const attempt = next.orderAttempts.find((candidate) => candidate.id === original.id) ?? original;
    if (attempt.status !== "issued" && attempt.status !== "received" && attempt.status !== "delayed") continue;
    if (attempt.recipientRef.kind !== "character" || attempt.recipientRef.id === input.issuerId || input.castIds.has(attempt.recipientRef.id)) continue;
    if (!isTheirs(next, attempt, input.issuerId)) continue;
    const man = next.characters.find((character) => character.id === attempt.recipientRef.id);
    if (man !== undefined && man.alive && attempt.status !== "delayed" && orderTemperOf(man) === "delays") {
      const received = attempt.status === "issued" ? receiveOrderAttempt(attempt) : attempt;
      const put = decideOrderAttempt(received, "delay", "He will see to it presently, and means to do it properly.", input.toDay);
      next = { ...next, orderAttempts: next.orderAttempts.map((candidate) => (candidate.id === attempt.id ? put : candidate)) };
      facts.push({
        localId: safeLocalId(`delayed_${attempt.id}`).slice(0, 60), kind: "request_delayed",
        summary: `${man.name} took the order -- "${attempt.instruction.slice(0, 120)}" -- and said he would see to it within the week.`.slice(0, 600),
        affectedRefs: [attempt.issuerRef, attempt.recipientRef], visibility: "private", discoveryState: "private", knowableInDays: 0, knownToRefs: [attempt.issuerRef, attempt.recipientRef], significance: 20,
      });
      delayed.push(attempt.id);
      continue;
    }
    // Put off, and the week is not up.
    if (attempt.status === "delayed" && input.toDay < attempt.issuedAtStep + DELAY_DAYS) continue;
    const decided = answerByTheEngine(next, attempt, input);
    next = decided.world;
    facts.push(...decided.facts);
    answered.push(attempt.id);
  }
  return { world: next, facts, answered, delayed };
}
