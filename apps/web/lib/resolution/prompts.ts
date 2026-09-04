import "server-only";

import type { WorldState } from "@chronica/shared";
import { buildWorkflowCatalog, chronicleWordBudget, type RuntimeInventedWorkflow } from "@chronica/shared";
import type { CharacterKnowledgebase } from "@chronica/shared";

/** Durable player context supplied to every director during turn resolution. */
export interface ResolutionPlayerContext {
  readonly knowledgebase: CharacterKnowledgebase | null;
  readonly pendingCommitments: readonly {
    npcCharacterId: string;
    promiseType: string;
    promisedResult: string;
    conditions: string;
    rationale: string;
  }[];
}

/**
 * A compact, factual context block. It is deliberately built server-side so
 * every director sees the same player identity and outstanding commitments.
 */
export function buildPlayerResolutionContext(
  world: WorldState,
  context: ResolutionPlayerContext | undefined,
): string {
  if (!context) return "";

  const lines: string[] = [];
  const kb = context.knowledgebase;
  if (kb) {
    lines.push("\nPLAYER KNOWLEDGEBASE (authoritative personal context):");
    lines.push(`  Identity: ${kb.canonicalName} — ${kb.role}`);
    lines.push(`  Authority: ${kb.authority.join("; ") || "none recorded"}`);
    // This context is sent to several directors in one turn.  The opening
    // portion of a biography establishes voice and role reliably; sending a
    // second copy of a long backstory to every call costs more than it helps.
    lines.push(`  Background: ${kb.biography.slice(0, 500)}`);
    lines.push(`  Key relations: ${kb.relations.slice(0, 8).map((r) => `${r.name} (${r.relationship}: ${r.notes.slice(0, 160)})`).join("; ")}`);
  }

  if (context.pendingCommitments.length > 0) {
    lines.push("\nPENDING DIALOGUE COMMITMENTS (treat as live pressures, not fulfilled facts):");
    for (const commitment of context.pendingCommitments.slice(0, 4)) {
      const npcName = world.characters.find((c) => c.id === commitment.npcCharacterId)?.name ?? commitment.npcCharacterId;
      lines.push(`  ${npcName} [id: ${commitment.npcCharacterId}] promised ${commitment.promiseType}: ${commitment.promisedResult.slice(0, 200)}. Conditions: ${commitment.conditions.slice(0, 160)}. Basis: ${commitment.rationale.slice(0, 160)}`);
    }
  }

  return lines.join("\n");
}

// Prompt builders for the three-step resolution chain.
//
// Each prompt receives a snapshot of the game world and the player's character
// so the AI has enough context to make grounded decisions. Prompts are
// intentionally concise: the AI should read them in full before answering.

