import {
  CAST_ENTER_AT,
  CAST_MIN_STAY,
  CAST_SIZE_DEFAULT,
  CAST_STAY_AT,
  CAST_WORLD_FLOOR,
  computeOpinion,
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
 * Everybody runs on rules until they deal with the player directly, and then the
 * model plays them. **A person enters the cast for an interaction with the player,
 * and for nothing else** (the cast rule, 2026-10-08): he is in the player's army,
 * office or household, the player ordered him or wrote to him, or he wrote to the
 * player, he is the player's nemesis, friend, rival or kin about him, or he has a
 * plot that touches the player or his people (`peopleAround`, `plotsOf`). Holding an
 * office, being rich, owning a house, ruling somebody else's power, commanding an
 * army elsewhere or standing in a thread the player has no part in gives nothing:
 * a man with none of these runs on the rules (`statecraft.ts`), as the patrons of
 * the trading houses the rules founded do, until he deals with the player. Once a
 * burst every living person is given a salience -- how much he matters to the
 * player now, which is the sum of his interactions -- and the cast is reviewed:
 * those at `CAST_ENTER_AT` or more are promoted, those below `CAST_STAY_AT` for two
 * reviews step down once they have served `CAST_MIN_STAY`, and the seats are
 * held: one for the nemesis, one for a friend of his who deals with him, up to three for the player's own chain (his
 * superior, those he commands, his rivals, his kin, those he writes to), two
 * for a foreign ruler for the turns he writes to the player or is written to, and the rest
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
  /** The people who deal with him directly (`peopleAround`). */
  readonly people: ReadonlySet<string>;
}

/** A friend: a person whose opinion of the player is at least this (the cast's `friend` seat, for a plot of his). */
export const FRIEND_OPINION = 25;
/** What being the player's friend adds to a plot of his: it sharpens, it does not make one. */
export const FRIEND_POINTS = 22;

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

/** The most seats of one office that are a college the holder works beside (the consuls, the praetors, the quaestors): more is a body he sits in, not a household of colleagues. */
export const COLLEGE_AT_MOST = 8;

/** How long a letter, sent or received, still makes its writer one the player deals with. */
export const LETTER_DAYS = 30;

/**
 * The people who deal with the player directly, by the cast rule (2026-10-08, "anything that interacts directly with the player"): the men of his army (who leads it, who
 * holds a post in it, who serves under him), of his office (his colleagues and the head of his power), of his household (the kin who live where he does), those he has ordered
 * or written to, those who wrote to him (`letters: false` leaves these out: a letter's reader is asked once, at the sending, and a far one is not woken for it again,
 * `cognition-policy.ts`), and whoever is set against him. Nobody else is in it: a ruler across the sea or a general in another's army is not, until he
 * writes, is written to, or is ordered.
 */
export function peopleAround(world: WorldState, player: Character | undefined, options: { readonly letters?: boolean; readonly household?: boolean } = {}): ReadonlySet<string> {
  const people = new Set<string>();
  if (player === undefined) return people;
  const day = world.instant.day;
  // His army: its commander and controller, its posts, and the men of an army he leads.
  for (const force of world.material.forces) {
    if (force.outlaw === true) continue;
    const mine = force.commanderCharacterId === player.id || force.controllerCharacterId === player.id || force.memberCharacterIds.includes(player.id);
    if (!mine) continue;
    for (const id of [force.commanderCharacterId, force.controllerCharacterId, ...(force.posts ?? []).map((post) => post.characterId)]) if (id != null) people.add(id);
  }
  // His office: the men who hold the same seat with him (a college of a few: a consul's colleague, not the whole Senate), and the head of his power.
  const held = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId === player.id).map((seat) => seat.officeId));
  for (const officeId of held) {
    const college = world.material.officeSeats.filter((seat) => seat.officeId === officeId);
    if (college.length > COLLEGE_AT_MOST) continue;
    for (const seat of college) if (seat.status === "held" && seat.holderCharacterId !== null) people.add(seat.holderCharacterId);
  }
  if (player.polityId !== null) for (const ruler of readDepartments(world).rulers(player.polityId)) people.add(ruler.id);
  // His household: kin who live where he does.
  for (const link of options.household === false ? [] : world.familyLinks) {
    const other = link.characterId === player.id ? link.relatedCharacterId : link.relatedCharacterId === player.id ? link.characterId : null;
    if (other !== null && world.characters.find((candidate) => candidate.id === other)?.locationProvinceId === player.locationProvinceId) people.add(other);
  }
  // Those he has ordered or written to, and those who have written to him.
  for (const attempt of world.orderAttempts) {
    if (attempt.recipientRef.kind !== "character" || !["issued", "received", "accepted", "delayed"].includes(attempt.status)) continue;
    if (attempt.issuerRef.id === player.id || world.orders.some((order) => order.actorCharacterId === player.id && order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)))) people.add(attempt.recipientRef.id);
  }
  for (const message of options.letters === false ? [] : world.diplomacy) {
    if (message.status !== "awaiting_reply" && day - message.sentAtStep > LETTER_DAYS) continue;
    if (message.fromCharacterId === player.id && message.toCharacterId !== null) people.add(message.toCharacterId);
    if (message.toCharacterId === player.id && message.fromCharacterId !== null) people.add(message.fromCharacterId);
  }
  for (const nemesis of world.nemeses) if (nemesis.targetCharacterId === player.id && nemesis.retiredAtStep === null) people.add(nemesis.characterId);
  people.delete(player.id);
  return people;
}

