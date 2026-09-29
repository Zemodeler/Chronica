import {
  aptitude,
  skillShare,
  classifyLifeStage,
  createPressure,
  currentAgeYears,
  findPlayerSuccessors,
  applyLegacy,
  boundedId,
  portionFrom,
  settleEstate,
  stableHash,
  vacateOfficesOf,
  deriveRelationDimension,
  driftMind,
  type Character,
  type FactProposalDraft,
  type ScenarioLifeRules,
  type WorldState,
  type WorldStoryline,
} from "@chronica/shared";
import { bearChild, birthChance, CHILDBED_MORTALITY_BPS } from "./births";
import type { IdFactory } from "./ports";

/**
 * Ageing, illness, and death that is earned (slice 9).
 *
 * `life-events.ts` has computed a deterministic mortality roll since the
 * character system was written and has never had a production caller.
 * `nextLifeReviewAtStep` was null on every character in every save. No delta
 * could change `healthBps`. Only a force commander could die at all, and only
 * in a battle nobody had ever fought. So the world was one where nobody aged
 * and nobody died, which is not a historical simulation of anything.
 *
 * Three decisions shape the whole of this, and all three came from the table:
 *
 * **Historical rates, multiplied by what you expose yourself to.** A man of
 * sixty is likelier to die than a man of twenty-five, and a man of sixty who
 * spends the year in a camp in a plague province likelier again. Everything
 * the multiplier reads is state the world already keeps.
 *
 * **A roll against a person who matters cannot kill them.** It opens a peril:
 * a thread, a pressure at a visibility their own people can see, a drop in
 * health, and a fact weighty enough that the player reads it the same burst.
 * Death needs the thread in `crisis` *and* forty-five days open -- two bursts
 * at the least -- and the player can act against it in between, because
 * `character_pressure_set` already exists and already resolves one. Nobody is
 * killed off without it having been made a thing of first, and nothing is
 * shied away from either: a peril nobody answers kills.
 *
 * **Battle is the exception**, handled in `battle.ts`: dead is dead, for the
 * player too, because the battle itself is the foreshadowing.
 *
 * ## The determinism trap
 *
 * Every roll hashes on the character's own `nextLifeReviewAtStep` and never on
 * the day being ticked to. `tickTo` runs several times per burst at hop
 * boundaries, so a replay that lands its hops differently would tick to
 * different days -- and a world that rolls differently on replay is not a
 * world you can replay.
 */

/** The words a summary uses for this person. Everyone was "he" when everyone was a man. */
function pronouns(character: Pick<Character, "gender">): { he: string; He: string; him: string; his: string } {
  return character.gender === "female"
    ? { he: "she", He: "She", him: "her", his: "her" }
    : { he: "he", He: "He", him: "him", his: "his" };
}

/** How long a peril must stand before it can take somebody. Two bursts, at the least. */
export const PERIL_MUST_STAND_DAYS = 45;
/** Guards a jump of years from replaying one person's life thousands of times in one tick. */
const MAX_REVIEWS_PER_TICK = 24;
/** The most any exposure can multiply a base rate. */
const MAX_EXPOSURE = 6;
/** Below this, a person is a person; at or above it, their death is an event and gets a peril first. */
const SIGNIFICANT_PRESTIGE_BPS = 3_000;

export interface LifeReviewInput {
  readonly world: WorldState;
  readonly life: ScenarioLifeRules;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** Whose death ends the game rather than merely the man. Never killed by a roll without a peril. */
  readonly playerCharacterId?: string | null | undefined;
}

export interface LifeReviewResult {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
  /** Whoever died this review, so the caller can ask the player who follows. */
  readonly died: readonly string[];
}

/**
 * Whether this person's death would be an event.
 *
 * Office, command, a thread, standing, or being the player. Anyone else dies
 * when the roll says so: a world where every farmhand's fever is foreshadowed
 * is a world that never gets to the point.
 */