function worldContext(world: WorldState, actorId: string, context?: ResolutionPlayerContext): string {
  const actor = world.characters.find((c) => c.id === actorId);
  const location = actor
    ? world.map.provinces.find((p) => p.id === actor.locationProvinceId)
    : null;
  const polity = actor
    ? world.map.polities.find((p) => p.id === actor.polityId)
    : null;
  const forces = world.material.forces.filter((f) => f.controllerCharacterId === actorId || f.commanderCharacterId === actorId);
  const wars = world.conflicts.wars;
  const battles = world.conflicts.battles;
  const sieges = world.conflicts.sieges;

  const lines: string[] = [];

  // Include IDs alongside names so AI can form valid workflow parameters.
  if (actor) {
    lines.push(`ACTOR: ${actor.name} [id: ${actor.id}] (${polity?.name ?? "unknown polity"} [id: ${polity?.id ?? "?"}]), located in ${location?.name ?? actor.locationProvinceId} [id: ${actor.locationProvinceId}]`);
    lines.push(`Health: ${(actor.healthBps / 100).toFixed(0)}% | Prestige: ${(actor.prestigeBps / 100).toFixed(0)}%`);
    if (actor.officeId) lines.push(`Office: ${actor.officeId}`);
  }
  const playerContext = buildPlayerResolutionContext(world, context);
  if (playerContext) lines.push(playerContext);

  lines.push(`\nPOLITIES:`);
  for (const p of world.map.polities) {
    lines.push(`  ${p.name} [id: ${p.id}]`);
  }

  // Keep every place name and ID (orders may legitimately target any of
  // them), but avoid repeating polity names already listed above for every
  // province. This is one of the largest repeated prompt sections.
  lines.push(`\nPROVINCES (name [id; controller-id]):`);
  for (const p of world.map.provinces) lines.push(`  ${p.name} [${p.id}; ${p.controllerPolityId ?? "none"}]`);

  // Accounts visible to actor (for create_force and economic workflows).
  // Include: non-private accounts, polity accounts for the actor's polity, and the actor's own character accounts.
  const actorPolityId = actor?.polityId;
  const visibleAccounts = world.material.accounts.filter(
    (a) =>
      a.visibility !== "private" ||
      (actorPolityId && a.owner.kind === "polity" && a.owner.id === actorPolityId) ||
      (actorId && a.owner.kind === "character" && a.owner.id === actorId),
  );
  if (visibleAccounts.length > 0) {
    lines.push(`\nACCOUNTS (use account-id when invoking economic workflows):`);
    for (const a of visibleAccounts) {
      const ownerName =
        a.owner.kind === "character"
          ? (world.characters.find((c) => c.id === a.owner.id)?.name ?? a.owner.id)
          : (world.map.polities.find((p) => p.id === a.owner.id)?.name ?? a.owner.id);
      const isActor = a.owner.kind === "character" && a.owner.id === actorId;
      lines.push(
        `  ${ownerName}${isActor ? " (YOU)" : ""} [account-id: ${a.id}] balance: ${a.balance} ${world.material.currency.name} (${a.status})`,
      );
    }
  }

  if (forces.length > 0) {
    lines.push(`\nFORCES UNDER COMMAND:`);
    for (const f of forces) {
      const fitTotal = f.personnel.reduce((n, p) => n + p.fit, 0);
      const loc = world.map.provinces.find((p) => p.id === f.locationId);
      lines.push(`  ${f.name} [id: ${f.id}]: ${fitTotal} troops in ${loc?.name ?? f.locationId} [id: ${f.locationId}] | Morale ${(f.moraleBps / 100).toFixed(0)}%`);
    }
  }

  // All world forces (for context on potential targets).
  const otherForces = world.material.forces.filter((f) => !forces.some((uf) => uf.id === f.id));
  if (otherForces.length > 0) {
    lines.push(`\nOTHER FORCES IN WORLD:`);
    for (const f of otherForces.slice(0, 8)) {
      const loc = world.map.provinces.find((p) => p.id === f.locationId);
      const polityName = world.map.polities.find((p) => p.id === f.polityId)?.name ?? f.polityId;
      lines.push(`  ${f.name} [id: ${f.id}] (${polityName}): ${f.personnel.reduce((n, p) => n + p.fit, 0)} troops in ${loc?.name ?? f.locationId} [id: ${f.locationId}]`);
    }
  }

  const settlements = world.map.provinces.flatMap((province) =>
    province.settlements.map((settlement) => ({ ...settlement, province })),
  );
  if (settlements.length > 0) {
    lines.push(`\nSETTLEMENTS (use settlement IDs, never province IDs, for siege workflows):`);
    for (const settlement of settlements) {
      lines.push(`  ${settlement.name} [id: ${settlement.id}] in ${settlement.province.name} [province-id: ${settlement.province.id}]`);
    }
  }

  // Key characters with IDs.
  const keyChars = world.characters.filter((c) => c.alive && c.id !== actorId).slice(0, 12);
  if (keyChars.length > 0) {
    lines.push(`\nKEY CHARACTERS:`);
    for (const c of keyChars) {
      const cPolity = world.map.polities.find((p) => p.id === c.polityId);
      const cLoc = world.map.provinces.find((p) => p.id === c.locationProvinceId);
      lines.push(`  ${c.name} [id: ${c.id}] (${cPolity?.name ?? "?"}), in ${cLoc?.name ?? c.locationProvinceId}${c.officeId ? `, office: ${c.officeId}` : ""}`);
    }
  }

  if (wars.length > 0) {
    const warDescs = wars.map((w) => {
      const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
      const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
      return `${pA} [${w.polityAId}] vs ${pB} [${w.polityBId}]`;
    });
    lines.push(`\nACTIVE WARS: ${warDescs.join("; ")}`);
  }
  if (battles.length > 0) {
    lines.push(`ACTIVE BATTLES: ${battles.map((b) => `${b.attackerForceIds.join(",")} vs ${b.participantForceIds.filter((id) => !b.attackerForceIds.includes(id)).join(",")}`).join("; ")}`);
  }
  if (sieges.length > 0) {
    lines.push(`ACTIVE SIEGES: ${sieges.map((s) => s.settlementId).join(", ")}`);
  }
  lines.push(`\nCURRENT STEP: ${world.elapsedStep}`);
  return lines.join("\n");
}

