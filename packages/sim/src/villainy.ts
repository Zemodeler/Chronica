import {
  FactProposalSchema,
  WorldDeltaSchema,
  difficultyRules,
  readDepartments,
  stableHash,
  type Character,
  type FactProposalDraft,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import type { StatecraftDecision } from "./statecraft";

/**
 * Villains, played out (docs/plans/a-living-world.md §6, the user's rule:
 * "fully implemented, played out").
 *
 * People now have vices (`characters/vices.ts`); this is what the vicious do,
 * by rule, once a month, for anybody the model is not playing:
 *
 * - **Coups.** An ambitious man of bad faith -- deceitful, treacherous or
 *   cruel -- who holds office or an army under a ruler he has no love for,
 *   and who sees the ruler weak (old, ill, unloved by his people, or simply
 *   content), lays a plot to kill him, paid from his own purse.
 * - **Usurpation.** A plot that killed a ruler puts its sponsor on the
 *   throne, if he had the ambition for it and is of the same power: the heir
 *   is set aside, and the power's standing with its own people falls.
 * - **Purges.** A cruel, paranoid or wrathful ruler who uncovers a plot
 *   against him has the man behind it put to death.
 *
 * Massacres and the sale of the people of a sacked city are carried out where
 * cities are taken (`sieges.ts`). The plots themselves run on the engine's
 * own rules (`plots.ts`): laid, secret, sometimes found out, sometimes done.
 */

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);

const BAD_FAITH = ["deceitful", "treacherous", "cruel", "envious"] as const;
const HARD_RULERS = ["cruel", "paranoid", "wrathful"] as const;
/** A chance in twelve each month, at most, that a ripe plotter moves. */
const MOST_TWELFTHS = 3;

export interface VillainyInput {
  readonly world: WorldState;
  readonly gameId: string;
  readonly playerCharacterId: string | null;
  /** People the model is playing: their villainy is the model's to choose. */
  readonly playedByModel: ReadonlySet<string>;
}

const opinionOf = (from: Character, toward: string): number =>
  from.relations.find((relation) => relation.subjectCharacterId === toward)?.causes.reduce((sum, cause) => sum + cause.score, 0) ?? 0;