/**
 * The plots a person is in that touch the player directly, with what each is worth: the cast rule's one place. A person with none is of no account to the cast.
 * Since 2026-10-08 a plot counts only where it touches the player: a scheme laid by or against him or his people, a quarrel he is a party to, a contest for an office about
 * him, the war of an army of his, a letter or an order between him and the man, the head of his own power. A far general with a war on, a foreign ruler with a matter in hand,
 * a thread he has no part in, a decision owed by nobody he deals with: these were plots and are not.
 */
export function plotsOf(world: WorldState, character: Character, playerId: string, context?: SalienceContext): Plot[] {
  const player = world.characters.find((candidate) => candidate.id === playerId);
  const board = context?.board ?? readBoard(world);
  const rulers = context?.rulers ?? readDepartments(world);
  const people = context?.people ?? peopleAround(world, player);
  const touches = (id: string | null | undefined): boolean => id != null && (id === playerId || people.has(id));
  const plots: Plot[] = [];
  const playerPolity = player?.polityId ?? null;
  const theirPolity = character.polityId;
  const rulesUs = playerPolity !== null && rulers.rulers(playerPolity).some((ruler) => ruler.id === character.id);
  const foreignRuler = theirPolity !== null && theirPolity !== playerPolity && rulers.rulers(theirPolity).some((ruler) => ruler.id === character.id);

  // A scheme: a person set against the player, a plot he leads or whose hand he is, or one laid against him, where it touches the player or his people.
  if (world.nemeses.some((nemesis) => nemesis.characterId === character.id && nemesis.targetCharacterId === playerId && nemesis.retiredAtStep === null)) plots.push({ kind: "scheme", points: 50, why: "set against the player", earns: "nemesis" });
  const touching = world.covertPlots.filter((plot) => plot.outcome === null && [plot.sponsorCharacterId, plot.agentCharacterId, plot.targetCharacterId].some(touches));
  if (touching.some((plot) => plot.sponsorCharacterId === character.id || plot.agentCharacterId === character.id)) plots.push({ kind: "scheme", points: 35, why: "leads a plot" });
  else if (touching.some((plot) => plot.targetCharacterId === character.id)) plots.push({ kind: "scheme", points: 20, why: "a plot is laid against him" });

  // A thread the narrator has made of a quarrel the player is a party to.
  const thread = openStorylines(world.storylines).find((storyline) => storyline.participantIds.includes(character.id) && storyline.participantIds.includes(playerId));
  if (thread !== undefined) plots.push({ kind: "thread", points: thread.phase === "escalating" || thread.phase === "crisis" ? 35 : 25, why: `caught up in ${thread.title}` });

  // A contest: a candidate in an open election or appointment, or the man who puts a candidate forward: a rival for an office about him.
  if (world.material.politicalProcedures.some((procedure) => procedure.outcome === null && procedure.resolvedAtStep === null && (procedure.type === "nomination" || procedure.type === "appointment")
    && ((procedure.subjectKind === "character" && procedure.subjectId === character.id) || procedure.sponsorCharacterId === character.id))) plots.push({ kind: "contest", points: 30, why: "stands in a contest for an office" });

  // A war plan: the man who commands the army the player belongs to or leads, in the field.
  const playerForces = world.material.forces.filter((force) => force.memberCharacterIds.includes(playerId) || force.commanderCharacterId === playerId || force.controllerCharacterId === playerId);
  const inTheField = (force: (typeof playerForces)[number]): boolean => (board.get(force.polityId)?.wars.length ?? 0) > 0
    || world.sieges.some((siege) => siege.status === "active" && siege.forceId === force.id)
    || world.engagements.some((engagement) => engagement.status === "open" && (engagement.attackerForceIds.includes(force.id) || engagement.defenderForceIds.includes(force.id)));
  if (playerForces.some((force) => force.commanderCharacterId === character.id && force.commanderCharacterId !== playerId && inTheField(force))) plots.push({ kind: "war_plan", points: 40, why: "commands the player's army in the field", earns: "chain" });
  if (playerForces.some((force) => force.controllerCharacterId === playerId && force.commanderCharacterId === character.id && inTheField(force))) plots.push({ kind: "war_plan", points: 40, why: "serves under the player in the field", earns: "chain" });

  // A letter between him and the player (one that wants an answer, or one of the last month), or an order of the player's that wants his doing. A foreign ruler who
  // deals with him so is of the wider world's seat; the player's own people are of his chain.
  const day = world.instant.day;
  const dealing = foreignRuler ? "world" : "chain";
  if (world.diplomacy.some((message) => (message.status === "awaiting_reply" || day - message.sentAtStep <= LETTER_DAYS)
    && ((message.fromCharacterId === playerId && message.toCharacterId === character.id) || (message.toCharacterId === playerId && message.fromCharacterId === character.id)))) plots.push({ kind: "letter", points: 25, why: "a letter between him and the player wants an answer", earns: dealing });
  if (world.orderAttempts.some((attempt) => attempt.recipientRef.id === character.id && ["issued", "received", "accepted", "delayed"].includes(attempt.status)
    && (attempt.issuerRef.id === playerId || world.orders.some((order) => order.actorCharacterId === playerId && order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)))))) plots.push({ kind: "order", points: 25, why: "has the player's order to carry out", earns: dealing });

  // The head of the player's own power, while it has a matter in hand.
  if (rulesUs && playerPolity !== null && hasAMatterInHand(world, playerPolity, board)) plots.push({ kind: "rule", points: 40, why: "rules the player's power, which has a matter in hand", earns: "chain" });

  // What does not make a plot of itself but sharpens one: a hard decision before him, the player's rival, his kin, his friend.
  if (plots.length > 0) {
    const hardPressure = world.characterPressures.some((pressure) => pressure.characterId === character.id && pressure.status === "active" && pressure.intensity >= HARD_DECISION_AT);
    if (hardPressure) plots.push({ kind: "decision", points: 20, why: "has a hard decision before him" });
    else if (world.owed.some((owed) => owed.characterId === character.id)) plots.push({ kind: "decision", points: 20, why: "owes a decision" });
    if (world.statecraft.log.some((entry) => entry.actorCharacterId === character.id && day - entry.day <= 60
      && (entry.act === "declare_war" || entry.act === "revolt" || entry.act === "make_peace" || entry.act === "alliance"))) plots.push({ kind: "decision", points: 15, why: "has just done something great" });
    const against = (from: Character | undefined, toward: string): number =>
      from?.relations.find((relation) => relation.subjectCharacterId === toward)?.causes.reduce((sum, cause) => sum + cause.score, 0) ?? 0;
    if (against(character, playerId) <= -20 || against(player, character.id) <= -20) plots.push({ kind: "scheme", points: 15, why: "the player's rival", earns: "chain" });
    if (world.familyLinks.some((link) => (link.characterId === character.id && link.relatedCharacterId === playerId) || (link.characterId === playerId && link.relatedCharacterId === character.id))) plots.push({ kind: "scheme", points: 10, why: "the player's kin", earns: "chain" });
    if (computeOpinion(character, playerId) >= FRIEND_OPINION) plots.push({ kind: "scheme", points: FRIEND_POINTS, why: "the player's friend", earns: "friend" });
  }
  return plots;
}

/** The reading a review makes once and every person is scored against (`salienceOf`). */
export function salienceContextOf(world: WorldState, playerId: string): SalienceContext {
  return { board: readBoard(world), rulers: readDepartments(world), dealt: powersDealtWith(world, playerId), nearby: nearThePlayer(world, world.characters.find((candidate) => candidate.id === playerId)), people: peopleAround(world, world.characters.find((candidate) => candidate.id === playerId)) };
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

/** Seats per kind, with this cast size: one nemesis, a chain, the world, the rest open. */
function seatsFor(size: number): Record<CastSeat, number> {
  const chain = Math.min(3, Math.max(1, Math.floor(size / 3)));
  const world = Math.min(2, Math.max(1, Math.floor(size / 4)));
  const friend = size >= 6 ? 1 : 0;
  return { nemesis: 1, chain, friend, world, open: Math.max(0, size - 1 - chain - world - friend) };
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
  const context = salienceContextOf(world, playerId);
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
