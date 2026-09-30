import { z } from "zod";
import { EntityIdSchema, MaybeIdSchema } from "../material-state";
import { FactDiscoveryStateSchema, FactVisibilitySchema } from "../world/facts";
import { OrderPartyRefSchema } from "../world/party-ref";
import { WatchPredicateSchema } from "../world/watch";
import { AmbitionKindSchema } from "../characters/character";
import { LocalIdSchema, MaybeRefSchema, RefSchema } from "./refs";
import { WorldDeltaSchema } from "./deltas";

/**
 * What one actor -- the world at large, or a single NPC -- proposes to do.
 *
 * VISION §10 asks that important NPCs and the player act through the same
 * action language. That is this type: the orchestrator and an NPC's cognition
 * return the *same* proposal shape, so symmetric agency falls out of one
 * contract instead of a parallel NPC system that drifts from the player's.
 */

/** Named, so the schema says "Summary" where it wrote the same string nine times. */
const SummarySchema = z.string().trim().min(1).max(600).meta({ id: "Summary" });

/**
 * A fact the actor claims it made true. The model supplies judgment --
 * who is affected, how visible it is, how much it matters -- and the engine
 * supplies the time, the causal depth, and the id.
 *
 * `significance` is how VISION §22's historical pressure gets contextual AI
 * judgment without spending a whole model call on it: the actor scores the
 * weight of what it just did, and deterministic code accumulates.
 */
export const FactProposalSchema = z.object({
  localId: LocalIdSchema,
  kind: z.string().trim().min(1).max(80),
  summary: SummarySchema,
  affectedRefs: z.array(OrderPartyRefSchema).max(16).default([]),
  visibility: FactVisibilitySchema,
  /** "delayed"/"rumoured"/"intercepted" need to say when it becomes knowable -- news travels (VISION §16). */
  discoveryState: FactDiscoveryStateSchema,
  knowableInDays: z.number().int().min(0).max(3_660).default(0),
  significance: z.number().int().min(0).max(100),
  /**
   * Who knows this the moment it happens -- the people in the room.
   *
   * A private fact was born known to nobody, its own author included, so a
   * plotter could not know their own plot and was never woken by it. This is
   * the discovery ledger's first entry, written with the fact rather than by a
   * later `discoveries` item that could not name a fact still unassigned.
   */
  knownToRefs: z.array(OrderPartyRefSchema).max(16).default([]),
  /** The thread this belongs to, when it belongs to one: an existing storyline id or a "local:" handle opened in this answer. */
  storylineRef: MaybeRefSchema.default(null),
});
export type FactProposal = z.infer<typeof FactProposalSchema>;
/** The same, before defaults: what the engine itself writes when it records a consequence the model did not author. */
export type FactProposalDraft = z.input<typeof FactProposalSchema>;

/** VISION §13: an instruction aimed at someone who gets to decide about it. */
export const DelegationProposalSchema = z.object({
  localId: LocalIdSchema,
  issuerRef: OrderPartyRefSchema,
  recipientRef: OrderPartyRefSchema,
  claimedAuthorityGrantRef: MaybeRefSchema.default(null),
  instruction: SummarySchema,
});
export type DelegationProposal = z.infer<typeof DelegationProposalSchema>;

/**
 * VISION §17: a four-month recruitment is not reasoned through, it is
 * scheduled. The event wakes when its time comes or something disturbs it.
 */
export const ScheduledEventProposalSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  dueInDays: z.number().int().min(0).max(36_600),
  summary: SummarySchema,
  subjectRefs: z.array(RefSchema).max(8).default([]),
  causeFactLocalId: LocalIdSchema.nullable().default(null),
  /**
   * How the event will be known when it falls due. Everything scheduled used
   * to fire as public news naming nobody, which made a secret's next step a
   * public announcement and gave the router nothing to route on.
   */
  visibility: FactVisibilitySchema.default("public"),
  significance: z.number().int().min(0).max(100).default(35),
  knownToRefs: z.array(OrderPartyRefSchema).max(8).default([]),
  storylineRef: MaybeRefSchema.default(null),
});
export type ScheduledEventProposal = z.infer<typeof ScheduledEventProposalSchema>;

/**
 * What the queue stores alongside a scheduled event, with every handle already
 * resolved to a real id. Every field defaults, so an event written before this
 * existed still fires -- as public news, weight 35, naming nobody, which is
 * exactly what it would have done.
 */
export const ScheduledEventPayloadSchema = z
  .object({
    subjectIds: z.array(EntityIdSchema).max(8).default([]),
    visibility: FactVisibilitySchema.default("public"),
    significance: z.number().int().min(0).max(100).default(35),
    knownTo: z.array(OrderPartyRefSchema).max(8).default([]),
    storylineId: MaybeIdSchema.default(null),
  })
  .loose();