export function buildInterpretSystemPrompt(world: WorldState, actorId: string, context?: ResolutionPlayerContext): string {
  return `You are a historian and game master for Chronica, a strategy game set in the ancient world. Your task is to interpret a player's free-text order into structured intent.

${worldContext(world, actorId, context)}

Parse the order into:
- intent: a clear one-sentence summary of what the player wants to achieve (max 600 chars)
- targetIds: entity IDs that are the object of the action (provinces, characters, forces, polities)
- priorities: what the player values most about this action (up to 4, max 120 chars each)
- conditions: preconditions that must be true for the action to succeed (up to 4, max 160 chars each)
- proposedSteps: the concrete steps required to carry this out (1-4, max 160 chars each)
- risks: potential negative outcomes (up to 4, max 160 chars each)
- duration: estimated duration as a JSON object { "min": N, "max": N } where N is a positive integer (game seasons)

Be grounded: use actual province names, character names, and force names from the world context above. If the player references something that does not exist, note it as a risk.

BRACKET OVERRIDE SYNTAX: If the directive text is wrapped in square brackets [like this], it is a GM/author command. Parse it literally, set the intent to reflect exactly what was written, and note in the risks array that this is a GM override (no other risks needed). It still MUST have at least one proposedSteps item: use one concise literal execution step such as "Rename the raised army to Legio I." Never return proposedSteps: [].

EXISTING FORCES RULE: If the player's directive refers to any force already listed in FORCES UNDER COMMAND above — by name, pronoun ("my army", "my troops", "the legion"), or clear contextual reference — you MUST include that force's ID in targetIds. Do not treat a reference to an existing force as a request to raise a new one.

Respond as a JSON object with exactly these fields.`;
}

/**
 * The common mutation boundary for both player orders and director proposals.
 * Narrative prose is never allowed to stand in for a mutation: if an event
 * changes WorldState, its matching registered workflow has to be proposed.
 */
export const WORKFLOW_MUTATION_RULE = `WORKFLOW-MUTATION RULE (applies equally to player orders and AI-directed actions): Any action that changes world state MUST include the matching workflow invocation from the catalog in this response. This includes moving an army or general to another province, creating or changing a force, changing province control, starting or resolving a battle, changing a treasury or any account balance, and creating or changing any other tracked entity. Do not describe one of these effects as narrative-only. Use an empty workflow list only when the event has no world-state effect, or when no catalog workflow can represent it; in the latter case, state that it is a novel action rather than claiming the mutation occurred.`;

export function buildAssessSystemPrompt(world: WorldState, actorId: string, context?: ResolutionPlayerContext, inventedWorkflows: readonly RuntimeInventedWorkflow[] = []): string {
  return `You are an arbiter for Chronica, a strategy game set in the ancient world. Your task is to assess whether a player's order is feasible given their current situation.

${worldContext(world, actorId, context)}

${buildWorkflowCatalog(inventedWorkflows)}

${WORKFLOW_MUTATION_RULE}

PERSONAL / DOMESTIC ACTIONS: If the order is a personal, social, or domestic activity (hosting a dinner, spending time with family, playing a game, personal rituals, leisure, prayer, rest, etc.) with no world-state implications, it is always "feasible" with workflows: [] and needsAdjudication: false. Never mark these as "impossible" just because the broader political context is serious.

For each interpreted order, assess:
- interpretation: restate the intent concisely (max 300 chars)
- feasibility: one of "feasible" | "conditional" | "unlawful" | "impossible" | "uncertain"
  * feasible: straightforwardly achievable (includes all personal/social/domestic actions)
  * conditional: possible but requires specific conditions to be met
  * unlawful: violates a law, treaty, or institutional constraint
  * impossible: physically or logically impossible given current world state (NOT applicable to personal/domestic activities)
  * uncertain: insufficient information to assess
- obstacleIds: entity IDs of things that oppose or complicate the action
- dependencyActionIds: IDs of other ongoing actions this depends on
- estimatedSteps: estimated duration as a JSON object { "min": N, "max": N } where N is a positive integer (game seasons)
- workflows: an array of 0-4 registered workflow hints, each exactly { "actionId": "<registered action id>", "parameters": { ... } }. Use [] if genuinely novel or unmappable. Never use the singular workflow field, never use a tuple such as ["actionId", parameters], and never put a workflow inside another array.
- needsAdjudication: true if the outcome is uncertain and requires the full adjudication step

IMPORTANT: feasibility is informational. Even an "impossible" assessment goes to adjudication — you are not blocking the player, you are informing the consequences step.

BRACKET OVERRIDE SYNTAX: If the directive text is wrapped in square brackets [like this], always set feasibility to "feasible" and needsAdjudication to false regardless of circumstances. This is a GM command — skip all obstacle reasoning and do not flag it as impossible or conditional.

Respond as a JSON object with exactly these fields.`;
}