export function mattersEnough(world: WorldState, character: Character, playerCharacterId: string | null): boolean {
  if (character.id === playerCharacterId) return true;
  if (character.officeId !== null) return true;
  if (character.prestigeBps >= SIGNIFICANT_PRESTIGE_BPS) return true;
  if (world.material.forces.some((force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id)) return true;
  return world.storylines.some((storyline) => storyline.phase !== "closed" && storyline.participantIds.includes(character.id));
}

/**
 * What this person has been exposing themselves to, as a multiplier on the
 * base rate. Capped, and read entirely from state the world already keeps.
 */
export function exposureMultiplier(world: WorldState, character: Character): number {
  let exposure = 1;

  const commanding = world.material.forces.find((force) => force.commanderCharacterId === character.id);
  if (commanding !== undefined) {
    exposure *= 2;
    // On short rations, or in a province that has just been fought over.
    if (commanding.provisionStatus === "critical") exposure *= 1.5;
    else if (commanding.provisionStatus === "shortage") exposure *= 1.2;
    if (world.conflicts.battles.some((battle) => battle.participantForceIds.includes(commanding.id))) exposure *= 1.5;
  }

  // A body already failing. Health is in basis points and full health is
  // 10 000, so this is 1x at full and 2x at nothing left.
  exposure *= 1 + (10_000 - character.healthBps) / 10_000;

  const bearing = world.characterPressures.filter(
    (pressure) => pressure.characterId === character.id && pressure.status === "active" && (pressure.kind === "illness" || pressure.kind === "threat"),
  );
  for (const pressure of bearing) exposure *= 1 + pressure.intensity / 200;

  const here = world.material.provinceMaterial.find((material) => material.provinceId === character.locationProvinceId);
  if (here !== undefined && (here.stabilityBps < 3_000 || here.foodSecurityBps < 3_000)) exposure *= 1.4;

  if (character.disqualifyingStatuses.includes("captured")) exposure *= 1.5;

  // A hard constitution shrugs off what lays another man low: a third less
  // exposed at best, a third more at worst. Body was read by the duel and
  // nothing else, so the frailest senator lived as long as the hardest soldier.
  exposure *= 1 - skillShare(aptitude(character, "endurance"), 0.35);

  return Math.min(MAX_EXPOSURE, exposure);
}

/** The thread that is somebody's life in the balance, if one is already open on them. */
function openPerilFor(world: WorldState, characterId: string): WorldStoryline | undefined {
  return world.storylines.find(
    (storyline) => storyline.phase !== "closed" && storyline.seedKey === `peril:${characterId}`,
  );
}

/**
 * What a man has become since his last review: his mind moved a little by
 * what happened to him, the traits it no longer bears out let go, and the
 * lessons spent (`mind-drift.ts`).
 */
function grownBy(character: Character): Partial<Character> {
  if (character.lessons === undefined || character.lessons.length === 0) return {};
  const grown = driftMind(character.mind, character.traits, character.lessons);
  return { mind: grown.mind, traits: [...grown.traits], lessons: [] };
}

/**
 * Everyone whose life falls due for review, reviewed.
 *
 * Opting in happens here rather than at the creation sites, because
 * `player-materialization.ts` is a pure projection re-run by read paths and
 * `canonical-npc.ts` has no scenario access. Staggered on the character's own
 * id: without it every person in the world rolls on the same day, for ever.
 */
export function reviewLives(input: LifeReviewInput): LifeReviewResult {
  const { life, toDay, ids } = input;
  const player = input.playerCharacterId ?? null;
  const interval = Math.max(1, life.reviewIntervalSteps);
  if (life.lifeStages.length === 0) return { world: input.world, facts: [], died: [] };

  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const died: string[] = [];
  let sequence = 0;
  const nextLocalId = (prefix: string): string => `${prefix}_${(sequence += 1)}`;

  // Opt in whoever has never been enrolled, spread over one interval so the
  // world does not hold one great review every quarter-day and none between.
  world = {
    ...world,
    characters: world.characters.map((character) => (character.alive && character.nextLifeReviewAtStep === null
      ? { ...character, nextLifeReviewAtStep: toDay + 1 + (stableHash([character.id, "life"]) % interval) }
      : character)),
  };

  for (const enrolled of [...world.characters].sort((a, b) => a.id.localeCompare(b.id))) {
    // Every review the span passed over, not the last one only. A burst that
    // jumps a year must age a year: reviewing once per tick however far the
    // tick went would make how long people live depend on how finely the
    // player happens to play, and would make a replay whose hops fall
    // differently produce a different world.
    for (let caught = 0; caught < MAX_REVIEWS_PER_TICK; caught += 1) {
      const living = world.characters.find((candidate) => candidate.id === enrolled.id);
      if (living === undefined || !living.alive) break;
      const due = living.nextLifeReviewAtStep;
      if (due === null || due > toDay) break;

      // Hashed on the review it *is*, never on the day being ticked to.
      const roll = (what: string): number => stableHash([living.id, due, "life", what]) % 1_000_000;
      const stage = classifyLifeStage(currentAgeYears(living, due), life.lifeStages);

      world = {
        ...world,
        characters: world.characters.map((candidate) => (candidate.id === living.id
          ? { ...candidate, nextLifeReviewAtStep: due + interval, ...grownBy(candidate) }
          : candidate)),
      };
      if (stage === undefined) continue;

      // Rates are per year in basis points; a review covers `interval` days.
      const share = interval / 365;
      const exposure = exposureMultiplier(world, living);
      const mortality = Math.round(stage.mortalityRatePerYearBps * share * exposure * 100);
      const incapacity = Math.round(stage.incapacityRatePerYearBps * share * exposure * 100);
      const recovery = Math.round(stage.recoveryRatePerYearBps * share * 100);

      const peril = openPerilFor(world, living.id);
      const incapacitated = living.disqualifyingStatuses.includes("incapacitated");

      if (incapacitated && recovery > 0 && roll("recovery") < recovery) {
        world = liftIncapacity(world, living.id);
        facts.push({
          localId: nextLocalId("life"),
          kind: "recovery",
          summary: `${living.name} is on ${pronouns(living).his} feet again, and about ${pronouns(living).his} business.`,
          affectedRefs: [{ kind: "character", id: living.id }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
        });
        continue;
      }

      if (mortality > 0 && roll("mortality") < mortality) {
        if (!mattersEnough(world, living, player)) {
          const killed = killCharacter(world, living.id, `Died in the ${stage.label} of life.`, toDay);
          world = killed.world;
          facts.push(...killed.facts);
          died.push(living.id);
          continue;
        }
        // A peril already standing, and standing long enough, is now what it was
        // always going to be. Otherwise it opens, or it worsens.
        if (peril !== undefined && peril.phase === "crisis" && toDay - peril.openedAtStep >= PERIL_MUST_STAND_DAYS) {
          const killed = killCharacter(world, living.id, `${peril.title} ended as it had been going to.`, toDay);
          world = killed.world;
          facts.push(...killed.facts);
          died.push(living.id);
          continue;
        }
        const opened = openPeril(world, living, stage.label, toDay, ids, peril);
        world = opened.world;
        facts.push(...opened.facts);
        continue;
      }

      if (!incapacitated && incapacity > 0 && roll("incapacity") < incapacity) {
        world = {
          ...world,
          characters: world.characters.map((candidate) => (candidate.id === living.id
            ? {
              ...candidate,
              // Impairs; never blocks. The order box works at one basis point of
              // health, because a player who cannot act is a player with nothing
              // to do about the thing that is happening to him.
              healthBps: Math.max(500, candidate.healthBps - 2_500),
              disqualifyingStatuses: [...candidate.disqualifyingStatuses, "incapacitated"].slice(0, 8),
            }
            : candidate)),
        };
        facts.push({
          localId: nextLocalId("life"),
          kind: "illness",
          summary: `${living.name} has been taken ill and keeps to ${pronouns(living).his} house.`,
          affectedRefs: [{ kind: "character", id: living.id }],
          visibility: "public", discoveryState: "public", knowableInDays: 2, significance: 55,
        });
      }

      // Births ride the mother's own review, after the illness rolls, so a
      // woman taken ill this review is not also delivered of a child in it.
      const mother = world.characters.find((candidate) => candidate.id === living.id)!;
      const chance = birthChance(world, mother, due, interval);
      if (chance > 0 && roll("birth") < chance) {
        const born = bearChild(world, mother, due, ids, (character) => mattersEnough(world, character, player));
        if (born !== null) {
          world = born.world;
          facts.push(...born.facts);
          // The child lives whatever becomes of her. Childbed takes her
          // outright unless her death would be an event, which opens a peril
          // first, like any other.
          if (roll("childbed") < CHILDBED_MORTALITY_BPS * 100) {
            if (!mattersEnough(world, mother, player)) {
              const killed = killCharacter(world, mother.id, "She did not survive the birth.", due);
              world = killed.world;
              facts.push(...killed.facts);
              died.push(mother.id);
            } else {
              const opened = openPeril(world, mother, stage.label, due, ids, openPerilFor(world, mother.id));
              world = opened.world;
              facts.push(...opened.facts);
            }
          }
        }
      }
    }
  }

  return { world, facts, died };
}

function liftIncapacity(world: WorldState, characterId: string): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === characterId
      ? {
        ...character,
        healthBps: Math.min(10_000, character.healthBps + 2_000),
        disqualifyingStatuses: character.disqualifyingStatuses.filter((status) => status !== "incapacitated"),
      }
      : character)),
  };
}