export function decideVillainy(input: VillainyInput): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  const rulers = readDepartments(world);
  const decisions: StatecraftDecision[] = [];
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const plotting = new Set(world.covertPlots.filter((plot) => plot.outcome === null).map((plot) => plot.sponsorCharacterId));
  const legitimacy = new Map(world.material.polityLegitimacy.map((entry) => [entry.polityId, entry.legitimacyBps]));
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  // Offices are held by seat; many office-holders carry none on themselves.
  const seated = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!));

  // ── Coups ──────────────────────────────────────────────────────────────
  for (const plotter of world.characters) {
    if (!plotter.alive || plotter.id === input.playerCharacterId || input.playedByModel.has(plotter.id) || plotting.has(plotter.id) || plotter.polityId === null) continue;
    if (!plotter.traits.includes("ambitious") || !BAD_FAITH.some((trait) => plotter.traits.includes(trait))) continue;
    if (plotter.officeId === null && !seated.has(plotter.id) && !commanders.has(plotter.id)) continue;
    const ruler = rulers.rulers(plotter.polityId).find((candidate) => candidate.alive && candidate.id !== plotter.id);
    if (ruler === undefined) continue;
    // What makes him think it could be done, and done now.
    const reasons: string[] = [];
    let score = 0;
    const opinion = opinionOf(plotter, ruler.id);
    if (opinion > 10) continue;
    if (opinion <= -20) { score += 3; reasons.push(`he hates ${ruler.name}`); }
    else if (opinion <= 0) { score += 1; reasons.push(`he owes ${ruler.name} nothing`); }
    if (plotter.traits.includes("treacherous")) { score += 1; reasons.push("his word is worth nothing"); }
    if (plotter.traits.includes("cruel")) score += 1;
    if ((legitimacy.get(plotter.polityId) ?? 6_000) < 4_500) { score += 3; reasons.push("the people have no love for their ruler"); }
    if (ruler.healthBps < 5_000) { score += 2; reasons.push(`${ruler.name} is ill`); }
    if (ruler.traits.includes("content") || ruler.traits.includes("cowardly")) { score += 2; reasons.push(`${ruler.name} is weak`); }
    if (plotter.prestigeBps >= ruler.prestigeBps) { score += 2; reasons.push("he stands as high as the ruler"); }
    else if (plotter.prestigeBps >= ruler.prestigeBps - 1_500) { score += 1; reasons.push("he stands near the ruler"); }
    if (commanders.has(plotter.id)) { score += 1; reasons.push("the army is his"); }
    if (score < 4) continue;
    const twelfths = Math.min(MOST_TWELFTHS, score - 3);
    if (stableHash([input.gameId, "coup", plotter.id, String(Math.floor(day / 30))]) % 12 >= twelfths) continue;
    const purse = world.material.accounts.find((account) => account.id === plotter.personalAccountId);
    const spend = Math.max(0, Math.min(400, Math.round((purse?.balance ?? 0) * 0.2)));
    const why = `${plotter.name} means to be master of ${nameOf(plotter.polityId)}: ${reasons.join(", ")}`;
    decisions.push({
      polityId: plotter.polityId, actorCharacterId: plotter.id, act: "plot", targetPolityId: null, why: why.slice(0, 400),
      deltas: [delta({
        op: "covert_plot_open", localId: `coup_${plotter.id}`.slice(0, 60), kind: plotter.traits.includes("cruel") ? "assassination" : "poison",
        targetCharacterRef: ruler.id, sponsorCharacterRef: plotter.id, agentCharacterRef: null,
        fundingAccountRef: purse === undefined || spend === 0 ? null : purse.id, spend,
        cover: `Blame it on ${ruler.name}'s enemies abroad.`, expectedInDays: 90, reason: why.slice(0, 240),
      })],
      facts: [],
    });
    plotting.add(plotter.id);
  }

  // ── A personal enemy of the player's moves against him (L11) ───────────
  decisions.push(...vendettas(input, plotting));

  // ── Contested successions ──────────────────────────────────────────────
  // A ruler new to his seat -- the old one dead, a boy or a weak man in his
  // place -- is the moment an ambitious general or a great man of the court
  // disputes it. He seizes it outright if his army clearly outweighs the
  // loyal ones (`seizeThrones`), and
  // otherwise begins the plot that may get it him.
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seat.termStartedAtStep === null || seat.termStartedAtStep <= 0 || day - seat.termStartedAtStep > 45) continue;
    const heir = world.characters.find((character) => character.id === seat.holderCharacterId && character.alive);
    if (heir === undefined || heir.polityId === null || heir.id === input.playerCharacterId) continue;
    if (!rulers.rulers(heir.polityId).some((ruler) => ruler.id === heir.id)) continue;
    const young = (heir.ageYearsAtStart + Math.floor(day / 365)) < 18;
    const claimant = world.characters
      .filter((character) => character.alive && character.id !== heir.id && character.polityId === heir.polityId && character.id !== input.playerCharacterId && !input.playedByModel.has(character.id)
        && character.traits.includes("ambitious") && !plotting.has(character.id)
        && (commanders.has(character.id) || character.prestigeBps >= heir.prestigeBps + 1_500))
      .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
    if (claimant === undefined) continue;
    const men = (who: string): number => world.material.forces.filter((force) => force.polityId === heir.polityId && force.commanderCharacterId === who).reduce((sum, force) => sum + force.personnel.reduce((count, group) => count + group.fit, 0), 0);
    const his = men(claimant.id);
    const loyal = world.material.forces.filter((force) => force.polityId === heir.polityId && force.commanderCharacterId !== claimant.id).reduce((sum, force) => sum + force.personnel.reduce((count, group) => count + group.fit, 0), 0);
    const why = `${claimant.name} will not have ${young ? "a boy" : heir.name} over him`;
    // An army that clearly outweighs the loyal ones takes the throne outright (`seizeThrones`).
    if (his > 0 && his >= 1.5 * loyal) continue;
    decisions.push({
      polityId: heir.polityId, actorCharacterId: claimant.id, act: "plot", targetPolityId: null, why: `${why}: the succession is disputed`.slice(0, 400),
      deltas: [delta({
        op: "covert_plot_open", localId: `claim_${claimant.id}`.slice(0, 60), kind: "assassination",
        targetCharacterRef: heir.id, sponsorCharacterRef: claimant.id, agentCharacterRef: null, fundingAccountRef: null, spend: 0,
        cover: `${heir.name} was never fit to rule.`, expectedInDays: 60, reason: `${why}.`.slice(0, 240),
      })],
      facts: [FactProposalSchema.parse({
        localId: `disputed_${heir.polityId}_${day}`.slice(0, 60), kind: "succession_disputed",
        summary: `The succession in ${nameOf(heir.polityId)} is disputed: ${claimant.name} does not accept ${heir.name}.`.slice(0, 400),
        affectedRefs: [{ kind: "character", id: claimant.id }, { kind: "character", id: heir.id }, { kind: "polity", id: heir.polityId }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60,
      })],
    });
    plotting.add(claimant.id);
  }

  // ── Purges: a hard ruler kills the man who plotted against him ─────────
  for (const plot of world.covertPlots) {
    if (plot.outcome !== "discovered" || plot.resolvedAtStep === null || day - plot.resolvedAtStep > 31) continue;
    const ruler = world.characters.find((character) => character.id === plot.targetCharacterId && character.alive);
    const plotter = world.characters.find((character) => character.id === plot.sponsorCharacterId && character.alive);
    if (ruler === undefined || plotter === undefined || ruler.id === input.playerCharacterId || plotter.id === input.playerCharacterId || input.playedByModel.has(ruler.id)) continue;
    if (!HARD_RULERS.some((trait) => ruler.traits.includes(trait))) continue;
    if (ruler.polityId === null || !rulers.rulers(ruler.polityId).some((candidate) => candidate.id === ruler.id)) continue;
    const why = `${ruler.name} found out ${plotter.name}'s plot against him, and he is not a man who forgives`;
    decisions.push({
      polityId: ruler.polityId, actorCharacterId: ruler.id, act: "purge", targetPolityId: null, why: why.slice(0, 400),
      deltas: [delta({ op: "character_death", characterRef: plotter.id, manner: "execution", byCharacterRef: ruler.id, reason: why.slice(0, 240) })],
      facts: [FactProposalSchema.parse({
        localId: `purge_${plotter.id}`.slice(0, 60), kind: "execution",
        summary: `${ruler.name} had ${plotter.name} put to death for plotting against him.`.slice(0, 400),
        affectedRefs: [{ kind: "character", id: ruler.id }, { kind: "character", id: plotter.id }, { kind: "polity", id: ruler.polityId }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 65,
      })],
    });
  }
  return decisions;
}