export function buildAdjudicateSystemPrompt(world: WorldState, actorId: string, context?: ResolutionPlayerContext, inventedWorkflows: readonly RuntimeInventedWorkflow[] = []): string {
  return `You are a consequence engine for Chronica, a strategy game set in the ancient world. Given an interpreted and assessed player order, decide its outcome.

${worldContext(world, actorId, context)}

${buildWorkflowCatalog(inventedWorkflows)}

${WORKFLOW_MUTATION_RULE}

PERSONAL / DOMESTIC ACTIONS — FAST PATH: If the order is a personal, social, or domestic activity (hosting a dinner, spending time with family, playing a game, personal rituals, leisure, prayer, rest, social gathering, etc.) with no world-state implications:
- Set outcome: "succeeds"
- Write a warm 2-3 sentence rationale describing what happened in vivid detail (e.g. "The dinner was a pleasant affair — the family gathered around the fire, and the game of Rens proved a lively distraction from the troubles of the day.")
- obstacles: [{ source: "competing demands", weight: "trivial", reason: "Minor scheduling and domestic logistics." }]
- deltas: [] (empty — no world state change)
- knowledgeVisibility: "private"
Do NOT mark personal activities as "impossible" or "fails" under any circumstances.

For the order, produce a verdict:
- outcome: "succeeds" | "partially_succeeds" | "fails" | "backfires" | "impossible"
- obstacles: array of { source, weight: "trivial"|"real"|"decisive", reason } — MUST be non-empty
- deltas: array of state changes. Rules:
  * CRITICAL: For any state change that has a matching workflow in the catalog above, you MUST use { kind: "workflow", invocation: { actionId, actorId, parameters } }. For actorId, use the actor character id shown in the ACTOR line above (e.g. "char-abc123") — this field must be a non-empty string, never null. Workflow deltas are the ONLY kind that actually mutate world state. Using material_effect instead of workflow for economic actions is a BUG — it does nothing.
  * { kind: "material_effect", effect: { sourceEntityId, magnitude: "minor"|"meaningful", rationale } } — use ONLY for reputation or narrative consequences that have NO matching workflow. This does NOT change game state and does NOT add or remove money.
  * { kind: "relationship_cause", holderCharacterId, subjectCharacterId, label, score: -100..100 } — for opinion shifts.
  * { kind: "knowledge_grant", characterId, factId } — for information reveals.
  * EXISTING FORCE RULE — CRITICAL: If the player already has forces listed in FORCES UNDER COMMAND and the order refers to one of those forces by name, pronoun ("my army", "my troops", "the legion"), or clear contextual reference, you MUST NOT use create_force. Identify the target force by its ID from the world context and use the matching workflow (army_change_name to rename it, merge_forces to combine two forces, move_force to relocate, disband_force to disband, raise_morale for morale boosts). If no workflow covers the specific action (e.g. adding reinforcements when there is no second force to merge), produce no workflow delta and describe the outcome narratively in the rationale instead — do NOT create a new force as a substitute.
  * For genuinely new "raise army" / "recruit troops" orders where the player has no existing force or is explicitly creating a brand-new one: use actionId "create_force" with polityId, locationProvinceId, name, size, kind ("infantry"|"cavalry"|"siege"|"naval"|"militia"|"mercenary"|"other"), and optionally payerAccountId (use the account-id from the ACCOUNTS section above if one exists; omit the field if no account is available).
  * BRACKET OVERRIDE SYNTAX: If the directive text is wrapped in square brackets [like this], it is a GM command. Set outcome to "succeeds", execute the action exactly as written using the closest matching workflow, and ignore all feasibility, realism, or world-state constraints. Never return "impossible" for a bracket override.
  * For "start battle" / "engage forces" orders: use actionId "start_battle" with attackingForceId and defendingForceId (both from world context) and a newly invented battleId (kebab-case slug, e.g. "battle-rome-carthage-261bc"). The battleId is the only parameter you may invent — all other IDs must come from world context.
  * For "remove gold" / "spend funds" / "pay" orders: use actionId "remove_gold" with accountId (from the ACCOUNTS section above), amount (integer), and reason (short description of the expenditure, max 240 chars).
  * ECONOMIC INCOME RULE — applies to ANY order involving: selling, trading, receiving payment, earning income, collecting funds, spoils, gifts, or any money gain: you MUST produce { kind: "workflow", invocation: { actionId: "add_gold", actorId: "<actor-id>", parameters: { accountId: "<actor-account-id>", amount: <plausible integer>, reason: "<brief description>" } } }. Use the account-id marked "(YOU)" in the ACCOUNTS section above. If no account is marked "(YOU)", still use add_gold with any account-id present — never fall back to material_effect for income. Do NOT invoke any military workflow for a peaceful economic transaction.
  * COMPOUND AUTHORIZATION ORDERS — CRITICAL: when the order both asks for authorization the actor currently lacks (a Senate/council vote, a superior's permission, a command grant) AND immediately acts on it in the same breath (e.g. "ask the Senate to let me invade the Boii and march my army in" / "get the assembly's backing and attack"), the player must experience this as ONE uninterrupted turn, never a wait across several real turns for the vote alone. Produce BOTH: (1) a sponsor_procedure delta for the authorization, with deadlineStep set to the CURRENT STEP shown above (never higher) so the political engine resolves it before this same turn ends, and linkedWorkflowId/linkedWorkflowParams set to whatever workflow the granted authority would itself invoke (e.g. assign_command); AND (2) a second delta for the actual follow-up action the order describes (e.g. move_force, start_battle), using the actor's own id as usual. It is fine and expected for (2) to depend on authority the actor does not yet hold — the Workflow Manager and the political engine decide within this same turn whether it actually goes through; you are not responsible for gating it. Reserve a longer deadlineStep (several steps out) only when the request is genuinely contested — active political rivals on record, a clearly divided institution, or comparable real opposition already established in world state — never merely because the request is significant. The number of Chronicle beats the deliberation gets (a single vote, or several rounds of debate) is a narrative choice made later and independent of how many turns this takes; it always takes this one turn.
- tacticalModifiers: array of tactical modifier proposals (empty if not a battle)
- timeCost: { min, max } in seasons
- rationale: explain the decisive factor (max 500 chars)
- knowledgeVisibility: choose exactly one of these strings: "public", "polity", or "private". Do not combine values, add qualifiers, or use any other value. When uncertain, use "private".

Do not output playerInvolvement. The server records the submitting player and actor after validating your verdict.

The AI's role is to determine consequences, not to grant wishes. Always name at least one real obstacle. A success can still have costs. If you use a workflow, ensure ALL parameter IDs are taken from the world context above — do not invent IDs.

Respond as a JSON object with exactly these fields.`;
}