/**
 * A life in the balance, and something that can be done about it.
 *
 * A thread so the world follows it, a pressure at `polity` visibility so
 * `whoSeeksThePlayer` can carry it (that function skips private ones), a drop
 * in health so it is materially true, and a fact weighty enough to reach the
 * same report. The lever the player already has is the pressure's own
 * intensity, which `character_pressure_set` can lower or resolve outright --
 * so no new op was needed for the way out.
 */
function openPeril(
  world: WorldState,
  character: Character,
  stageLabel: string,
  atStep: number,
  ids: IdFactory,
  standing: WorldStoryline | undefined,
): { world: WorldState; facts: FactProposalDraft[] } {
  const worsening = standing !== undefined;
  const phase = worsening ? "crisis" as const : "escalating" as const;
  const title = standing?.title ?? `The health of ${character.name}`;

  const storylines = worsening
    ? world.storylines.map((storyline) => (storyline.id === standing.id
      ? {
        ...storyline,
        phase,
        updatedAtStep: atStep,
        history: [...storyline.history, `${pronouns(character).He} is worse, and those around ${pronouns(character).him} have stopped saying otherwise.`].slice(-24),
        nextDevelopment: `Whether ${pronouns(character).he} comes through it, and who is standing near if ${pronouns(character).he} does not.`,
      }
      : storyline))
    : [...world.storylines, {
      id: ids.next("storyline"),
      title,
      participantIds: [character.id],
      provinceId: character.locationProvinceId,
      phase,
      stakes: `Whether ${character.name} lives out the year, and what falls apart if ${pronouns(character).he} does not.`,
      history: [`${character.name} has been unwell since the turn of the season.`],
      nextDevelopment: "Whether anything is done about it, and by whom.",
      visibility: "polity" as const,
      origin: "world" as const,
      openedByRef: null,
      openedAtStep: atStep,
      updatedAtStep: atStep,
      closedAtStep: null,
      causalFactIds: [],
      seedKey: `peril:${character.id}`,
    }];

  const pressured = createPressure(
    { characters: world.characters, characterPressures: world.characterPressures },
    {
      id: ids.next("pressure"),
      characterId: character.id,
      kind: "illness",
      intensity: worsening ? 85 : 55,
      label: worsening ? `A sickness that is winning` : `A sickness that has not passed`,
      sourceEventId: null,
      atStep,
      reviewInSteps: 30,
      expiresInSteps: null,
      // Not private: `whoSeeksThePlayer` skips private pressures, and a peril
      // nobody can bring to the player is a peril he cannot act against.
      visibility: "polity",
    },
  );

  return {
    world: {
      ...world,
      storylines,
      characters: pressured.characters.map((candidate) => (candidate.id === character.id
        ? { ...candidate, healthBps: Math.max(500, candidate.healthBps - (worsening ? 3_000 : 1_500)) }
        : candidate)),
      characterPressures: [...pressured.characterPressures],
    },
    facts: [{
      localId: `peril_${character.id}_${atStep}`,
      kind: worsening ? "failing_health" : "illness",
      summary: worsening
        ? `${character.name} is worse, and ${pronouns(character).his} people have begun to speak of what comes after ${pronouns(character).him}.`
        : `${character.name} has fallen ill in the ${stageLabel} of life, and it has not passed as these things do.`,
      affectedRefs: [{ kind: "character", id: character.id }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 1,
      // Heavy enough to clear any entry bar: the player has to see this coming
      // in the report he is reading, not in the one after it.
      significance: worsening ? 80 : 65,
    }],
  };
}

/**
 * The one door out of life, other than a battle.
 *
 * Seats vacated, armies handed to somebody living, the estate settled, and a
 * fact the whole world gets. `commanderCharacterId` is not nullable -- a dead
 * man went on commanding his legion, which is how this was found.
 */
export function killCharacter(
  world: WorldState,
  characterId: string,
  cause: string,
  atStep: number,
): { world: WorldState; facts: FactProposalDraft[] } {
  const person = world.characters.find((character) => character.id === characterId);
  if (person === undefined || !person.alive) return { world, facts: [] };

  let next: WorldState = {
    ...world,
    characters: world.characters.map((character) => (character.id === characterId
      ? { ...character, alive: false, diedAtStep: atStep, officeId: null }
      : character)),
  };
  next = vacateOfficesOf(next, characterId, "death", atStep);
  next = handOverForcesOf(next, characterId);

  const settled = settleEstate(next, characterId, atStep);
  next = {
    ...settled.world,
    storylines: settled.world.storylines.map((storyline) => (storyline.seedKey === `peril:${characterId}` || storyline.seedKey === `field:${characterId}`
      ? { ...storyline, phase: "closed" as const, closedAtStep: atStep, updatedAtStep: atStep }
      : storyline)),
  };
  // The principal heir takes up the house's friendships and its feuds.
  const principal = settled.beneficiaryIds[0];
  if (principal !== undefined) next = applyLegacy(next, characterId, principal, atStep);
  const inheritance = estateFacts(next, person, settled, atStep);
  next = inheritance.world;

  return {
    world: next,
    facts: [{
      localId: `death_${characterId}_${atStep}`,
      kind: "death",
      summary: `${person.name} is dead. ${cause}`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: characterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 90,
    }, ...inheritance.facts],
  };
}

/**
 * What the will said, in the record: who took what, and a thread when nobody
 * could. A dead man's money moving is the kind of thing a city talks about,
 * and an heirless estate is the kind of thing men go to law, or to war, over.
 */
function estateFacts(
  world: WorldState,
  person: Character,
  settled: ReturnType<typeof settleEstate>,
  atStep: number,
): { world: WorldState; facts: FactProposalDraft[] } {
  if (settled.estateId === null) return { world, facts: [] };
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
  const titleOf = (id: string): string => world.material.holdings.find((holding) => holding.id === id)?.title
    ?? world.material.ventures.find((venture) => venture.id === id)?.title ?? id;
  const affected = [{ kind: "character" as const, id: person.id }, ...settled.beneficiaryIds.slice(0, 6).map((id) => ({ kind: "character" as const, id }))];
  if (settled.heirless) {
    const land = settled.transfers.filter((transfer) => transfer.assetKind === "holding").map((transfer) => titleOf(transfer.assetId));
    const storylineId = boundedId(settled.estateId, "unclaimed");
    const storyline: WorldStoryline = {
      id: storylineId,
      title: `The unclaimed estate of ${person.name}`.slice(0, 160),
      participantIds: [person.id],
      provinceId: person.locationProvinceId,
      phase: "escalating",
      stakes: `Who can make good a claim to what ${person.name} left${land.length === 0 ? "" : ` -- ${land.slice(0, 3).join(", ")}`}, and whether the state keeps it.`.slice(0, 320),
      history: [`${person.name} died with no heir the law would recognise.`],
      nextDevelopment: "Whether a kinsman, a creditor or a friend of the house comes forward with a claim.",
      visibility: "polity",
      origin: "world",
      openedByRef: null,
      openedAtStep: atStep,
      updatedAtStep: atStep,
      closedAtStep: null,
      causalFactIds: [],
      seedKey: `estate:${person.id}`.slice(0, 80),
    };
    return {
      world: land.length === 0 ? world : { ...world, storylines: [...world.storylines, storyline] },
      facts: [{
        localId: `estate_${person.id}_${atStep}`,
        kind: "estate_escheated",
        summary: `${person.name} left no heir. ${settled.coin > 0 ? `${settled.escheatedToAccountId === null ? "The coin lies sealed" : `${settled.coin} in coin went to the state`}` : "There was little coin"}${land.length === 0 ? "." : `, and ${land.join(", ")} ${land.length === 1 ? "waits" : "wait"} for somebody to claim ${land.length === 1 ? "it" : "them"}.`}`.slice(0, 600),
        affectedRefs: affected,
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 1,
        significance: land.length === 0 ? 35 : 55,
      }],
    };
  }
  const parts = settled.portions.map((portion) => {
    const things = [
      portion.coin > 0 ? `${portion.coin} in coin` : null,
      ...[...portion.holdingIds, ...portion.ventureIds].map(titleOf),
      portion.dependantIds.length > 0 ? `${portion.dependantIds.length} of the household's people` : null,
      portion.debtIds.length > 0 ? `${portion.debtIds.length === 1 ? "a debt" : `${portion.debtIds.length} debts`} to pay` : null,
    ].filter((thing): thing is string => thing !== null);
    return `${name(portion.beneficiaryId)} ${things.length === 0 ? "the name and little else" : things.join(", ")}`;
  });
  return {
    world,
    facts: [{
      localId: `estate_${person.id}_${atStep}`,
      kind: "inheritance",
      summary: `${settled.reason} To ${parts.join("; to ")}.`.slice(0, 600),
      affectedRefs: affected,
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 1,
      significance: settled.coin > 0 || settled.portions.some((portion) => portion.holdingIds.length > 0) ? 50 : 25,
    }],
  };
}

/**
 * The player takes up the house of the man he was.
 *
 * The principal heir had the dead man's friends and feuds written to him at
 * the death; a successor the player chose from further out gets them now. And
 * the rival who was set against the house turns on its new head, rather than
 * standing about with a dead man for an enemy while the engine picks the new
 * one a stranger.
 */
export function takeUpTheHouse(world: WorldState, predecessorId: string, successorId: string): WorldState {
  let next = applyLegacy(world, predecessorId, successorId, world.elapsedStep);
  const live = next.nemeses.find((nemesis) => nemesis.targetCharacterId === predecessorId && nemesis.retiredAtStep === null);
  const alreadyHasOne = next.nemeses.some((nemesis) => nemesis.targetCharacterId === successorId && nemesis.retiredAtStep === null);
  if (live === undefined || alreadyHasOne) return next;
  if (live.characterId === successorId) {
    // The rival is the one the player now is: the quarrel is over.
    return { ...next, nemeses: next.nemeses.map((nemesis) => (nemesis.id === live.id ? { ...nemesis, retiredAtStep: next.elapsedStep } : nemesis)) };
  }
  next = {
    ...next,
    nemeses: next.nemeses.map((nemesis) => (nemesis.id === live.id ? { ...nemesis, targetCharacterId: successorId } : nemesis)),
    storylines: next.storylines.map((storyline) => (storyline.id === live.storylineId && !storyline.participantIds.includes(successorId)
      ? { ...storyline, participantIds: [...storyline.participantIds, successorId].slice(0, 12), updatedAtStep: next.elapsedStep }
      : storyline)),
  };
  return next;
}

/**
 * A man leaves the armies he served in: dead, or gone over to another power.
 *
 * Somebody still in the service has to hold what he commanded. Preferring
 * whoever is already in its ranks, then any countryman of the army's own
 * power: an army with a dead or departed commander is an army that cannot be
 * ordered anywhere. `onlyOfOtherPowersThan` keeps the armies of the power he
 * now serves -- a defector who brings his legion with him still leads it.
 */
export function handOverForcesOf(world: WorldState, characterId: string, onlyOfOtherPowersThan: string | null = null): WorldState {
  const successorFor = (polityId: string | null): string | null => {
    const candidates = world.characters.filter(
      (character) => character.alive && character.id !== characterId && (polityId === null || character.polityId === polityId),
    );
    return candidates.sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0]?.id ?? null;
  };
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => {
        if (onlyOfOtherPowersThan !== null && force.polityId === onlyOfOtherPowersThan) return force;
        const ranks = force.memberCharacterIds.filter((id) => id !== characterId);
        if (force.commanderCharacterId !== characterId && force.controllerCharacterId !== characterId) {
          return ranks.length === force.memberCharacterIds.length ? force : { ...force, memberCharacterIds: ranks };
        }
        // Promoted in the field: the man of most standing already in its ranks,
        // before anybody from outside it.
        const fromTheRanks = world.characters
          .filter((character) => character.alive && character.id !== characterId && ranks.includes(character.id))
          .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0]?.id ?? null;
        const heir = fromTheRanks ?? successorFor(force.polityId);
        if (heir === null) return { ...force, memberCharacterIds: ranks };
        return {
          ...force,
          ...(force.commanderCharacterId === characterId ? { commanderCharacterId: heir } : {}),
          ...(force.controllerCharacterId === characterId ? { controllerCharacterId: heir } : {}),
          memberCharacterIds: ranks.filter((id) => id !== heir),
        };
      }),
    },
  };
}

