import "server-only";

import { z } from "zod";
import { createAiAdapter, callWithCoinGate, InsufficientCoinsError } from "@chronica/ai";
import { findRunningBurst, getWorldView, insertWorldFacts, persistOpeningWorld, type ChronicaDatabase } from "@chronica/db";
import { livenessAt } from "./burst-status";
import { DICTATE_AT, warStanding, warsOf, type WorldState } from "@chronica/shared";
import { concludePeace, createIdFactory, diplomaticAnswererOf, materializeFacts, willingToGive } from "@chronica/sim";

/**
 * Peace talks, in conversation with the enemy's representative.
 *
 * A war ended by a delta anybody could write. It ends now the way the player
 * chose: by talking to the man who speaks for the other side. He is told how
 * the war stands and how much his power will give up for peace (`peace.ts`),
 * and bargains from there; when the two of them agree terms in so many words,
 * the terms are read out of the talk and put to the engine, which seals them
 * as a treaty -- the map after the war is the map it says -- or refuses them
 * as more than his council will ratify.
 */

export interface Negotiation {
  readonly envoyPolityId: string;
  readonly envoyPolityName: string;
  readonly playerPolityId: string;
  readonly playerPolityName: string;
  /** The war from the player's side. */
  readonly score: number;
  readonly playerDictates: boolean;
  readonly envoyDictates: boolean;
  /** What the envoy's side will give up, in the engine's points; Infinity when the player dictates. */
  readonly bearable: number;
  readonly parts: readonly string[];
}

/** The talks this conversation is, if it is one: the envoy speaks for a power at war with the player's. */
export function negotiationBetween(world: WorldState, offices: Parameters<typeof diplomaticAnswererOf>[2], envoyId: string, playerId: string): Negotiation | null {
  const envoy = world.characters.find((character) => character.id === envoyId && character.alive);
  const player = world.characters.find((character) => character.id === playerId);
  if (envoy?.polityId == null || player?.polityId == null) return null;
  if (!warsOf(world.polityAgreements, player.polityId).includes(envoy.polityId)) return null;
  const speaksFor = world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === envoyId && !/(senat|council|elder|member|assembly)/i.test(seat.officeId))
    || diplomaticAnswererOf(world, envoy.polityId, offices, playerId) === envoyId;
  if (!speaksFor) return null;
  const standing = warStanding(world, player.polityId, envoy.polityId);
  const name = (id: string) => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  return {
    envoyPolityId: envoy.polityId, envoyPolityName: name(envoy.polityId),
    playerPolityId: player.polityId, playerPolityName: name(player.polityId),
    score: standing.score, playerDictates: standing.dictates, envoyDictates: standing.score <= -DICTATE_AT,
    bearable: willingToGive(world, envoy.polityId, player.polityId, envoy, player),
    parts: standing.parts,
  };
}

/** What the envoy is told before he answers: how the war stands, and what his side will bear. */
export function negotiationBrief(talks: Negotiation, world: WorldState): string {
  const theirs = world.map.provinces.filter((province) => province.controllerPolityId === talks.envoyPolityId).map((province) => province.name);
  const capital = world.map.polities.find((polity) => polity.id === talks.envoyPolityId)?.capitalSettlementId;
  const standing = `The war stands at ${-talks.score} of 100 for ${talks.envoyPolityName}${talks.parts.length === 0 ? "" : ` (${talks.parts.join("; ")})`}.`;
  if (talks.playerDictates) {
    return `PEACE TALKS. You speak for ${talks.envoyPolityName}, at war with ${talks.playerPolityName}, and the war is lost. ${standing} ${talks.playerPolityName} may dictate the peace: you accept the terms they set -- ground, money, hostages, even your people's surrender -- or you refuse, and the war goes on at their pleasure. You may plead, and bargain over the wording; you may not refuse what they insist on without saying the war goes on.`;
  }
  if (talks.envoyDictates) {
    return `PEACE TALKS. You speak for ${talks.envoyPolityName}, at war with ${talks.playerPolityName}, and the war is won. ${standing} You may dictate the peace: name your terms, and they take them or fight on.`;
  }
  const budget = Math.round(talks.bearable);
  const what = budget < 20 ? "nothing of your ground at all, and little money"
    : budget < 50 ? "perhaps one province that is not your capital, or an indemnity your treasury can bear"
      : budget < 100 ? "a province or two, or a heavy indemnity, but never your capital unless the war has taken it"
        : "a great deal, short of your people's freedom";
  return `PEACE TALKS. You speak for ${talks.envoyPolityName}, at war with ${talks.playerPolityName}. ${standing} For peace your side will give up at most ${what}; anything more your council will not ratify, however the talk goes, and you know it. What ${talks.playerPolityName} holds of yours it keeps unless the peace gives it back. Your people's surrender is not on the table. ${theirs.length === 0 ? "" : `Your ground: ${theirs.slice(0, 8).join(", ")}${capital == null ? "" : ` (your capital among it)`}.`} Bargain as a man who knows all this; when you and they agree exact terms, say so plainly.`;
}

const ClauseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cession"), provinceId: z.string().min(1), toPolityId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("indemnity"), payerPolityId: z.string().min(1), amount: z.number().int().positive(), cadenceDays: z.number().int().positive().max(3_660), periods: z.number().int().min(1).max(100) }).strict(),
  z.object({ kind: z.literal("submission"), polityId: z.string().min(1), toPolityId: z.string().min(1) }).strict(),
]);
const TreatyReadingSchema = z.object({
  agreed: z.boolean(),
  clauses: z.array(ClauseSchema).max(6).default([]),
  terms: z.string().trim().max(600).default(""),
}).strict();

/** Few enough to print: a power may hold hundreds of small provinces, and a treaty names a handful. */
const TREATY_PROVINCES = 60;

const plainWords = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The provinces a treaty could cede: the two sides' own, with the ones the
 * conversation names (by province or by town) first, then the ground along
 * their common border, then the rest by name. A cut by map order would leave
 * out the very province being bargained for.
 */
function provincesForTheTreaty(world: WorldState, talks: Negotiation, conversation: string): WorldState["map"]["provinces"] {
  const sides = new Set([talks.envoyPolityId, talks.playerPolityId]);
  const held = world.map.provinces.filter((province) => province.controllerPolityId !== null && sides.has(province.controllerPolityId));
  const text = ` ${plainWords(conversation)} `;
  const mentioned = (name: string): boolean => {
    const words = plainWords(name);
    return words.length >= 4 && text.includes(` ${words} `);
  };
  const controller = new Map(held.map((province) => [province.id, province.controllerPolityId]));
  const onTheBorder = new Set<string>();
  for (const edge of world.map.edges) {
    const from = controller.get(edge.from);
    const to = controller.get(edge.to);
    if (from !== undefined && to !== undefined && from !== to) {
      onTheBorder.add(edge.from);
      onTheBorder.add(edge.to);
    }
  }
  const rank = (province: WorldState["map"]["provinces"][number]): number =>
    mentioned(province.name) || province.settlements.some((settlement) => mentioned(settlement.name)) ? 0 : onTheBorder.has(province.id) ? 1 : 2;
  return [...held].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, TREATY_PROVINCES);
}

/**
 * Whether the two of them agreed exact terms in this exchange, and which.
 * Nothing is agreed on the envoy's word alone, nor on the player's: both have
 * to have said yes to the same terms.
 */
