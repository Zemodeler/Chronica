import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { currentAgeYears } from "../characters/age";
import { classifyLifeStage } from "../characters/age";
import { dueLifeReviews } from "../characters/life-events";
import { findPlayerSuccessors } from "../characters/inheritance";
import type { ScenarioLifeRules } from "../characters/family";
import type { ScenarioClock } from "../world/clock";
import { buildPoliticalInspectorView } from "../characters/political-inspector";
import { evaluateSupport, positionFromScore, dueProcedures, netSupportWeight } from "../character-agency/political-resolver";

// Bounded read tools (GM refactor, requirement 5).
//
// The Game Master is never handed a raw campaign transcript or a whole world
// document. It asks specific questions and gets compact, factual answers, so
// the prompt stays bounded however long a campaign runs and however large the
// map grows.
//
// Two rules hold for every reader here:
//  - Facts only. A reader reports state; it never characterises, speculates,
//    or suggests what to do about what it found.
//  - Scoped. Anything a scenario marks `private` is withheld unless the
//    session was explicitly opened with `privateInformation: "allow"`, so a
//    read cannot become a side channel around the knowledge system.

export type PrivateInformationPolicy = "omit" | "allow";

export interface ReadToolContext {
  readonly world: WorldState;
  readonly atStep: number;
  /** The character whose turn this is; used only to label perspective, never to widen access. */
  readonly actorCharacterId: string;
  readonly privateInformation: PrivateInformationPolicy;
  /** Scenario life rules (life stages, review interval), when the scenario authored any. Absent -- no life-review facts to report. */
  readonly scenarioLife?: ScenarioLifeRules | undefined;
  readonly scenarioClock?: ScenarioClock | undefined;
}

/** Default years-per-step used when a scenario carries no clock of its own. */
const DEFAULT_STEPS_PER_YEAR = 4;

export interface ReadToolResult {
  readonly ok: boolean;
  /** A compact factual rendering handed back to the model verbatim. */
  readonly factual: string;
  /** The same content as structured data, for tests and audit. */
  readonly data: unknown;
}

export interface ReadToolDefinition<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: TParams;
  readonly read: (context: ReadToolContext, params: z.infer<TParams>) => ReadToolResult;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyReadToolDefinition = ReadToolDefinition<any>;

const MAX_LIST = 12;

/** A commitment still owed: not yet kept, broken, cancelled, or written off. */
const UNRESOLVED_COMMITMENT_STATUSES = new Set(["pending", "prepared", "partially_fulfilled", "deferred"]);

function visible(context: ReadToolContext, visibility: "public" | "polity" | "private"): boolean {
  return visibility !== "private" || context.privateInformation === "allow";
}

function notFound(what: string, id: string): ReadToolResult {
  return { ok: false, factual: `No ${what} with id "${id}" exists in the current world.`, data: null };
}

function lines(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
}

function characterName(world: WorldState, id: string | null): string {
  if (id === null) return "nobody";
  return world.characters.find((character) => character.id === id)?.name ?? id;
}

function provinceName(world: WorldState, id: string | null): string {
  if (id === null) return "nowhere";
  return world.map.provinces.find((province) => province.id === id)?.name ?? id;
}

function polityName(world: WorldState, id: string | null): string {
  if (id === null) return "no polity";
  return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
}

function forceStrength(force: WorldState["material"]["forces"][number]): number {
  return force.personnel.reduce((sum, category) => sum + category.fit, 0);
}

// -- inspect_world -----------------------------------------------------------

const inspectWorld: AnyReadToolDefinition = {
  name: "inspect_world",
  description:
    "Overview of the current world: elapsed step, polities, how many provinces each holds, active wars, and headline counts. Start here when you need orientation rather than a specific entity.",
  parametersSchema: z.object({}).strict(),
  read(context) {
    const { world } = context;
    const polities = world.map.polities.slice(0, MAX_LIST).map((polity) => {
      const held = world.map.provinces.filter((province) => province.controllerPolityId === polity.id).length;
      return { id: polity.id, name: polity.name, provincesHeld: held };
    });
    const data = {
      elapsedStep: world.elapsedStep,
      provinceCount: world.map.provinces.length,
      livingCharacterCount: world.characters.filter((character) => character.alive).length,
      forceCount: world.material.forces.length,
      polities,
      activeWars: world.conflicts.wars.map((war) => ({
        polityAId: war.polityAId,
        polityBId: war.polityBId,
        label: `${polityName(world, war.polityAId)} vs ${polityName(world, war.polityBId)}`,
      })),
      activeBattleCount: world.conflicts.battles.length,
      activeSiegeCount: world.conflicts.sieges.length,
    };
    return {
      ok: true,
      data,
      factual: lines([
        `Step ${world.elapsedStep}. ${data.provinceCount} provinces, ${data.livingCharacterCount} living named characters, ${data.forceCount} forces.`,
        `Polities: ${polities.map((polity) => `${polity.name} (${polity.id}, holds ${polity.provincesHeld})`).join("; ") || "none"}.`,
        `Wars: ${data.activeWars.map((war) => war.label).join("; ") || "none"}.`,
        `Battles under way: ${data.activeBattleCount}. Sieges under way: ${data.activeSiegeCount}.`,
      ]),
    };
  },
};