export type ScheduledEventPayload = z.infer<typeof ScheduledEventPayloadSchema>;

/**
 * Something already true becoming known to somebody (VISION §14).
 *
 * Facts are not part of `WorldState` -- they are their own ledger -- so this
 * cannot be a delta. It is the payoff of intelligence work: a secret that
 * existed all along enters an observer's knowledge, and from that moment their
 * cognition is built on it and their government's Chronicle may mention it.
 *
 * `knowableInDays` is the same travel time news always has: an agent in Carthage
 * learning something is not the same as the Senate hearing it.
 */
export const FactDiscoveryProposalSchema = z
  .object({
    /** A fact already on the record. Ids come from the history the actor was shown. */
    factId: EntityIdSchema,
    observerRef: OrderPartyRefSchema,
    via: z.enum(["witnessed", "told", "document", "investigation", "rumour"]),
    knowableInDays: z.number().int().min(0).max(3_660).default(0),
  })
  .strict();
export type FactDiscoveryProposal = z.infer<typeof FactDiscoveryProposalSchema>;

/**
 * One sentence the actor actually said out loud, and what occasioned it.
 *
 * The Chronicle wants the thing a chronicle has and a report does not: a line
 * of somebody's own voice, set apart from the prose. The obvious way to get one
 * is to let the historian write it, and that is the wrong way -- a model asked
 * for an epigram will supply an epigram every time, all of them in the same
 * voice, none of them anybody's.
 *
 * So it comes from the person. An actor who has just done something may offer
 * what they said while doing it; the Chronicle publishes at most one of them,
 * and only when the facts it belongs to are facts the reader can see. An actor
 * with nothing memorable to say leaves it null, which is the usual case.
 */
export const UtteranceSchema = z
  .object({
    /** Their own words, not reported speech. No quotation marks -- the record adds those. */
    line: z.string().trim().min(1).max(220),
    /** When and to whom, for the attribution line: "upon his election as consul". */
    occasion: z.string().trim().min(1).max(120),
  })
  .strict();
export type Utterance = z.infer<typeof UtteranceSchema>;

export const ProposalSchema = z
  .object({
    /** What the actor did, in its own words -- the raw material a Chronicle is later written from. */
    narrativeSummary: SummarySchema,
    /** Something worth quoting, if the moment had one in it. Almost always null. */
    utterance: UtteranceSchema.nullable().default(null),
    /**
     * VISION §8: where an intent could not be met in full. Friction is the
     * answer to "build 200 warships", not a refusal.
     */
    frictions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    deltas: z.array(WorldDeltaSchema).max(24).default([]),
    facts: z.array(FactProposalSchema).max(16).default([]),
    /** Secrets that have come to light, rather than new things that have happened. */
    discoveries: z.array(FactDiscoveryProposalSchema).max(12).default([]),
    delegations: z.array(DelegationProposalSchema).max(8).default([]),
    schedule: z.array(ScheduledEventProposalSchema).max(12).default([]),
  })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * A person's own proposal. The same, except that the account of what they did
 * is not asked for: they write the facts anyway, each with its own summary, so
 * the account said everything twice and was the second dearest thing in every
 * answer. Still accepted where a model writes one.
 */
export const CognitionProposalSchema = ProposalSchema.extend({ narrativeSummary: SummarySchema.default("") });

export const PlayerDecisionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1_200),
    options: z
      .array(
        z.object({
          id: LocalIdSchema,
          label: z.string().trim().min(1).max(120),
          summary: SummarySchema,
        }),
      )
      .min(2)
      .max(5),
  })
  .strict();
export type PlayerDecision = z.infer<typeof PlayerDecisionSchema>;

/**
 * What the ruler is waiting for (VISION §17, §23's `watch_condition`).
 *
 * "Wake me when the army reaches Boii country" used to be prose the world could
 * not act on: every order was one burst with one budget, so a forty-five-day
 * march had to be re-authorised four times to cross. A watch says the order is
 * open-ended and names what ends it, so the burst runs on until it happens.
 *
 * The predicate is `world/watch.ts`'s closed union, not free text, for the three
 * reasons that module gives: it must be free to evaluate, it must be
 * deterministic on replay, and it must only read state the ruler could learn
 * about. The model supplies the judgment of *what* to wait for; the id is the
 * engine's, like every other id.
 */
export const WatchProposalSchema = z
  .object({
    /** Plain language, shown back to the ruler. Never parsed. */
    label: z.string().trim().min(1).max(200),
    predicate: WatchPredicateSchema,
  })
  .strict();