export function buildNearEventsSystemPrompt(world: WorldState, polityId: string): string {
  const polity = world.map.polities.find((p) => p.id === polityId);
  const provinces = world.map.provinces.filter((p) => p.controllerPolityId === polityId);
  const forces = world.material.forces.filter((f) => f.polityId === polityId);
  const characters = world.characters.filter((c) => c.polityId === polityId && c.alive);
  const activeWars = world.conflicts.wars.filter((w) => w.polityAId === polityId || w.polityBId === polityId);
  const activeSieges = world.conflicts.sieges.filter((s) =>
    forces.some((f) => s.invadingForceIds.includes(f.id) || s.defendingForceIds.includes(f.id)),
  );

  const characterLines = characters.map((c) => {
    const parts = [`${c.name} (id: ${c.id})`];
    if (c.officeId) parts.push(`(office: ${c.officeId})`);
    return parts.join(" ");
  });

  return `You are a world simulation engine for Chronica. Generate plausible world events happening within the player's own polity (${polity?.name ?? polityId}) this season.

POLITY: ${polity?.name ?? polityId} (id: ${polityId})
TERRITORY (${provinces.length} provinces): ${provinces.map((p) => `${p.name} (id: ${p.id})`).join(", ")}
FORCES: ${forces.map((f) => `${f.name} (id: ${f.id}, ${f.personnel.reduce((n, p) => n + p.fit, 0)} fit troops, location: ${f.locationId})`).join(", ") || "none"}
KEY CHARACTERS: ${characterLines.join(", ") || "none"}
ACTIVE WARS: ${activeWars.length > 0 ? activeWars.map((w) => `vs ${w.polityAId === polityId ? w.polityBId : w.polityAId}`).join("; ") : "none"}
ACTIVE SIEGES: ${activeSieges.length > 0 ? activeSieges.map((s) => `siege at ${s.settlementId}`).join("; ") : "none"}
SEASON: step ${world.elapsedStep + 1}

Generate 3-6 events that cover a MIX of categories — military, political, economic, and character-level. More variety = richer chronicle. Each event is an EventProposal:
- triggerId: a short unique id (e.g. "near-revolt-1")
- causeFactIds: IDs of causal entities (province IDs, character IDs, force IDs from above)
- affectedScopeIds: IDs affected (province IDs, character IDs)
- visibility: "public" | "polity" | "private"
- salience: 0-1000 (importance — major battles: 800+, political shifts: 600-800, local unrest: 400-600, minor logistics: 0-400)
- actions: 1-2 ProposedInvocations from the workflow registry
- summary: one sentence describing what this event means in the world narrative (used by the Workflow Manager)

${buildWorkflowCatalog()}

IMPORTANT: Use only real entity IDs listed above. Mix event types: troop movements, supply issues, political maneuvering, character relationships, economic strain, local disputes.

Respond as JSON: { "events": [...] }`;
}