/**
 * What taking up this person means in coin and land, from the settlement
 * already made: a choice between an heir with the farms and a kinsman with a
 * purse is not the same choice as between two names.
 */
function inheritanceInWords(world: WorldState, deadCharacterId: string, person: Character): string {
  const portion = portionFrom(world, deadCharacterId, person.id);
  const { He, his } = pronouns(person);
  const purse = world.material.accounts.find((account) => account.id === person.personalAccountId)?.balance ?? 0;
  if (portion === null) return `${He} inherits nothing of the house; ${his} own purse holds ${purse}.`;
  const title = (id: string): string => world.material.holdings.find((holding) => holding.id === id)?.title
    ?? world.material.ventures.find((venture) => venture.id === id)?.title ?? id;
  const things = [
    portion.coin > 0 ? `${portion.coin} in coin` : null,
    ...[...portion.holdingIds, ...portion.ventureIds].map(title),
    portion.dependantIds.length > 0 ? `${portion.dependantIds.length} of the household's people` : null,
  ].filter((thing): thing is string => thing !== null);
  const owing = portion.debtIds
    .map((id) => world.material.obligations.find((obligation) => obligation.id === id))
    .filter((obligation) => obligation !== undefined)
    .reduce((sum, obligation) => sum + obligation.amount, 0);
  return `${He} inherits ${things.length === 0 ? "the name and little else" : things.join(", ")}${owing > 0 ? `, and debts of ${owing} each time they fall due` : ""}; ${his} purse now holds ${purse}.`;
}