/** A man who does not let a slight go, and one who hates the player this much, moves against him. */
const VENGEFUL_AT = 65;
const HATRED_AT = -30;
/** What a whispering campaign costs a man's standing. */
const DEFAMED_BPS = 400;

/**
 * The player's personal enemies, played out (play-test L11).
 *
 * The world pushed back on Rome and never on the man: on hard, nobody who
 * hated the player ever did anything about it unless the model thought to.
 * Once a month, a man of his own world who does not let a slight go and hates
 * him -- not one the model is playing -- may move against him, by the
 * difficulty's odds (`plotAgainstPlayerTwelfths`): a cruel one has him
 * waylaid and beaten (an attempt on him, which against the player lands as a
 * maiming, `plots.ts`), a bold one has him seized, and anybody else blackens
 * his name. The plots' own odds carry the difficulty's edge.
 */
function vendettas(input: VillainyInput, plotting: Set<string>): StatecraftDecision[] {
  const { world } = input;
  const twelfths = difficultyRules(world.difficulty).plotAgainstPlayerTwelfths;
  const player = input.playerCharacterId === null ? undefined : world.characters.find((character) => character.id === input.playerCharacterId && character.alive);
  if (player === undefined || twelfths <= 0) return [];
  const month = Math.floor(world.instant.day / 30);
  const decisions: StatecraftDecision[] = [];
  const enemies = world.characters
    .filter((enemy) => enemy.alive && enemy.id !== player.id && !input.playedByModel.has(enemy.id) && !plotting.has(enemy.id) && enemy.polityId !== null)
    .filter((enemy) => enemy.mind.drives.revenge >= VENGEFUL_AT && opinionOf(enemy, player.id) <= HATRED_AT)
    // Within reach of him: his own people, or men where he is.
    .filter((enemy) => enemy.polityId === player.polityId || enemy.locationProvinceId === player.locationProvinceId)
    .sort((a, b) => opinionOf(a, player.id) - opinionOf(b, player.id) || a.id.localeCompare(b.id));
  for (const enemy of enemies.slice(0, 1)) {
    if (stableHash([input.gameId, "vendetta", enemy.id, String(month)]) % 12 >= twelfths) continue;
    const why = `${enemy.name} has not forgiven ${player.name}, and means him harm`;
    const purse = world.material.accounts.find((account) => account.id === enemy.personalAccountId);
    const spend = Math.max(0, Math.min(200, Math.round((purse?.balance ?? 0) * 0.1)));
    const { cruelty, boldness } = enemy.mind.temperament;
    if (cruelty >= 60 || boldness >= 60) {
      decisions.push({
        polityId: enemy.polityId!, actorCharacterId: enemy.id, act: "plot", targetPolityId: null, why: why.slice(0, 400),
        deltas: [delta({
          op: "covert_plot_open", localId: `vendetta_${enemy.id}`.slice(0, 60), kind: cruelty >= 60 ? "assassination" : "abduction",
          targetCharacterRef: player.id, sponsorCharacterRef: enemy.id, agentCharacterRef: null,
          fundingAccountRef: purse === undefined || spend === 0 ? null : purse.id, spend,
          cover: cruelty >= 60 ? `Footpads, in a dark street.` : `Bandits on the road.`, expectedInDays: 45, reason: `${why}.`.slice(0, 240),
        })],
        facts: [],
      });
    } else {
      // A whispering campaign: done, not laid -- the talk is in the Forum by the month's end.
      decisions.push({
        polityId: enemy.polityId!, actorCharacterId: enemy.id, act: "plot", targetPolityId: null, why: why.slice(0, 400),
        deltas: [delta({ op: "character_state_set", characterRef: player.id, standingDeltaBps: -DEFAMED_BPS, standingCause: "scandal", reason: `${enemy.name} has his name blackened.`.slice(0, 240) })],
        facts: [
          FactProposalSchema.parse({
            localId: `defamed_${player.id}_${month}`.slice(0, 60), kind: "scandal",
            summary: `Ugly stories about ${player.name} are going round, and people are repeating them.`.slice(0, 400),
            affectedRefs: [{ kind: "character", id: player.id }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
          }),
          FactProposalSchema.parse({
            localId: `defamer_${enemy.id}_${month}`.slice(0, 60), kind: "defamation",
            summary: `${enemy.name} has put the stories about ${player.name} about.`.slice(0, 400),
            affectedRefs: [{ kind: "character", id: enemy.id }, { kind: "character", id: player.id }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 30,
            knownToRefs: [{ kind: "character", id: enemy.id }],
          }),
        ],
      });
    }
    plotting.add(enemy.id);
  }
  return decisions;
}

/**
 * A plot that killed a ruler this month puts its sponsor on the throne, where
 * he had the ambition and is of the same power: the seat is his, the heir
 * set aside, and his power's people think the less of their government.
 * Engine state, not an act anybody writes: the deed is done, this is what it
 * made true.
 */
export function usurpations(world: WorldState, playerCharacterId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  const day = world.instant.day;
  const facts: FactProposalDraft[] = [];
  let next = world;
  for (const plot of world.covertPlots) {
    if (plot.outcome !== "killed" || plot.resolvedAtStep === null || day - plot.resolvedAtStep > 31) continue;
    const victim = next.characters.find((character) => character.id === plot.targetCharacterId);
    const usurper = next.characters.find((character) => character.id === plot.sponsorCharacterId && character.alive);
    if (victim === undefined || usurper === undefined || usurper.id === playerCharacterId || !usurper.traits.includes("ambitious")) continue;
    if (victim.polityId === null || victim.polityId !== usurper.polityId) continue;
    const polityId = victim.polityId;
    const holderBefore = next.material.officeSeats.find((seat) => seat.officeId === (next.constitutions?.find((constitution) => constitution.polityId === polityId)?.rulerOfficeId ?? "") && seat.status === "held")?.holderCharacterId ?? null;
    const setAside = holderBefore !== null && holderBefore !== victim.id && holderBefore !== usurper.id ? holderBefore : null;
    const taken = takeTheThrone(next, usurper.id, polityId, setAside ?? victim.id, day);
    if (taken === null) continue;
    next = taken;
    const name = next.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
    const heir = setAside === null ? null : next.characters.find((character) => character.id === setAside)?.name ?? null;
    facts.push({
      localId: `usurped_${polityId}_${day}`.slice(0, 60),
      kind: "usurpation",
      summary: `${usurper.name}, whose men killed ${victim.name}, has made himself master of ${name}${heir === null ? "" : `, and set ${heir} aside`}.`.slice(0, 400),
      affectedRefs: [{ kind: "character", id: usurper.id }, { kind: "character", id: victim.id }, { kind: "polity", id: polityId }, ...(setAside === null ? [] : [{ kind: "character" as const, id: setAside }])],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 85,
    });
  }
  return { world: next, facts };
}

/** The ruler's seat to a new man: the old holder out, the power's people the less trusting of their government. */
function takeTheThrone(world: WorldState, usurperId: string, polityId: string, displacedId: string | null, day: number): WorldState | null {
  const rulerOffice = world.constitutions?.find((constitution) => constitution.polityId === polityId)?.rulerOfficeId ?? null;
  if (rulerOffice === null) return null;
  const seat = world.material.officeSeats.find((candidate) => candidate.officeId === rulerOffice && (candidate.holderCharacterId === displacedId || candidate.holderCharacterId === null || candidate.status !== "held"))
    ?? world.material.officeSeats.find((candidate) => candidate.officeId === rulerOffice);
  if (seat === undefined || seat.holderCharacterId === usurperId) return null;
  const setAside = seat.holderCharacterId;
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === usurperId ? { ...character, officeId: rulerOffice, prestigeBps: Math.min(10_000, character.prestigeBps + 1_000) }
      : character.id === setAside ? { ...character, officeId: null } : character)),
    material: {
      ...world.material,
      officeSeats: world.material.officeSeats.map((candidate) => (candidate.id === seat.id
        ? { ...candidate, holderCharacterId: usurperId, status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: day, termExpiresAtStep: null }
        : candidate)),
      polityLegitimacy: world.material.polityLegitimacy.map((entry) => (entry.polityId === polityId ? { ...entry, legitimacyBps: Math.max(0, entry.legitimacyBps - 2_000) } : entry)),
    },
  };
}