// -- inspect_force -----------------------------------------------------------

const inspectForce: AnyReadToolDefinition = {
  name: "inspect_force",
  description:
    "Exact state of one military force: name, owner, commander, location, strength, morale, cohesion, fatigue, and supply. Use before ordering any force to move or fight.",
  parametersSchema: z.object({ forceId: EntityIdSchema }).strict(),
  read(context, params: { forceId: string }) {
    const { world } = context;
    const force = world.material.forces.find((candidate) => candidate.id === params.forceId);
    if (!force) return notFound("force", params.forceId);
    const inBattle = world.conflicts.battles.find((battle) => battle.participantForceIds.includes(force.id));
    const notes = world.campaignMemory.entityNotes.filter((note) => note.entityId === force.id);
    const data = {
      id: force.id,
      name: force.name,
      polityId: force.polityId,
      polityName: polityName(world, force.polityId),
      commanderCharacterId: force.commanderCharacterId,
      commanderName: characterName(world, force.commanderCharacterId),
      controllerCharacterId: force.controllerCharacterId,
      locationProvinceId: force.locationId,
      locationProvinceName: provinceName(world, force.locationId),
      fitStrength: forceStrength(force),
      authorizedStrength: force.authorizedStrength,
      moraleBps: force.moraleBps,
      cohesionBps: force.cohesionBps,
      fatigueBps: force.fatigueBps,
      provisionStatus: force.provisionStatus,
      provisionedThroughStep: force.provisionedThroughStep,
      payArrearsPeriods: force.payArrearsPeriods,
      inBattleId: inBattle?.battleId ?? null,
      notes: notes.map((note) => note.text),
    };
    return {
      ok: true,
      data,
      factual: lines([
        `${force.name} (${force.id}) of ${data.polityName}, commanded by ${data.commanderName}.`,
        `At ${data.locationProvinceName} (${force.locationId}). Fit strength ${data.fitStrength} of authorised ${force.authorizedStrength}.`,
        `Morale ${force.moraleBps}bps, cohesion ${force.cohesionBps}bps, fatigue ${force.fatigueBps}bps. Supply: ${force.provisionStatus}, provisioned through step ${force.provisionedThroughStep}. Pay arrears: ${force.payArrearsPeriods} period(s).`,
        data.inBattleId === null ? "Not currently engaged in a battle." : `Currently engaged in battle ${data.inBattleId}.`,
        // Memory, not a mechanical modifier -- these are exactly what was said
        // about this force, for you to weigh at your own discretion, never a
        // guaranteed effect.
        ...(notes.length > 0 ? [`Noted: ${notes.map((note) => note.text).join(" | ")}`] : []),
      ]),
    };
  },
};

// -- inspect_province --------------------------------------------------------