async function readTheTreaty(db: ChronicaDatabase, userId: string, gameId: string, talks: Negotiation, world: WorldState, conversation: string): Promise<z.infer<typeof TreatyReadingSchema> | null> {
  const provinces = provincesForTheTreaty(world, talks, conversation)
    .map((province) => `${province.id} = ${province.name} (held by ${province.controllerPolityId === talks.envoyPolityId ? talks.envoyPolityName : talks.playerPolityName})`);
  const system = `You read peace talks between ${talks.playerPolityName} [${talks.playerPolityId}] and ${talks.envoyPolityName} [${talks.envoyPolityId}] in a historical strategy game, and say whether BOTH sides agreed exact terms in the last exchange.

"agreed" is true only when the player proposed or accepted specific terms and the envoy explicitly accepted them (or the reverse), in so many words. A proposal, a counter-offer, a refusal, or talk of terms in general is not agreement: answer false with no clauses.

When agreed, write the terms as clauses, using only these ids:
- cession: a province passing from one side to the other: { "kind": "cession", "provinceId": "<id>", "toPolityId": "<polity id>" }
- indemnity: money paid in instalments: { "kind": "indemnity", "payerPolityId": "<polity id>", "amount": <per instalment>, "cadenceDays": <days between>, "periods": <how many> }
- surrender: a power giving itself up: { "kind": "submission", "polityId": "<polity id>", "toPolityId": "<polity id>" }
A peace with no terms at all ("each keeps what it holds") is agreed with no clauses.

Provinces:
${provinces.join("\n")}

Respond ONLY with JSON: { "agreed": true|false, "clauses": [...], "terms": "the treaty in one or two plain sentences" }`;
  try {
    const result = await callWithCoinGate(db, userId, gameId, "propose_social_events", createAiAdapter(), { system, user: conversation }, (content) => {
      try { return TreatyReadingSchema.safeParse(JSON.parse(content)).success; } catch { return false; }
    });
    const parsed = TreatyReadingSchema.safeParse(JSON.parse(result.content));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (!(error instanceof InsufficientCoinsError)) console.warn("[peace-talks] could not read the treaty:", error);
    return null;
  }
}

/**
 * After an exchange with an envoy: if terms were agreed, put them to the
 * engine, and say what came of it -- sealed, or refused -- in the envoy's
 * voice, as the next line of the conversation.
 */
export async function afterTheTalks(input: {
  readonly db: ChronicaDatabase; readonly userId: string; readonly gameId: string;
  readonly envoyId: string; readonly playerId: string; readonly conversation: string;
}): Promise<string | null> {
  const view = await getWorldView(input.db, input.gameId);
  if (view === undefined) return null;
  const offices = view.scenarioGovernment?.offices ?? [];
  const talks = negotiationBetween(view.world, offices, input.envoyId, input.playerId);
  if (talks === null) return null;
  const reading = await readTheTreaty(input.db, input.userId, input.gameId, talks, view.world, input.conversation);
  if (reading === null || !reading.agreed) return null;

  // A treaty sealed while the world is moving would be overwritten by it.
  if (await findRunningBurst(input.db, input.gameId, livenessAt(new Date())) !== undefined) {
    return "(The terms are agreed, but the seal waits until the business now in hand is done: repeat your agreement once it has.)";
  }

  const outcome = concludePeace(view.world, {
    proposerPolityId: talks.playerPolityId, otherPolityId: talks.envoyPolityId,
    clauses: reading.clauses, terms: reading.terms.length > 0 ? reading.terms : `Peace between ${talks.playerPolityName} and ${talks.envoyPolityName}.`,
    representativeId: input.envoyId, speakerId: input.playerId,
  }, {
    now: view.world.instant, offices, warfare: view.scenarioWarfare, ...(view.scenarioMap === undefined ? {} : { terrains: view.scenarioMap.terrains }),
    ids: createIdFactory(`peace-${Date.now().toString(36)}`), gameId: input.gameId,
  }, offices);
  if (!outcome.made) return `(${outcome.refusal ?? "The terms could not be sealed."})`;

  const materialized = materializeFacts({ proposals: [...outcome.facts], now: outcome.world.instant, atStep: outcome.world.elapsedStep, ids: createIdFactory(`peace-facts-${Date.now().toString(36)}`), causalDepth: 0, assignedIds: new Map() });
  await persistOpeningWorld(input.db, input.gameId, outcome.world);
  if (materialized.facts.length > 0) {
    await insertWorldFacts(input.db, input.gameId, materialized.facts.map((fact) => ({
      id: fact.id, instantSortKey: fact.time.day * 1440 + fact.time.minute, kind: fact.kind, summary: fact.summary,
      visibility: fact.visibility, discoveryState: fact.discovery.state, knowableAtSortKey: null,
      significance: materialized.significanceByFactId.get(fact.id) ?? 0, causalDepth: fact.causalDepth, fact,
    })));
  }
  return `(${outcome.dictated ? "The terms are imposed, and sealed" : "The treaty is sealed"}: ${reading.terms.length > 0 ? reading.terms : "the war is over"})`;
}
