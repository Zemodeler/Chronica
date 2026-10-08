import {
  CAST_ENTER_AT,
  CAST_MIN_STAY,
  CAST_SIZE_DEFAULT,
  CAST_STAY_AT,
  CAST_WORLD_FLOOR,
  difficultyRules,
  kmFromAny,
  openStorylines,
  readDepartments,
  type CastMember,
  type CastSeat,
  type Character,
  type WorldState,
} from "@chronica/shared";
import { readBoard } from "./board";
import { powersDealtWith } from "./far-powers";

/**
 * The standing cast (docs/plans/a-living-world.md §4; the rule is docs/plans/government.md, "The cast rule").
 *
 * Everybody runs on rules until they matter enough to the player's story to be
 * played by the model. **A person enters the cast for an important plot, and for
 * nothing else**: a scheme he leads or is the hand of, a quarrel the narrator has
 * made a thread of, a contest he stands in, a war plan in an army he commands, a
 * hard decision pending for him (a pressure that wants answering, a question
 * owed), a letter or an order that wants his own answer; and only where that plot
 * is in or near the player's own concerns (the powers he deals with and the
 * ground round the places he holds). Holding an office, being rich, owning a house
 * or ruling somebody else's power gives nothing by itself: a man with none of
 * these runs on the rules (`statecraft.ts`), as the patrons of the trading houses
 * the rules founded do, until a plot reaches him. Once a burst every
 * living person is given a salience -- how much he matters to the player now,
 * which is the sum of his plots -- and the cast is reviewed: those at
 * `CAST_ENTER_AT` or more are promoted, those below `CAST_STAY_AT` for two
 * reviews step down once they have served `CAST_MIN_STAY`, and the seats are
 * held: one for the nemesis, up to three for the player's own chain (his
 * superior, those he commands, his rivals, his kin, those he writes to), two
 * for the wider world's rulers, so the cast is never all Roman, and the rest
 * open. Each member is asked once a burst, handed what the rules had him
 * doing lately and the options the rules would weigh (`statecraft.ts`), and
 * the rules stand back from him while he is played.
 */

export interface Salience {
  readonly score: number;
  readonly why: string;
  readonly seat: Exclude<CastSeat, "open"> | null;
}

/** The kinds of important plot a person can be in (the cast rule). */
export type PlotKind = "scheme" | "thread" | "contest" | "war_plan" | "decision" | "letter" | "order" | "rule";

/** One plot a person is in: what it is worth to his salience, and how it reads in a line. */
export interface Plot {
  readonly kind: PlotKind;
  readonly points: number;
  readonly why: string;
  readonly earns?: Exclude<CastSeat, "open">;
}

/** What a review reads once, not once a person. */
interface SalienceContext {
  readonly board: ReturnType<typeof readBoard>;
  readonly rulers: ReturnType<typeof readDepartments>;
  readonly dealt: ReadonlySet<string> | null;
  /** The provinces within the player's reach: round the places he stands in and holds. */
  readonly nearby: ReadonlySet<string>;
}

/** How far from the player's own places a person is still in the player's area, in the map's kilometres. */
export const NEAR_THE_PLAYER_KM = 300;
/** Of a hard decision pending: the least a pressure's intensity is to want an answer. */
export const HARD_DECISION_AT = 50;

/** The provinces round the places the player stands in, holds and leads armies in. */
function nearThePlayer(world: WorldState, player: Character | undefined): ReadonlySet<string> {
  if (player === undefined) return new Set();
  const places = new Set<string>([player.locationProvinceId]);
  for (const force of world.material.forces) {
    if (force.commanderCharacterId === player.id || force.controllerCharacterId === player.id || force.memberCharacterIds.includes(player.id)) places.add(force.locationId);
  }
  return new Set(kmFromAny(world, [...places], { budgetKm: NEAR_THE_PLAYER_KM }).keys());
}