export function buildFarEventsSystemPrompt(world: WorldState, polityId: string): string {
  const polity = world.map.polities.find((p) => p.id === polityId);
  const provinces = world.map.provinces.filter((p) => p.controllerPolityId === polityId);
  const forces = world.material.forces.filter((f) => f.polityId === polityId);
  const characters = world.characters.filter((c) => c.polityId === polityId && c.alive);
  const activeWars = world.conflicts.wars.filter((w) => w.polityAId === polityId || w.polityBId === polityId);

  return `You are a world simulation engine for Chronica. Generate plausible events in the neighboring polity ${polity?.name ?? polityId} (id: ${polityId}).

TERRITORY: ${provinces.map((p) => `${p.name} (id: ${p.id})`).join(", ") || "unknown"}
FORCES: ${forces.map((f) => `${f.name} (id: ${f.id})`).join(", ") || "none"}
KEY CHARACTERS: ${characters.map((c) => `${c.name} (id: ${c.id})`).join(", ") || "none"}
ACTIVE WARS: ${activeWars.length > 0 ? activeWars.map((w) => `${w.polityAId} vs ${w.polityBId}`).join("; ") : "none"}
CURRENT STEP: ${world.elapsedStep + 1}

Generate 1-3 events covering at least 2 different categories (military, political, economic, or character-level). Each event:
- triggerId: short unique id (e.g. "far-${polityId}-1")
- causeFactIds: entity IDs from above
- affectedScopeIds: entity IDs from above
- visibility: "polity" or "public"
- salience: 0-600 (neighboring polity — significant but less granular than Near events)
- actions: 1 ProposedInvocation from the workflow registry
- summary: one sentence describing what this event means in the world narrative (used by the Workflow Manager)

${buildWorkflowCatalog()}

Focus on developments the player's polity would plausibly hear about: military movements, political coups, sieges, treaties.

Respond as JSON: { "events": [...] }`;
}

export function buildCoarseEventsSystemPrompt(world: WorldState, distantPolityIds: string[]): string {
  const polities = world.map.polities.filter((p) => distantPolityIds.includes(p.id));
  const activeWarsInvolving = world.conflicts.wars.filter((w) =>
    distantPolityIds.includes(w.polityAId) || distantPolityIds.includes(w.polityBId),
  );

  return `You are a world simulation engine for Chronica. Generate distant background events for these far-off polities: ${polities.map((p) => `${p.name} (id: ${p.id})`).join(", ")}.

ACTIVE WARS INVOLVING THESE POLITIES: ${activeWarsInvolving.length > 0 ? activeWarsInvolving.map((w) => `${w.polityAId} vs ${w.polityBId}`).join("; ") : "none"}
CURRENT STEP: ${world.elapsedStep + 1}

Generate 1-3 events total across all of them, coarse and imprecise. Include a MIX of event types — at least one political and one military event if possible.

Each event:
- triggerId: short unique id (e.g. "coarse-event-1")
- causeFactIds: polity IDs as strings (from the list above)
- affectedScopeIds: polity IDs
- visibility: "public"
- salience: 0-300 (very low — distant background rumours)
- actions: 1 ProposedInvocation (typically start_war, end_war, give_territory, or kill_character — use polity IDs, not province IDs)
- summary: one sentence describing what this event means in the world narrative (used by the Workflow Manager)

${buildWorkflowCatalog()}

These events are rumours and hearsay — they should feel incomplete and geopolitically distant. The player's character hears of them second-hand.

Respond as JSON: { "events": [...] }`;
}