const inspectProvince: AnyReadToolDefinition = {
  name: "inspect_province",
  description:
    "One province: controller, firmness of control, terrain, settlements, neighbours, forces present, and material condition (population, manpower, food, stability, war damage).",
  parametersSchema: z.object({ provinceId: EntityIdSchema }).strict(),
  read(context, params: { provinceId: string }) {
    const { world } = context;
    const province = world.map.provinces.find((candidate) => candidate.id === params.provinceId);
    if (!province) return notFound("province", params.provinceId);
    const neighbours = world.map.edges
      .filter((edge) => edge.from === province.id || edge.to === province.id)
      .slice(0, MAX_LIST)
      .map((edge) => {
        const otherId = edge.from === province.id ? edge.to : edge.from;
        return { provinceId: otherId, name: provinceName(world, otherId), crossing: edge.crossing, distance: edge.distance };
      });
    const forcesPresent = world.material.forces
      .filter((force) => force.locationId === province.id)
      .slice(0, MAX_LIST)
      .map((force) => ({ id: force.id, name: force.name, polityId: force.polityId, fitStrength: forceStrength(force) }));
    const material = world.material.provinceMaterial?.find((entry) => entry.provinceId === province.id) ?? null;
    const data = {
      id: province.id,
      name: province.name,
      terrainId: province.terrainId,
      controllerPolityId: province.controllerPolityId,
      controllerName: polityName(world, province.controllerPolityId),
      controlFirmnessBps: province.controlFirmnessBps,
      settlements: province.settlements.slice(0, MAX_LIST).map((settlement) => ({ id: settlement.id, name: settlement.name })),
      neighbours,
      forcesPresent,
      material,
    };
    return {
      ok: true,
      data,
      factual: lines([
        `${province.name} (${province.id}), terrain ${province.terrainId}, held by ${data.controllerName} at ${province.controlFirmnessBps}bps firmness.`,
        // With ids: a settlement named but not identified cannot be besieged,
        // fortified, or captured, and the id gets guessed instead.
        `Settlements: ${data.settlements.map((settlement) => `${settlement.name} (${settlement.id})`).join("; ") || "none"}.`,
        `Borders: ${neighbours.map((neighbour) => `${neighbour.name} (${neighbour.provinceId}, ${neighbour.crossing}, distance ${neighbour.distance})`).join("; ") || "none"}.`,
        `Forces present: ${forcesPresent.map((force) => `${force.name} (${force.id}, ${force.fitStrength} fit)`).join("; ") || "none"}.`,
        material === null
          ? "No material record for this province."
          : `Material: population ${material.population}, available manpower ${material.availableManpower}, food security ${material.foodSecurityBps}bps, stability ${material.stabilityBps}bps, war damage ${material.warDamageBps}bps, tax capacity ${material.taxCapacity}.`,
      ]),
    };
  },
};

// -- inspect_polity ----------------------------------------------------------

const inspectPolity: AnyReadToolDefinition = {
  name: "inspect_polity",
  description:
    "One polity: capital, provinces held, forces fielded, institutions, treasury accounts, office holders, and the wars it is in.",
  parametersSchema: z.object({ polityId: EntityIdSchema }).strict(),
  read(context, params: { polityId: string }) {
    const { world } = context;
    const polity = world.map.polities.find((candidate) => candidate.id === params.polityId);
    if (!polity) return notFound("polity", params.polityId);
    const provinces = world.map.provinces.filter((province) => province.controllerPolityId === polity.id);
    const forces = world.material.forces.filter((force) => force.polityId === polity.id);
    const institutions = world.material.institutions.filter((institution) => institution.polityId === polity.id);
    const accounts = world.material.accounts.filter(
      (account) => account.owner.kind === "polity" && account.owner.id === polity.id,
    );
    // WorldState carries no office/polity mapping (offices live in the
    // scenario), so a seat is attributed to this polity through its holder,
    // and vacant seats are reported alongside since a vacancy is public and
    // its polity cannot be inferred from a holder that no longer exists.
    const memberIds = new Set(world.characters.filter((character) => character.polityId === polity.id).map((character) => character.id));
    const seats = world.material.officeSeats
      .filter((seat) => (seat.holderCharacterId !== null ? memberIds.has(seat.holderCharacterId) : true))
      .slice(0, MAX_LIST);
    const wars = world.conflicts.wars.filter((war) => war.polityAId === polity.id || war.polityBId === polity.id);
    const data = {
      id: polity.id,
      name: polity.name,
      capitalSettlementId: polity.capitalSettlementId,
      provinceIds: provinces.slice(0, 24).map((province) => province.id),
      provinceCount: provinces.length,
      forces: forces.slice(0, MAX_LIST).map((force) => ({ id: force.id, name: force.name, locationProvinceId: force.locationId, fitStrength: forceStrength(force) })),
      institutions: institutions.slice(0, MAX_LIST).map((institution) => ({ id: institution.id, name: institution.name })),
      accounts: accounts.slice(0, MAX_LIST).map((account) => ({ id: account.id, balance: account.balance, status: account.status })),
      officeSeats: seats.map((seat) => ({
        officeId: seat.officeId,
        status: seat.status,
        holderCharacterId: seat.holderCharacterId,
        holderName: characterName(world, seat.holderCharacterId),
      })),
      warOpponents: wars.map((war) => (war.polityAId === polity.id ? war.polityBId : war.polityAId)),
    };
    return {
      ok: true,
      data,
      factual: lines([
        `${polity.name} (${polity.id}) holds ${data.provinceCount} province(s).`,
        `Forces: ${data.forces.map((force) => `${force.name} (${force.id}) at ${provinceName(world, force.locationProvinceId)} with ${force.fitStrength} fit`).join("; ") || "none"}.`,
        `Institutions: ${data.institutions.map((institution) => `${institution.name} (${institution.id})`).join("; ") || "none"}.`,
        `Accounts: ${data.accounts.map((account) => `${account.id} balance ${account.balance} (${account.status})`).join("; ") || "none"}.`,
        `Office seats: ${data.officeSeats.map((seat) => `${seat.officeId}: ${seat.status}${seat.holderCharacterId ? ` (${seat.holderName})` : ""}`).join("; ") || "none"}.`,
        `At war with: ${data.warOpponents.map((id) => polityName(world, id)).join(", ") || "no one"}.`,
      ]),
    };
  },
};