/** Whether a power has a matter in hand: a war, a thread its people are in, a question before its chamber, or a hard pressure on one of its men. */
function hasAMatterInHand(world: WorldState, polityId: string, board: SalienceContext["board"]): boolean {
  if ((board.get(polityId)?.wars.length ?? 0) > 0) return true;
  const people = new Set(world.characters.filter((candidate) => candidate.polityId === polityId).map((candidate) => candidate.id));
  if (openStorylines(world.storylines).some((storyline) => storyline.participantIds.some((id) => people.has(id)))) return true;
  if (world.characterPressures.some((pressure) => pressure.status === "active" && pressure.intensity >= HARD_DECISION_AT && people.has(pressure.characterId))) return true;
  return world.material.politicalProcedures.some((procedure) => procedure.outcome === null && procedure.resolvedAtStep === null && world.material.institutions.some((institution) => institution.id === procedure.institutionId && institution.polityId === polityId));
}

/**
 * The important plots a person is in, with what each is worth: the cast rule's one place. A person with none is of no account to the cast.
 */
export function plotsOf(world: WorldState, character: Character, playerId: string, context?: SalienceContext): Plot[] {
  const player = world.characters.find((candidate) => candidate.id === playerId);
  const board = context?.board ?? readBoard(world);
  const rulers = context?.rulers ?? readDepartments(world);
  const plots: Plot[] = [];
  const playerPolity = player?.polityId ?? null;
  const theirPolity = character.polityId;
  const reading = theirPolity === null ? undefined : board.get(theirPolity);
  const atWar = (reading?.wars.length ?? 0) > 0;

  // A scheme: a person set against the player, a plot he leads or whose hand he is, or one laid against him.
  if (world.nemeses.some((nemesis) => nemesis.characterId === character.id && nemesis.targetCharacterId === playerId && nemesis.retiredAtStep === null)) plots.push({ kind: "scheme", points: 50, why: "set against the player", earns: "nemesis" });
  if (world.covertPlots.some((plot) => plot.outcome === null && (plot.sponsorCharacterId === character.id || plot.agentCharacterId === character.id))) plots.push({ kind: "scheme", points: 35, why: "leads a plot" });
  else if (world.covertPlots.some((plot) => plot.outcome === null && plot.targetCharacterId === character.id)) plots.push({ kind: "scheme", points: 20, why: "a plot is laid against him" });

  // A thread the narrator has made of a quarrel, and what is told in it.
  const thread = openStorylines(world.storylines).find((storyline) => storyline.participantIds.includes(character.id));
  if (thread !== undefined) plots.push({ kind: "thread", points: thread.phase === "escalating" || thread.phase === "crisis" ? 35 : 25, why: `caught up in ${thread.title}` });

  // A contest: a candidate in an open election or appointment, or the man who puts a candidate forward.
  if (world.material.politicalProcedures.some((procedure) => procedure.outcome === null && procedure.resolvedAtStep === null && (procedure.type === "nomination" || procedure.type === "appointment")
    && ((procedure.subjectKind === "character" && procedure.subjectId === character.id) || procedure.sponsorCharacterId === character.id))) plots.push({ kind: "contest", points: 30, why: "stands in a contest for an office" });

  // A war plan: the man who commands an army where his power is at war, and above all the face a power shows the world, the commander of its main army.
  const commands = world.material.forces.some((force) => force.commanderCharacterId === character.id && force.outlaw !== true);
  if (commands && atWar) plots.push({ kind: "war_plan", points: 10, why: "commands an army at war" });
  const rulesHere = theirPolity !== null && rulers.rulers(theirPolity).some((ruler) => ruler.id === character.id);
  const rulesUs = playerPolity !== null && rulers.rulers(playerPolity).some((ruler) => ruler.id === character.id);
  const across = playerPolity === null ? undefined : board.get(playerPolity)?.neighbours.find((neighbour) => neighbour.polityId === theirPolity);
  const hardPressure = world.characterPressures.some((pressure) => pressure.characterId === character.id && pressure.status === "active" && pressure.intensity >= HARD_DECISION_AT);
  const owes = world.owed.some((owed) => owed.characterId === character.id);
  if (!rulesHere && !rulesUs && theirPolity !== null && reading !== undefined && commandsMainArmy(world, character.id, theirPolity)
    && (atWar || hardPressure || owes || thread !== undefined) && (reading.strength >= 20_000 || (across !== undefined && across.relation !== "follows_us" && across.relation !== "leads_us"))) {
    plots.push({ kind: "war_plan", points: atWar ? 30 : 20, why: `commands the main army of ${reading.name}` });
  }
  const playerForces = world.material.forces.filter((force) => force.memberCharacterIds.includes(playerId) || force.commanderCharacterId === playerId || force.controllerCharacterId === playerId);
  const inTheField = (force: (typeof playerForces)[number]): boolean => (board.get(force.polityId)?.wars.length ?? 0) > 0
    || world.sieges.some((siege) => siege.status === "active" && siege.forceId === force.id)
    || world.engagements.some((engagement) => engagement.status === "open" && (engagement.attackerForceIds.includes(force.id) || engagement.defenderForceIds.includes(force.id)));
  if (playerForces.some((force) => force.commanderCharacterId === character.id && force.commanderCharacterId !== playerId && inTheField(force))) plots.push({ kind: "war_plan", points: 40, why: "commands the player's army in the field", earns: "chain" });
  if (playerForces.some((force) => force.controllerCharacterId === playerId && force.commanderCharacterId === character.id && inTheField(force))) plots.push({ kind: "war_plan", points: 40, why: "serves under the player in the field", earns: "chain" });

  // A hard decision pending: a pressure that wants answering, a question owed him, a thing done lately that has to be followed.
  if (hardPressure) plots.push({ kind: "decision", points: 20, why: "has a hard decision before him" });
  else if (owes) plots.push({ kind: "decision", points: 20, why: "owes a decision" });
  if (world.statecraft.log.some((entry) => entry.actorCharacterId === character.id && world.instant.day - entry.day <= 60
    && (entry.act === "declare_war" || entry.act === "revolt" || entry.act === "make_peace" || entry.act === "alliance"))) plots.push({ kind: "decision", points: 15, why: "has just done something great" });

  // A letter that wants his own answer, or an order that wants his own doing, between him and the player.
  if (world.diplomacy.some((message) => message.status === "awaiting_reply"
    && ((message.fromCharacterId === playerId && message.toCharacterId === character.id) || (message.toCharacterId === playerId && message.fromCharacterId === character.id)))) plots.push({ kind: "letter", points: 25, why: "a letter between him and the player wants an answer", earns: "chain" });
  if (world.orderAttempts.some((attempt) => attempt.recipientRef.id === character.id && ["issued", "received", "accepted", "delayed"].includes(attempt.status)
    && (attempt.issuerRef.id === playerId || world.orders.some((order) => order.actorCharacterId === playerId && order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)))))) plots.push({ kind: "order", points: 25, why: "has the player's order to carry out", earns: "chain" });

  // The head of the player's own power, while it has a matter in hand; a foreign ruler, while his power has one.
  if (rulesUs && playerPolity !== null && hasAMatterInHand(world, playerPolity, board)) plots.push({ kind: "rule", points: 40, why: "rules the player's power, which has a matter in hand", earns: "chain" });
  if (rulesHere && !rulesUs && reading !== undefined && theirPolity !== null && hasAMatterInHand(world, theirPolity, board)) {
    if (reading.strength >= 20_000) plots.push({ kind: "rule", points: 25, why: `rules ${reading.name}, a great power with a matter in hand`, earns: "world" });
    // A neighbour that is not of our own bloc: Rome's allies by foedus are Rome's business, not a voice of the wider world.
    if (across !== undefined && across.relation !== "follows_us" && across.relation !== "leads_us") plots.push({ kind: "rule", points: across.bordering ? 20 : 10, why: "rules a power the player's government deals with", earns: "world" });
    // On a harder world the cast leans toward those who fear the player's power (`hostileSeats`).
    const hostile = difficultyRules(world.difficulty).hostileSeats;
    const fear = playerPolity === null ? 0 : world.alarm.find((entry) => entry.polityId === theirPolity && entry.towardPolityId === playerPolity)?.level ?? 0;
    if (hostile > 0 && fear >= 25) plots.push({ kind: "rule", points: 8 * hostile, why: "fears the player's power", earns: "world" });
    if (plots.every((plot) => plot.earns !== "world")) plots.push({ kind: "rule", points: 0, why: "rules a power with a matter in hand", earns: "world" });
  }

  // What does not make a plot of itself but sharpens one: the player's rival, and his kin.
  if (plots.length > 0) {
    const against = (from: Character | undefined, toward: string): number =>
      from?.relations.find((relation) => relation.subjectCharacterId === toward)?.causes.reduce((sum, cause) => sum + cause.score, 0) ?? 0;
    if (against(character, playerId) <= -20 || against(player, character.id) <= -20) plots.push({ kind: "scheme", points: 15, why: "the player's rival", earns: "chain" });
    if (world.familyLinks.some((link) => (link.characterId === character.id && link.relatedCharacterId === playerId) || (link.characterId === playerId && link.relatedCharacterId === character.id))) plots.push({ kind: "scheme", points: 10, why: "the player's kin", earns: "chain" });
  }
  return plots;
}