export interface NarratorEntry {
  readonly body: string;
  readonly isPlayerAction: boolean;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null | undefined;
  readonly chainId?: string | null | undefined;
  readonly sourceDirector?: string | undefined;
  /** A server-selected cast. These are authoritative, not names to invent. */
  readonly characterMentions?: readonly { name: string; role: string }[] | undefined;
  /** Entry-intrinsic knowledge classification (character-sim phase 6); governs how hedged the prose must be. */
  readonly knowledgeStatus?: "confirmed" | "report" | "rumour" | "suspicion" | undefined;
  /** Depth tier (docs/14 Phase 4): how much space this entry earns. Defaults to "paragraph" when absent. */
  readonly depth?: "dispatch" | "paragraph" | "scene" | undefined;
  /** Structured, deterministic battle facts (docs/19 Phase 3) to write from directly instead of inventing tactics. */
  readonly battleBrief?: {
    readonly provinceName: string;
    readonly outcome: "attacker_victory" | "defender_victory" | "inconclusive";
    readonly attackerName: string;
    readonly defenderName: string;
    readonly attackerCommanderName: string | null;
    readonly defenderCommanderName: string | null;
    readonly attackerCasualties: number;
    readonly defenderCasualties: number;
    readonly retreated: readonly string[];
  } | undefined;
}

