import {
  CAST_ENTER_AT,
  CAST_MIN_STAY,
  CAST_SIZE_DEFAULT,
  CAST_STAY_AT,
  CAST_WORLD_FLOOR,
  difficultyRules,
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
 * The standing cast (docs/plans/a-living-world.md §4).
 *
 * Everybody runs on rules until they matter enough to the player's story to be
 * played by the model. Once a burst every living person is given a salience --
 * how much he matters to the player now -- and the cast is reviewed: those at
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

/** What a review reads once, not once a person. */
interface SalienceContext {
  readonly board: ReturnType<typeof readBoard>;
  readonly rulers: ReturnType<typeof readDepartments>;
  readonly dealt: ReadonlySet<string> | null;
}

/** How much a person matters to the player's story now, and which seat that earns. */
export function salienceOf(world: WorldState, character: Character, playerId: string, context?: SalienceContext): Salience {
  const player = world.characters.find((candidate) => candidate.id === playerId);
  const board = context?.board ?? readBoard(world);
  const rulers = context?.rulers ?? readDepartments(world);
  const reasons: string[] = [];
  let score = 0;
  let seat: Salience["seat"] = null;
  const add = (points: number, why: string, earns: Salience["seat"] = null): void => {
    score += points;
    reasons.push(why);
    if (earns !== null && (seat === null || earns === "nemesis")) seat = earns;
  };

  if (world.nemeses.some((nemesis) => nemesis.characterId === character.id && nemesis.targetCharacterId === playerId && nemesis.retiredAtStep === null)) add(50, "set against the player", "nemesis");
  const playerPolity = player?.polityId ?? null;
  const rulesUs = playerPolity !== null && rulers.rulers(playerPolity).some((ruler) => ruler.id === character.id);
  if (rulesUs) add(40, "rules the player's power", "chain");
  const playerForces = world.material.forces.filter((force) => force.memberCharacterIds.includes(playerId) || force.commanderCharacterId === playerId || force.controllerCharacterId === playerId);
  if (playerForces.some((force) => force.commanderCharacterId === character.id && force.commanderCharacterId !== playerId)) add(40, "commands the player's army", "chain");
  if (playerForces.some((force) => force.controllerCharacterId === playerId && force.commanderCharacterId === character.id)) add(40, "serves under the player", "chain");
  const against = (from: Character | undefined, toward: string): number =>
    from?.relations.find((relation) => relation.subjectCharacterId === toward)?.causes.reduce((sum, cause) => sum + cause.score, 0) ?? 0;
  if (against(character, playerId) <= -20 || against(player, character.id) <= -20) add(35, "the player's rival", "chain");
  if (world.familyLinks.some((link) => (link.characterId === character.id && link.relatedCharacterId === playerId) || (link.characterId === playerId && link.relatedCharacterId === character.id))) add(25, "the player's kin", "chain");
  if (world.diplomacy.some((message) => world.elapsedStep - message.sentAtStep <= 120
    && ((message.fromCharacterId === playerId && message.toCharacterId === character.id) || (message.toCharacterId === playerId && message.fromCharacterId === character.id)))) add(25, "writing to the player", "chain");

  const theirPolity = character.polityId;
  const rulesHere = theirPolity !== null && rulers.rulers(theirPolity).some((ruler) => ruler.id === character.id);
  const reading = theirPolity === null ? undefined : board.get(theirPolity);
  if (rulesHere && !rulesUs && reading !== undefined && reading.strength >= 20_000) add(25, `rules ${reading.name}, a great power`, "world");
  // A neighbour that is not of our own bloc: Rome's allies by foedus are Rome's business, not a voice of the wider world.
  const across = playerPolity === null ? undefined : board.get(playerPolity)?.neighbours.find((neighbour) => neighbour.polityId === theirPolity);
  if (rulesHere && !rulesUs && across !== undefined && across.relation !== "follows_us" && across.relation !== "leads_us") add(across.bordering ? 20 : 10, "rules a power the player's government deals with", "world");
  if (rulesHere && !rulesUs && seat === null) seat = "world";

  const thread = openStorylines(world.storylines).find((storyline) => storyline.participantIds.includes(character.id));
  if (thread !== undefined) add(thread.phase === "escalating" || thread.phase === "crisis" ? 35 : 25, `caught up in ${thread.title}`);
  if (world.covertPlots.some((plot) => plot.outcome === null && (plot.sponsorCharacterId === character.id || plot.targetCharacterId === character.id))) add(20, "in a plot");
  if (world.material.forces.some((force) => force.commanderCharacterId === character.id) && theirPolity !== null && (reading?.wars.length ?? 0) > 0) add(10, "commands an army at war");
  if (world.statecraft.log.some((entry) => entry.actorCharacterId === character.id && world.instant.day - entry.day <= 60
    && (entry.act === "declare_war" || entry.act === "revolt" || entry.act === "make_peace" || entry.act === "alliance"))) add(15, "has just done something great");

  // On a harder world the cast leans toward those who fear the player's power (`hostileSeats`).
  const hostile = difficultyRules(world.difficulty).hostileSeats;
  const fear = theirPolity === null || playerPolity === null ? 0 : world.alarm.find((entry) => entry.polityId === theirPolity && entry.towardPolityId === playerPolity)?.level ?? 0;
  if (rulesHere && hostile > 0 && fear >= 25) add(8 * hostile, "fears the player's power", "world");
  const dealt = context === undefined ? powersDealtWith(world, playerId) : context.dealt;
  if (dealt !== null && theirPolity !== null && !dealt.has(theirPolity)) score -= 15;
  return { score, why: reasons.slice(0, 3).join(", ") || "of no account", seat };
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
  const context: SalienceContext = { board: readBoard(world), rulers: readDepartments(world), dealt: powersDealtWith(world, playerId) };
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