/** How much a person matters to the player's story now, and which seat that earns: the sum of his plots, if he is in the player's area. */
export function salienceOf(world: WorldState, character: Character, playerId: string, context?: SalienceContext): Salience {
  const player = world.characters.find((candidate) => candidate.id === playerId);
  const plots = plotsOf(world, character, playerId, context);
  if (plots.length === 0) return { score: 0, why: "of no account", seat: null };
  // In or near the player's area: his own power or those he deals with, the ground round the places he holds, or his own circle.
  const dealt = context === undefined ? powersDealtWith(world, playerId) : context.dealt;
  const nearby = context?.nearby ?? nearThePlayer(world, player);
  const inHisCircle = plots.some((plot) => plot.earns === "nemesis" || plot.earns === "chain");
  const near = inHisCircle || dealt === null || (character.polityId !== null && dealt.has(character.polityId)) || nearby.has(character.locationProvinceId);
  if (!near) return { score: 0, why: "far from the player's concerns", seat: null };
  let seat: Salience["seat"] = null;
  for (const plot of plots) {
    if (plot.earns !== undefined && (seat === null || plot.earns === "nemesis")) seat = plot.earns;
  }
  const score = plots.reduce((sum, plot) => sum + plot.points, 0);
  return { score, why: plots.filter((plot) => plot.points > 0).slice(0, 3).map((plot) => plot.why).join(", ") || plots[0]!.why, seat };
}