// -- inspect_character -------------------------------------------------------

const inspectCharacter: AnyReadToolDefinition = {
  name: "inspect_character",
  description:
    "One character: whether they are alive, age, location, polity, office, health, prestige, wealth, forces they command, and their disqualifying statuses. Check this before making anyone act.",
  parametersSchema: z.object({ characterId: EntityIdSchema }).strict(),
  read(context, params: { characterId: string }) {
    const { world } = context;
    const character = world.characters.find((candidate) => candidate.id === params.characterId);
    if (!character) return notFound("character", params.characterId);
    const account = world.material.accounts.find((candidate) => candidate.id === character.personalAccountId);
    const commands = world.material.forces.filter(
      (force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id,
    );
    const seat = world.material.officeSeats.find((candidate) => candidate.holderCharacterId === character.id);
    const data = {
      id: character.id,
      name: character.name,
      alive: character.alive,
      diedAtStep: character.diedAtStep,
      ageYears: currentAgeYears(character, 4, context.atStep),
      locationProvinceId: character.locationProvinceId,
      locationProvinceName: provinceName(world, character.locationProvinceId),
      polityId: character.polityId,
      polityName: polityName(world, character.polityId),
      officeId: character.officeId,
      officeSeatStatus: seat?.status ?? null,
      healthBps: character.healthBps,
      prestigeBps: character.prestigeBps,
      personalBalance: account?.balance ?? null,
      commandsForceIds: commands.map((force) => force.id),
      disqualifyingStatuses: character.disqualifyingStatuses,
      heirCharacterId: character.heirCharacterId,
    };
    return {
      ok: true,
      data,
      factual: lines([
        `${character.name} (${character.id}) is ${character.alive ? "alive" : `dead (died at step ${String(character.diedAtStep)})`}, roughly ${data.ageYears} years old.`,
        `At ${data.locationProvinceName}, of ${data.polityName}. Office: ${character.officeId ?? "none"}${seat ? ` (seat ${seat.status})` : ""}.`,
        `Health ${character.healthBps}bps, prestige ${character.prestigeBps}bps, personal balance ${data.personalBalance ?? "unknown"}.`,
        `Commands forces: ${data.commandsForceIds.join(", ") || "none"}.`,
        data.disqualifyingStatuses.length > 0 ? `Disqualifying statuses: ${data.disqualifyingStatuses.join(", ")}.` : null,
      ]),
    };
  },
};

// -- inspect_active_conflicts ------------------------------------------------

const inspectActiveConflicts: AnyReadToolDefinition = {
  name: "inspect_active_conflicts",
  description:
    "Every war, battle, and siege currently under way, with the forces and places involved. Use this before proposing any military reaction.",
  parametersSchema: z.object({}).strict(),
  read(context) {
    const { world } = context;
    const battles = world.conflicts.battles.map((battle) => {
      const defenders = battle.participantForceIds.filter((id) => !battle.attackerForceIds.includes(id));
      const anyForce = world.material.forces.find((force) => force.id === battle.participantForceIds[0]);
      return {
        battleId: battle.battleId,
        attackerForceIds: battle.attackerForceIds,
        defenderForceIds: defenders,
        provinceId: anyForce?.locationId ?? null,
      };
    });
    const sieges = world.conflicts.sieges.map((siege) => {
      const settlementWithProvince = world.map.provinces
        .flatMap((province) => province.settlements.map((settlement) => ({ settlement, province })))
        .find(({ settlement }) => settlement.id === siege.settlementId);
      return {
        settlementId: siege.settlementId,
        invadingForceIds: siege.invadingForceIds,
        defendingForceIds: siege.defendingForceIds,
        provinceId: settlementWithProvince?.province.id ?? null,
      };
    });
    const wars = world.conflicts.wars.map((war) => ({
      polityAId: war.polityAId,
      polityBId: war.polityBId,
      label: `${polityName(world, war.polityAId)} vs ${polityName(world, war.polityBId)}`,
    }));
    return {
      ok: true,
      data: { wars, battles, sieges },
      factual: lines([
        `Wars (${wars.length}): ${wars.map((war) => war.label).join("; ") || "none"}.`,
        `Battles (${battles.length}): ${battles
          .map((battle) => `${battle.battleId} at ${provinceName(world, battle.provinceId)} - attackers [${battle.attackerForceIds.join(", ")}] against defenders [${battle.defenderForceIds.join(", ")}]`)
          .join("; ") || "none"}.`,
        `Sieges (${sieges.length}): ${sieges
          .map((siege) => `${siege.settlementId} at ${provinceName(world, siege.provinceId)} - besiegers [${siege.invadingForceIds.join(", ")}] against defenders [${siege.defendingForceIds.join(", ")}]`)
          .join("; ") || "none"}.`,
      ]),
    };
  },
};

// -- inspect_recent_history --------------------------------------------------

const inspectRecentHistory: AnyReadToolDefinition = {
  name: "inspect_recent_history",
  description:
    "The exact factual record of recent turns from campaign memory: what changed, which actions executed, and what was left unresolved. This is the committed record, not narration.",
  parametersSchema: z.object({ turns: z.number().int().min(1).max(6).default(3) }).strict(),
  read(context, params: { turns: number }) {
    const memory = context.world.campaignMemory;
    const recent = memory.recentTurns.slice(-params.turns);
    return {
      ok: true,
      data: { durableSummary: memory.durableSummary, recentTurns: recent },
      factual: lines([
        memory.durableSummary.length > 0 ? `Campaign so far:\n${memory.durableSummary}` : "No durable campaign summary recorded yet.",
        recent.length === 0
          ? "No recent turns recorded."
          : recent
              .map(
                (turn) =>
                  `Step ${turn.atStep}: ${turn.summary}`
                  + (turn.executedActionIds.length > 0 ? `\n  actions executed: ${turn.executedActionIds.join(", ")}` : "")
                  + (turn.unresolvedActionCount > 0 ? `\n  unresolved/unsupported attempts: ${turn.unresolvedActionCount}` : ""),
              )
              .join("\n"),
      ]),
    };
  },
};

// -- inspect_chronicle_chain -------------------------------------------------

const inspectChronicleChain: AnyReadToolDefinition = {
  name: "inspect_chronicle_chain",
  description:
    "An open causal chain: its root cause, whether it is resolved, and the pressure it still exerts. Omit chainId (pass null) to list every unresolved chain.",
  parametersSchema: z.object({ chainId: EntityIdSchema.nullable().default(null) }).strict(),
  read(context, params: { chainId: string | null }) {
    const chains = context.world.chronicleChains ?? [];
    if (params.chainId !== null) {
      const chain = chains.find((candidate) => candidate.id === params.chainId);
      if (!chain) return notFound("chronicle chain", params.chainId);
      return {
        ok: true,
        data: chain,
        factual: `Chain ${chain.id} (opened step ${chain.createdAtStep}): ${chain.rootCause} - ${chain.resolved ? "resolved" : `unresolved${chain.openPressure ? `, open pressure: ${chain.openPressure}` : ""}`}.`,
      };
    }
    const open = chains.filter((chain) => !chain.resolved).slice(0, MAX_LIST);
    return {
      ok: true,
      data: open,
      factual:
        open.length === 0
          ? "No unresolved chronicle chains."
          : open.map((chain) => `${chain.id}: ${chain.rootCause}${chain.openPressure ? ` (open pressure: ${chain.openPressure})` : ""}`).join("\n"),
    };
  },
};

// -- inspect_actor_memory ----------------------------------------------------

const inspectActorMemory: AnyReadToolDefinition = {
  name: "inspect_actor_memory",
  description:
    "What one character wants, believes, owes, fears, and remembers: goals, plots, pressures, beliefs, commitments, relations, and social links. Use this before deciding how an NPC reacts.",
  parametersSchema: z.object({ characterId: EntityIdSchema }).strict(),
  read(context, params: { characterId: string }) {
    const { world } = context;
    const character = world.characters.find((candidate) => candidate.id === params.characterId);
    if (!character) return notFound("character", params.characterId);

    const goals = (world.characterGoals ?? [])
      .filter((goal) => goal.characterId === character.id && goal.status === "active" && visible(context, goal.visibility))
      .slice(0, MAX_LIST);
    const plots = (world.characterPlots ?? [])
      .filter((plot) => plot.characterId === character.id && plot.status === "active" && visible(context, plot.visibility))
      .slice(0, MAX_LIST);
    const pressures = (world.characterPressures ?? [])
      .filter((pressure) => pressure.characterId === character.id && pressure.status === "active" && visible(context, pressure.visibility))
      .slice(0, MAX_LIST);
    const beliefs = (world.characterBeliefs ?? [])
      .filter((belief) => belief.holderCharacterId === character.id && belief.status === "active" && visible(context, belief.visibility))
      .slice(0, MAX_LIST);
    const commitments = (world.commitments ?? [])
      .filter(
        (commitment) =>
          (commitment.promisorCharacterId === character.id || commitment.beneficiaryCharacterId === character.id)
          && UNRESOLVED_COMMITMENT_STATUSES.has(commitment.status)
          && visible(context, commitment.visibility),
      )
      .slice(0, MAX_LIST);
    const links = (world.socialLinks ?? [])
      .filter(
        (link) =>
          (link.subjectCharacterId === character.id || link.targetCharacterId === character.id) && visible(context, link.visibility),
      )
      .slice(0, MAX_LIST);
    const recentIntents = (world.characterIntents ?? [])
      .filter((intent) => intent.actorCharacterId === character.id)
      .slice(-4);

    const data = {
      characterId: character.id,
      name: character.name,
      mind: { drives: character.mind.drives, temperament: character.mind.temperament, riskTolerance: character.mind.riskTolerance },
      ambitions: character.ambitions.slice(0, MAX_LIST).map((ambition) => ({ id: ambition.id, label: ambition.label, kind: ambition.kind })),
      goals: goals.map((goal) => ({ id: goal.id, objective: goal.objective, category: goal.category, priority: goal.priority })),
      plots: plots.map((plot) => ({ id: plot.id, objective: plot.objective, stage: plot.stage, momentum: plot.momentum, nextIntendedMove: plot.nextIntendedMove })),
      pressures: pressures.map((pressure) => ({ id: pressure.id, kind: pressure.kind, intensity: pressure.intensity, label: pressure.label })),
      beliefs: beliefs.map((belief) => ({ id: belief.id, claim: belief.claim, confidence: belief.confidence, subjectEntityId: belief.subjectEntityId })),
      commitments: commitments.map((commitment) => ({
        id: commitment.id,
        role: commitment.promisorCharacterId === character.id ? "promisor" : "beneficiary",
        description: commitment.description,
        reviewAtStep: commitment.reviewAtStep,
      })),
      relations: character.relations.slice(0, MAX_LIST).map((relation) => ({
        subjectCharacterId: relation.subjectCharacterId,
        subjectName: characterName(world, relation.subjectCharacterId),
        causeCount: relation.causes.length,
      })),
      socialLinks: links.map((link) => ({
        kind: link.kind,
        otherCharacterId: link.subjectCharacterId === character.id ? link.targetCharacterId : link.subjectCharacterId,
      })),
      recentIntents: recentIntents.map((intent) => ({ actionType: intent.actionType, status: intent.status, resolutionReason: intent.resolutionReason })),
      withheldPrivateInformation: context.privateInformation === "omit",
    };

    return {
      ok: true,
      data,
      factual: lines([
        `${character.name} (${character.id}). Risk tolerance ${character.mind.riskTolerance}. Drives: ${Object.entries(character.mind.drives).map(([key, value]) => `${key} ${String(value)}`).join(", ")}.`,
        `Ambitions: ${data.ambitions.map((ambition) => ambition.label).join("; ") || "none recorded"}.`,
        // These ids are not merely diagnostic: the character-agency tools
        // require them on their next call. Omitting them left a director that
        // had correctly inspected a character with no valid way to advance
        // that character's existing plot.
        `Active goals: ${data.goals.map((goal) => `${goal.objective} (id ${goal.id}; priority ${goal.priority})`).join("; ") || "none"}.`,
        `Active plots: ${data.plots.map((plot) => `${plot.objective} (id ${plot.id}) [${plot.stage}, momentum ${plot.momentum}]${plot.nextIntendedMove ? ` next: ${plot.nextIntendedMove}` : ""}`).join("; ") || "none"}.`,
        `Pressures: ${data.pressures.map((pressure) => `${pressure.kind} ${pressure.intensity} (${pressure.label})`).join("; ") || "none"}.`,
        `Beliefs: ${data.beliefs.map((belief) => `${belief.claim} (confidence ${belief.confidence})`).join("; ") || "none recorded"}.`,
        `Open commitments: ${data.commitments.map((commitment) => `${commitment.role}: ${commitment.description} (due step ${commitment.reviewAtStep})`).join("; ") || "none"}.`,
        `Ties: ${data.socialLinks.map((link) => `${link.kind} with ${characterName(world, link.otherCharacterId)}`).join("; ") || "none recorded"}.`,
        `Recent intents: ${data.recentIntents.map((intent) => `${intent.actionType} -> ${intent.status}`).join("; ") || "none"}.`,
        context.privateInformation === "omit" ? "Private-visibility records are withheld by scenario rules." : null,
      ]),
    };
  },
};

// -- inspect_political_procedure ---------------------------------------------

const inspectPoliticalProcedure: AnyReadToolDefinition = {
  name: "inspect_political_procedure",
  description:
    "One open political procedure: its stage, eligible participants, each participant's currently recorded position (if any), and, for anyone without one yet, a suggested lean from their relationships and legitimacy context. The suggestion is context only -- it is never a recorded position. Use this before calling pledge_support.",
  parametersSchema: z.object({ procedureId: EntityIdSchema }).strict(),
  read(context, params: { procedureId: string }) {
    const { world } = context;
    const view = buildPoliticalInspectorView(world, params.procedureId);
    if (view === undefined) return notFound("political procedure", params.procedureId);

    const supportPositions = view.supportPositions.filter((position) => visible(context, position.visibility));
    const positionedIds = new Set(supportPositions.map((position) => position.supporterId));
    const suggestions = view.eligibleParticipants
      .filter((participant) => !positionedIds.has(participant.characterId))
      .map((participant) => {
        const { score, reasons } = evaluateSupport(world, view.procedure, participant.characterId);
        return {
          characterId: participant.characterId,
          name: participant.name,
          suggestedLean: positionFromScore(score),
          reasons: reasons.map((reason) => reason.label),
        };
      });

    const data = {
      procedureId: view.procedure.id,
      type: view.procedure.type,
      stage: view.procedure.stage,
      sponsorCharacterId: view.procedure.sponsorCharacterId,
      institution: view.institution ? { id: view.institution.id, name: view.institution.name, totalVotingWeight: view.institution.totalVotingWeight, quorumBps: view.institution.quorumBps, passageThresholdBps: view.institution.passageThresholdBps } : null,
      eligibleParticipants: view.eligibleParticipants,
      supportPositions: supportPositions.map((position) => ({
        supporterId: position.supporterId,
        supporterName: position.supporterName,
        position: position.position,
        reasons: position.reasons.map((reason) => reason.label),
      })),
      suggestions,
      netSupportWeight: view.netSupportWeight,
      netOppositionWeight: view.netOppositionWeight,
      withheldPrivateInformation: context.privateInformation === "omit",
    };

    return {
      ok: true,
      data,
      factual: lines([
        `Procedure "${data.procedureId}" (${data.type}, stage: ${data.stage}), sponsored by ${characterName(world, data.sponsorCharacterId)}.`,
        `Eligible participants: ${data.eligibleParticipants.map((p) => p.name ?? p.characterId).join(", ") || "none"}.`,
        `Recorded positions: ${data.supportPositions.map((p) => `${p.supporterName ?? p.supporterId}: ${p.position}`).join("; ") || "none"}.`,
        `Suggested leans for those without a recorded position (context only, not a decision): ${
          data.suggestions.map((s) => `${s.name ?? s.characterId}: ${s.suggestedLean}${s.reasons.length > 0 ? ` (${s.reasons.join("; ")})` : ""}`).join("; ") || "none"
        }.`,
        `Net weight -- support: ${data.netSupportWeight}, oppose: ${data.netOppositionWeight}.`,
        context.privateInformation === "omit" ? "Private-visibility positions are withheld by scenario rules." : null,
      ]),
    };
  },
};

// -- list_due_life_reviews ----------------------------------------------------

const listDueLifeReviews: AnyReadToolDefinition = {
  name: "list_due_life_reviews",
  description:
    "Every living character whose scheduled life review has arrived this step, with age, life stage, and the scenario's own authored mortality/incapacity/recovery rates for that stage. This is information only -- no death, incapacity, or recovery has been decided. Whether and how any of them dies, weakens, or recovers this turn is your own judgment call: use kill_character, incapacitate_character, or recover_from_incapacity yourself when the story and these rates warrant it, then settle_estate for anyone who dies. A character not listed here has no life review due; do not age or kill them regardless.",
  parametersSchema: z.object({}).strict(),
  read(context) {
    const { world, scenarioLife, scenarioClock } = context;
    if (scenarioLife === undefined || scenarioLife.lifeStages.length === 0) {
      return {
        ok: true,
        data: { dueLifeReviews: [] },
        factual: "This scenario authors no life stages, so no character ever comes due for an automatic life review.",
      };
    }
    const stepsPerYear = scenarioClock?.stepsPerYear ?? DEFAULT_STEPS_PER_YEAR;
    const due = dueLifeReviews(world.characters, context.atStep).map((character) => {
      const ageYears = currentAgeYears(character, stepsPerYear, context.atStep);
      const stage = ageYears === null ? undefined : classifyLifeStage(ageYears, scenarioLife.lifeStages);
      const incapacitated = character.disqualifyingStatuses.includes("incapacitated");
      return {
        characterId: character.id,
        name: character.name,
        ageYears,
        lifeStageLabel: stage?.label ?? null,
        incapacitated,
        mortalityRatePerYearBps: stage?.mortalityRatePerYearBps ?? 0,
        incapacityRatePerYearBps: stage?.incapacityRatePerYearBps ?? 0,
        recoveryRatePerYearBps: stage?.recoveryRatePerYearBps ?? 0,
        successorCandidatesIfDeceasedToday: findPlayerSuccessors(world, character.id, stepsPerYear, context.atStep),
      };
    });
    return {
      ok: true,
      data: { dueLifeReviews: due },
      factual:
        due.length === 0
          ? "No character is due for a life review this step."
          : due
              .map((entry) =>
                `${entry.name} (${entry.characterId}), ${entry.ageYears ?? "unknown"} years old, ${entry.lifeStageLabel ?? "unclassified life stage"}. `
                + (entry.incapacitated
                  ? `Currently incapacitated; scenario recovery rate ${entry.recoveryRatePerYearBps}bps/year.`
                  : `Scenario mortality rate ${entry.mortalityRatePerYearBps}bps/year, incapacity rate ${entry.incapacityRatePerYearBps}bps/year.`)
                + (entry.successorCandidatesIfDeceasedToday.length > 0
                  ? ` Successor candidates if they died today: ${entry.successorCandidatesIfDeceasedToday.join(", ")}.`
                  : ""),
              )
              .join("\n"),
    };
  },
};

// -- list_due_political_procedures --------------------------------------------

const listDuePoliticalProcedures: AnyReadToolDefinition = {
  name: "list_due_political_procedures",
  description:
    "Every open political procedure ready to be decided this step: at voting_or_deciding, or past its deadline. Shows the recorded net support/opposition only -- it does not decide the outcome. Use inspect_political_procedure for the full detail on one, then resolve_procedure when you judge the moment right to actually decide it. A procedure not listed here is not yet ready: call_vote first, or wait for its deadline.",
  parametersSchema: z.object({}).strict(),
  read(context) {
    const { world } = context;
    const due = dueProcedures(world.material.politicalProcedures, context.atStep).map((procedure) => {
      const weights = netSupportWeight({ characters: world.characters, material: world.material }, procedure);
      return {
        procedureId: procedure.id,
        type: procedure.type,
        stage: procedure.stage,
        resolutionMechanism: procedure.resolutionMechanism,
        sponsorCharacterId: procedure.sponsorCharacterId,
        sponsorName: characterName(world, procedure.sponsorCharacterId),
        deadlineStep: procedure.deadlineStep,
        netSupportWeight: weights.support,
        netOppositionWeight: weights.oppose,
      };
    });
    return {
      ok: true,
      data: { dueProcedures: due },
      factual:
        due.length === 0
          ? "No political procedure is ready to resolve this step."
          : due
              .map((entry) =>
                `${entry.procedureId} (${entry.type}, ${entry.resolutionMechanism}), sponsored by ${entry.sponsorName}, stage ${entry.stage}${entry.deadlineStep !== null ? `, deadline step ${entry.deadlineStep}` : ""}. Net support ${entry.netSupportWeight} vs opposition ${entry.netOppositionWeight}.`,
              )
              .join("\n"),
    };
  },
};

export const GAME_MASTER_READ_TOOLS: readonly AnyReadToolDefinition[] = [
  inspectWorld,
  inspectForce,
  inspectProvince,
  inspectPolity,
  inspectCharacter,
  inspectActiveConflicts,
  inspectRecentHistory,
  inspectChronicleChain,
  inspectActorMemory,
  inspectPoliticalProcedure,
  listDueLifeReviews,
  listDuePoliticalProcedures,
];

export const READ_TOOL_BY_NAME: ReadonlyMap<string, AnyReadToolDefinition> = new Map(
  GAME_MASTER_READ_TOOLS.map((tool) => [tool.name, tool]),
);