/**
 * A disputed succession settled by the sword: a new ruler whose own power's
 * army is mostly another man's -- an ambitious general who will not have a
 * boy or a weak man over him -- is set aside by him, and he rules. For people
 * the model is not playing; the model's own generals decide for themselves.
 */
export function seizeThrones(world: WorldState, playerCharacterId: string | null, playedByModel: ReadonlySet<string>): { world: WorldState; facts: FactProposalDraft[] } {
  const day = world.instant.day;
  const rulers = readDepartments(world);
  const facts: FactProposalDraft[] = [];
  let next = world;
  const fit = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((count, group) => count + group.fit, 0);
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seat.termStartedAtStep === null || seat.termStartedAtStep <= 0 || day - seat.termStartedAtStep > 45) continue;
    const heir = next.characters.find((character) => character.id === seat.holderCharacterId && character.alive);
    if (heir === undefined || heir.polityId === null || heir.id === playerCharacterId || !rulers.rulers(heir.polityId).some((ruler) => ruler.id === heir.id)) continue;
    const general = next.material.forces
      .filter((force) => force.polityId === heir.polityId && force.commanderCharacterId !== heir.id && force.commanderCharacterId !== playerCharacterId && !playedByModel.has(force.commanderCharacterId))
      .map((force) => next.characters.find((character) => character.id === force.commanderCharacterId))
      .find((character) => character !== undefined && character.alive && character.traits.includes("ambitious") && character.polityId === heir.polityId);
    if (general === undefined) continue;
    const his = next.material.forces.filter((force) => force.polityId === heir.polityId && force.commanderCharacterId === general.id).reduce((sum, force) => sum + fit(force), 0);
    const loyal = next.material.forces.filter((force) => force.polityId === heir.polityId && force.commanderCharacterId !== general.id).reduce((sum, force) => sum + fit(force), 0);
    if (his === 0 || his < 1.5 * loyal) continue;
    const taken = takeTheThrone(next, general.id, heir.polityId, heir.id, day);
    if (taken === null) continue;
    next = taken;
    const name = next.map.polities.find((polity) => polity.id === heir.polityId)?.name ?? heir.polityId;
    facts.push({
      localId: `seized_${heir.polityId}_${day}`.slice(0, 60), kind: "succession_seized",
      summary: `${general.name} would not have ${heir.name} over him: he set him aside and took the rule of ${name} with the army behind him.`.slice(0, 400),
      affectedRefs: [{ kind: "character", id: general.id }, { kind: "character", id: heir.id }, { kind: "polity", id: heir.polityId }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 85,
    });
  }
  return { world: next, facts };
}