/** The man at the head of a power's largest army: the one force of it that the world looks to. */
function commandsMainArmy(world: WorldState, characterId: string, polityId: string): boolean {
  const main = world.material.forces.filter((force) => force.polityId === polityId && force.commanderCharacterId !== null)
    .sort((a, b) => b.authorizedStrength - a.authorizedStrength || a.id.localeCompare(b.id))[0];
  return main?.commanderCharacterId === characterId;
}

/** Seats per kind, with this cast size: one nemesis, a chain, the world, the rest open. */
function seatsFor(size: number): Record<CastSeat, number> {
  const chain = Math.min(3, Math.max(1, Math.floor(size / 3)));
  const world = Math.min(2, Math.max(1, Math.floor(size / 4)));
  return { nemesis: 1, chain, world, open: Math.max(0, size - 1 - chain - world) };
}

/**
 * The cast after a review. Promotion at `CAST_ENTER_AT`; a member below
 * `CAST_STAY_AT` two reviews running leaves once he has served
 * `CAST_MIN_STAY`; a full cast makes room by dropping its least salient
 * member who has served his stay. Deterministic: ties break on the id.
 */
export function reviewCast(world: WorldState, playerId: string | null, size = CAST_SIZE_DEFAULT): WorldState {
  if (playerId === null) return world;
  const scored = new Map<string, Salience>();
  const context: SalienceContext = {
    board: readBoard(world), rulers: readDepartments(world), dealt: powersDealtWith(world, playerId),
    nearby: nearThePlayer(world, world.characters.find((candidate) => candidate.id === playerId)),
  };
  for (const character of world.characters) {
    if (!character.alive || character.id === playerId) continue;
    scored.set(character.id, salienceOf(world, character, playerId, context));
  }
  const day = world.instant.day;
  // Those already in it: kept, counted, or let go.
  const kept: CastMember[] = [];
  for (const member of world.cast.members) {
    const now = scored.get(member.characterId);
    if (now === undefined) continue; // dead, or the player
    const below = now.score < CAST_STAY_AT ? member.belowFor + 1 : 0;
    const served = member.reviews + 1;
    if (below >= 2 && served >= CAST_MIN_STAY && member.seat !== "nemesis") continue;
    kept.push({ ...member, salience: now.score, why: now.why.slice(0, 200), belowFor: below, reviews: served });
  }
  const seats = seatsFor(size);
  const taken = (seat: CastSeat): number => kept.filter((member) => member.seat === seat).length;
  const inCast = new Set(kept.map((member) => member.characterId));
  const hopefuls = [...scored.entries()]
    .filter(([id, salience]) => !inCast.has(id) && salience.score >= CAST_ENTER_AT)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  // The wider world's seats are kept filled, below the line if need be: a cast
  // of Romans alone was how both hand runs found a world with no voices in it.
  const worldHopefuls = [...scored.entries()]
    .filter(([id, salience]) => !inCast.has(id) && salience.seat === "world" && salience.score >= CAST_WORLD_FLOOR && salience.score < CAST_ENTER_AT)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  for (const [characterId, salience] of [...hopefuls, ...worldHopefuls]) {
    if (salience.score < CAST_ENTER_AT && taken("world") >= seats.world) continue;
    const wanted: CastSeat = salience.seat !== null && taken(salience.seat) < seats[salience.seat] ? salience.seat : "open";
    if (taken(wanted) >= seats[wanted]) {
      // Room is made only by someone who has served his stay and matters less.
      const weakest = kept.filter((member) => member.seat === wanted && member.reviews >= CAST_MIN_STAY && member.salience < salience.score)
        .sort((a, b) => a.salience - b.salience || a.characterId.localeCompare(b.characterId))[0];
      if (weakest === undefined) continue;
      kept.splice(kept.indexOf(weakest), 1);
    }
    kept.push({ characterId, seat: wanted, sinceStep: day, salience: salience.score, why: salience.why.slice(0, 200), belowFor: 0, reviews: 0 });
  }
  return { ...world, cast: { members: kept.slice(0, 16), lastReviewStep: day } };
}

/**
 * What a cast member is handed besides his own section: what the rules had
 * him (or his power) doing lately, and why -- so the man the model picks up
 * is the man the rules were playing -- and the options they would weigh now.
 */
export function castDossier(world: WorldState, characterId: string, options: readonly string[]): string | undefined {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined) return undefined;
  const lately = world.statecraft.log
    .filter((entry) => entry.actorCharacterId === characterId || (entry.polityId === character.polityId && readDepartments(world).rulers(entry.polityId).some((ruler) => ruler.id === characterId)))
    .slice(-3)
    .map((entry) => `  - day ${entry.day}: ${entry.act.replace(/_/g, " ")}${entry.targetPolityId === null ? "" : ` (${world.map.polities.find((polity) => polity.id === entry.targetPolityId)?.name ?? entry.targetPolityId})`}: ${entry.why}`);
  const lines = [
    ...(lately.length === 0 ? [] : ["What they have done lately, and why:", ...lately]),
    ...(options.length === 0 ? [] : [
      "What lies open to them now, as their counsellors would put it (take one, do better, or let it pass -- but choose):",
      ...options.map((option) => `  - ${option}`),
    ]),
  ];
  return lines.length === 0 ? undefined : lines.join("\n");
}