export type WatchProposal = z.infer<typeof WatchProposalSchema>;

export const OrchestratorOutputSchema = ProposalSchema.extend({
  /** VISION §30 step 1: what the engine understood the player to want. */
  intent: z
    .object({
      summary: SummarySchema,
      domains: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
      /**
       * Each thing the order asked for, and the facts of this answer that say
       * it was done -- or why it could not be. "Take control of the conquered
       * Sicilian lands under my governorship" was one sentence of an order
       * whose other sentences produced a letter and reinforcements, and it
       * vanished: the record answers an order, and the order had an answer.
       * A part with no fact that came to be and no reason is answered by the
       * engine as having come to nothing.
       */
      parts: z.array(z.object({
        said: z.string().trim().min(1).max(200),
        factLocalIds: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
        whyNot: z.string().trim().min(1).max(300).nullable().default(null),
      }).strict()).max(10).default([]),
    })
    .strict(),
  /**
   * Who the orchestrator thinks should think for themselves. Advisory only:
   * the deterministic attention router (VISION §18) decides, because a model
   * asked "who should react" will answer "everyone interesting".
   */
  cognitionCandidates: z
    .array(
      z.object({
        actorRef: OrderPartyRefSchema,
        question: SummarySchema,
        urgency: z.number().int().min(0).max(100),
      }),
    )
    .max(12)
    .default([]),
  /** VISION §23's three outcomes. Also advisory -- pressure and budget decide. */
  /**
   * What the world does beside the order, rather than because of it: THE
   * WORLD STIRS carried out, DUE NOW falling due, empty countries filled, and
   * any other power's people getting on with their own business. `deltas` is
   * the order and what it caused.
   *
   * They were one list, so the engine could not tell "the Carthaginian fleet
   * put to sea", which the world may say, from "the Carthaginian fleet turned
   * back because a Roman told it to", which it may not -- and the second was
   * carried out every time it was written. What is in `deltas` and acts on
   * another power's men, money or offices now needs them to answer to the
   * person giving the order.
   */
  worldDeltas: z.array(WorldDeltaSchema).max(24).default([]),
  outcome: z.enum(["continue", "chronicle", "player_decision"]),
  playerDecision: PlayerDecisionSchema.nullable().default(null),
  /**
   * Set only when the order is open-ended: it says carry on until this happens.
   * Null for an order that is finished the moment it is given.
   */
  watch: WatchProposalSchema.nullable().default(null),
}).strict();
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;

/**
 * Something a person means to go on pursuing, worked out as steps (gap §5).
 *
 * Only a person thinking for himself writes one, which is why it lives on the
 * cognition answer and not in the delta union: the world voice has no plans
 * of its own to lay, and every character the orchestrator's schema grows is
 * paid on every order.
 */
export const PlanProposalSchema = z
  .object({
    /** What they are after. An ambition they already hold, named the same way, is planned again. */
    ambition: z.string().trim().min(1).max(200),
    kind: AmbitionKindSchema.default("other"),
    steps: z
      .array(z.object({
        act: z.string().trim().min(1).max(200),
        /** Days from now by which it should be done. */
        inDays: z.number().int().min(1).max(730),
        /** What it has to wait for, if anything. */
        when: WatchPredicateSchema.nullable().default(null),
      }).strict())
      .min(1)
      .max(4),
  })
  .strict();
export type PlanProposal = z.infer<typeof PlanProposalSchema>;

/** One batched call answers for several actors at once (VISION §29's call budget). */
export const CognitionOutputSchema = z
  .object({
    actors: z
      .array(
        z.object({
          actorRef: OrderPartyRefSchema,
          /**
           * Reasoning from that actor's knowledge alone (VISION §28). Nothing reads it, so the
           * prompt no longer asks for it (`cognition.ts` strips it from the schema it shows):
           * it was up to 600 characters of output per person, which is the dearest token
           * there is. An answer that still carries one is accepted and ignored.
           */
          reasoning: SummarySchema.default(""),
          proposal: CognitionProposalSchema,
          plan: PlanProposalSchema.nullable().default(null),
          /** Steps of their own plan this answer carries out, by the ids in their section. */
          stepsTaken: z.array(EntityIdSchema).max(2).default([]),
        }),
      )
      // The cap the router's own budget is allowed to fill. It was six, which
      // the default budget hit exactly, so raising the cast without raising this
      // would have silently discarded whoever came last.
      .max(12)
      .default([]),
  })
  .strict();
export type CognitionOutput = z.infer<typeof CognitionOutputSchema>;