/**
 * Who the player takes up next, as the decision that pre-empts every other.
 *
 * There is always at least one option. A dead end is the one thing the branch's
 * constraints forbid outright, so where the family is gone a kinsman is named
 * rather than the match simply stopping.
 */
export function successionDecision(
  world: WorldState,
  deadCharacterId: string,
  atStep: number,
): { prompt: string; options: { id: string; label: string; summary: string }[] } {
  const dead = world.characters.find((character) => character.id === deadCharacterId);
  const named = findPlayerSuccessors(world, deadCharacterId, atStep, 4);

  const describe = (id: string): { id: string; label: string; summary: string } | null => {
    const person = world.characters.find((character) => character.id === id);
    if (person === undefined) return null;
    const office = person.officeId === null ? "" : ", who already holds an office";
    return {
      id: `succeed-${id}`,
      label: person.name,
      summary: `${person.name}, aged ${currentAgeYears(person, atStep)}${office}. ${inheritanceInWords(world, deadCharacterId, person)}`.slice(0, 600),
    };
  };

  const options = named.map(describe).filter((option): option is { id: string; label: string; summary: string } => option !== null);

  // Anybody of the house, then somebody near him. Two options are the
  // schema's floor and a choice is the point of asking.
  //
  // "Near" used to mean "of most standing", so a dead private citizen was
  // offered the sitting consul as his successor. Now it is the people he
  // knew, the people where he lived, and men of his own station -- someone
  // already holding an office is offered last, not first.
  if (options.length < 2) {
    const closeness = (character: Character): number => {
      const felt = dead === undefined ? 0
        : Math.abs(deriveRelationDimension(character, dead.id, "trust") + deriveRelationDimension(character, dead.id, "affection"))
          + Math.abs(deriveRelationDimension(dead, character.id, "trust") + deriveRelationDimension(dead, character.id, "affection"));
      const here = dead !== undefined && character.locationProvinceId === dead.locationProvinceId ? 20 : 0;
      const station = dead === undefined ? 0 : Math.abs(character.prestigeBps - dead.prestigeBps) / 200;
      return felt + here - station;
    };
    const sitting = (character: Character): number =>
      world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === character.id) ? 1 : 0;
    const fallback = world.characters
      .filter((character) => character.alive && character.id !== deadCharacterId && character.polityId === dead?.polityId)
      .filter((character) => !options.some((option) => option.id === `succeed-${character.id}`))
      .sort((a, b) => sitting(a) - sitting(b) || closeness(b) - closeness(a) || a.id.localeCompare(b.id))
      .slice(0, 2 - options.length);
    for (const character of fallback) {
      const option = describe(character.id);
      if (option !== null) options.push(option);
    }
  }
  // And past the power, when the power is gone: a house extinct in a dead
  // state still leaves a world full of people, and the player is owed a pair
  // of them to choose between rather than a question with one answer.
  if (options.length < 2) {
    const anyone = world.characters
      .filter((character) => character.alive && character.id !== deadCharacterId)
      .filter((character) => !options.some((option) => option.id === `succeed-${character.id}`))
      .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))
      .slice(0, 2 - options.length);
    for (const character of anyone) {
      const option = describe(character.id);
      if (option !== null) options.push(option);
    }
  }

  return {
    prompt: `${dead?.name ?? "The head of the house"} is dead. Whose eyes do you see through now?`,
    options: options.slice(0, 5),
  };
}