export function buildChronicleNarratorPrompt(
  entries: readonly NarratorEntry[],
  world: WorldState,
  actorId: string,
  knowledgebase: CharacterKnowledgebase | null,
): string {
  const actor = world.characters.find((c) => c.id === actorId);
  // World-state actor.name is authoritative for the current game; knowledgebase
  // canonicalName is a setup-time snapshot and can be stale.
  const actorName = actor?.name ?? knowledgebase?.canonicalName ?? "the player character";
  const polity = world.map.polities.find((p) => p.id === actor?.polityId);
  const polityName = polity?.name ?? "their polity";

  const characterBlock = [
    `PLAYER CHARACTER: ${actorName}`,
    knowledgebase?.role ? `ROLE: ${knowledgebase.role}` : null,
    knowledgebase?.culture ? `CULTURE: ${knowledgebase.culture}` : null,
    knowledgebase?.period ? `PERIOD: ${knowledgebase.period}` : null,
    knowledgebase?.authority.length ? `AUTHORITY: ${knowledgebase.authority.join("; ")}` : null,
    `POLITY: ${polityName}`,
    `CURRENT SEASON: ${world.elapsedStep + 1}`,
    knowledgebase?.biography
      ? `\nCHARACTER BACKGROUND (use for tone, titles, and cultural colour):\n${knowledgebase.biography.slice(0, 500)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Group entries by chain for context — entries in the same chain get a header note
  const chainMap = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const cid = entries[i]?.chainId;
    if (cid) {
      const arr = chainMap.get(cid) ?? [];
      arr.push(i);
      chainMap.set(cid, arr);
    }
  }

  const positionLabel = (pos: string | null | undefined): string => {
    switch (pos) {
      case "root": return "CAUSE";
      case "reaction": return "REACTION";
      case "spread": return "SPREAD";
      case "distant": return "DISTANT ECHO";
      case "pressure": return "OPEN PRESSURE";
      default: return "EVENT";
    }
  };

  const depthLabel = (depth: NarratorEntry["depth"]): string => {
    const { min, max } = chronicleWordBudget(depth ?? "paragraph");
    return `${depth ?? "paragraph"}, ${min}-${max} words`;
  };
  const battleBriefLine = (brief: NonNullable<NarratorEntry["battleBrief"]>): string => {
    const outcomeLabel = brief.outcome === "inconclusive" ? "inconclusive" : brief.outcome === "attacker_victory" ? `${brief.attackerName} prevails` : `${brief.defenderName} prevails`;
    return `\n   BATTLE BRIEF (deterministic facts — do not contradict or invent beyond these): province=${brief.provinceName}; ${brief.attackerName}${brief.attackerCommanderName ? ` (commanded by ${brief.attackerCommanderName})` : ""} vs ${brief.defenderName}${brief.defenderCommanderName ? ` (commanded by ${brief.defenderCommanderName})` : ""}; outcome=${outcomeLabel}; casualties: ${brief.attackerName} ${brief.attackerCasualties}, ${brief.defenderName} ${brief.defenderCasualties}${brief.retreated.length > 0 ? `; retreated: ${brief.retreated.join(", ")}` : ""}`;
  };

  const eventLines = entries.map((e, i) => {
    const chainGroup = e.chainId ? chainMap.get(e.chainId) : undefined;
    const chainNote = chainGroup && chainGroup.length > 1
      ? ` [chain: ${e.chainId?.slice(0, 8)} · entry ${(chainGroup.indexOf(i) + 1)}/${chainGroup.length}]`
      : "";
    const kind = e.isPlayerAction ? "PLAYER ACTION" : positionLabel(e.chainPosition);
    const cast = e.characterMentions && e.characterMentions.length > 0
      ? `\n   CAST: ${e.characterMentions.map((member) => `${member.name} (${member.role})`).join(", ")}`
      : "";
    const status = e.knowledgeStatus && e.knowledgeStatus !== "confirmed" ? ` [KNOWLEDGE: ${e.knowledgeStatus.toUpperCase()}]` : "";
    const depth = ` [DEPTH: ${depthLabel(e.depth)}]`;
    const brief = e.battleBrief ? battleBriefLine(e.battleBrief) : "";
    return `${i + 1}. [${kind}${chainNote}${status}${depth}] ${e.body}${brief}${cast}`;
  });

  return `You are the chronicler of Chronica. Rewrite raw event summaries as grounded, historically-flavoured prose for the official chronicle. Events within the same chain [chain: ...] are causally linked — write them so they flow as a coherent sequence. Each entry still stands alone.

${characterBlock}

EVENTS (${entries.length} total):
${eventLines.join("\n")}

Rewrite each event as chronicle prose, at the length its own [DEPTH: ...] tag states — a "dispatch" is a compact one- or two-sentence notice, a "paragraph" is one substantial paragraph, and a "scene" may run several paragraphs with atmosphere, named participants, and a decisive turn. Return EXACTLY ${entries.length} entries, one per input — do not add or remove entries. An entry with a BATTLE BRIEF must use exactly those facts (province, sides, commanders, outcome, casualties, retreats) and invent no tactic, unit, or result beyond them — atmosphere and phrasing are yours, the facts are not.

Rules:
- ALWAYS use proper names: refer to the player character as "${actorName}" (never substitute another name), name their polity "${polityName}", use real place names from the world above
- NEVER invent character names — if the raw summary does not name someone, use their title or role instead
- When an event has a CAST line, name that exact character in its paragraph and give them the stated dramatic role. Do not replace them with an anonymous senate, council, or faction.
- NEVER append meta-commentary to names or nouns (e.g. do NOT write "Gaius — historically accurate name" or "Rome (polity)"; write only the name itself)
- NEVER use generic placeholders ("an individual", "a person", "the realm") — name everything specifically
- Write in third person, past tense, historical style appropriate to the period
- Respect each entry's own [DEPTH: ...] word range; never pad a dispatch or truncate a scene to make lengths uniform
- Do not invent facts beyond what the raw summary (and, if present, its BATTLE BRIEF) gives you; use the character background for tone and cultural colour only
- The chronicle must reflect the ACTUAL outcome stated in the raw summary — do not upgrade a failure to a success or vice versa
- For REACTION and SPREAD entries: acknowledge what caused them without restating the root event in full
- For OPEN PRESSURE entries: end with something in motion — a question unanswered, a threat not yet resolved
- Write history for a reader, never a debug log: never use the words "AI", "planner", "planner score", "workflow", "internal state", or any other engine/implementation term
- An entry marked [KNOWLEDGE: REPORT] must read as something reported to the court, not witnessed firsthand — hedge it ("word reached...", "it was reported that...")
- An entry marked [KNOWLEDGE: RUMOUR] must read as unverified gossip, explicitly uncertain ("rumour holds...", "some claim...", with no confirmation offered)
- An entry marked [KNOWLEDGE: SUSPICION] must read as a suspicion, not a fact — attribute it to suspicion or fear, never assert it happened
- Never state a private motive, hidden deal, or undisclosed reason as settled fact — if the raw summary does not give you a visible cause, do not invent one

Respond as JSON: { "entries": [{ "body": "...", "isPlayerAction": true/false }] }`;
}
