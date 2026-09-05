import "server-only";

import type {
  OrderDirective,
  ScenarioChronicleRules,
  ScenarioGovernmentRules,
  SelectedCharacter,
  WorldState,
} from "@chronica/shared";
import { deriveOpenThreads, renderOpenThreads } from "@chronica/shared";
import { buildPlayerResolutionContext, type ResolutionPlayerContext } from "./prompts";
import type { FormedNpcProposal } from "./character-agency";

// The Game Master's single coherent prompt (GM refactor, requirement 1).
//
// One agent, one prompt, one turn. It carries the scenario's constitution, the
// player's orders as *attempts*, an orientation on authoritative state,
// compact campaign memory, everything still unresolved, and the NPCs whose
// motives matter this turn. What it deliberately does not carry is the whole
// world: the agent has bounded read tools for that, so the prompt stays the
// same size whether the campaign is on its second turn or its two-hundredth.
//
// The tool definitions themselves are passed through the provider's tool API
// rather than described here, so the model cannot invent a tool by
// paraphrasing prose about one.

export interface GameMasterPromptInput {
  readonly world: WorldState;
  readonly actorCharacterId: string;
  readonly atStep: number;
  readonly directives: readonly { readonly id: string; readonly directive: OrderDirective }[];
  readonly selectedCharacters: readonly SelectedCharacter[];
  /** Concrete NPC workflow proposals already formed by character agency this turn (never executed here). */
  readonly npcProposals: readonly FormedNpcProposal[];
  readonly playerContext: ResolutionPlayerContext | undefined;
  readonly scenarioGovernment: ScenarioGovernmentRules | undefined;
  readonly scenarioChronicle: ScenarioChronicleRules | undefined;
}

const MAX_PROVINCES_LISTED = 60;
const MAX_NPCS_DETAILED = 8;

function constitution(input: GameMasterPromptInput): string {
  const lines: string[] = ["SCENARIO CONSTITUTION AND RULES"];
  const chronicle = input.scenarioChronicle;
  if (chronicle && chronicle.openingContext.length > 0) {
    lines.push(`Setting: ${chronicle.openingContext.slice(0, 1_200)}`);
  }
  if (chronicle && chronicle.openingTensions.length > 0) {
    lines.push(`Standing tensions: ${chronicle.openingTensions.join("; ")}`);
  }
  const government = input.scenarioGovernment;
  if (government && government.offices.length > 0) {
    lines.push("Offices and what they authorise:");
    for (const office of government.offices.slice(0, 16)) {
      lines.push(`  ${office.label} [id: ${office.id}] — authorises: ${office.authorisedActionIds.join(", ") || "nothing explicitly"}`);
    }
  }
  lines.push(
    "",
    "These rules bind you absolutely:",
    "1. You are the Game Master and the director of this world, but you are not its authority on what is true. The engine is. You act only by calling tools; anything you write outside a tool call changes nothing and is not recorded.",
    "2. A player order is an ATTEMPT, never a guaranteed outcome. Attempt it with the right tool and report exactly what the tool returned, success or refusal.",
    "3. When a tool refuses, its reason is the real reason. Report that reason. Never supply an institutional, legal, or dramatic explanation the engine did not give you.",
    "4. When an action tool succeeds, its effect is already complete and immediate. A raised force is named, commanded, located, and able to receive orders the moment create_force returns. Never describe a completed action as pending, provisional, or awaiting anything.",
    "5. Battles, deaths, inheritance, and procedure outcomes are decided by the deterministic engine, not by you. Start a battle and the engine fights it and tells you what happened; react to that result.",
    "6. If nothing in your tool list can do what an actor is attempting, and it is a real act with a real effect on the world, define it with define_action and then carry it out with invoke_defined_action. Describe only the change to world state; the engine validates it exactly as strictly as a built-in action and refuses anything that would leave the world inconsistent. What you define stays part of this campaign. Reserve request_capability for an attempt you genuinely cannot express as a change to the world at all: it records the attempt as unresolved and changes nothing.",
    "6a. Diplomacy is a first-class act, not a capability gap. A letter, an offer of alliance, a demand for tribute, a protest, an ultimatum — all of these go through send_diplomatic_message, which obliges the other power to answer and decides nothing on their behalf. Their reply is answer_diplomatic_message, taken in their own interest, and it may well be no. An accepted offer is carried out afterwards with the workflow that models it: sign_treaty, end_war, impose_tribute, arrange_marriage_alliance.",
    "6b. A message addressed to the player is never yours to answer. answer_diplomatic_message is refused outright if you name the player's own character as the answerer -- the engine enforces this, it is not a matter of judgment. Report an unanswered message to or from the player as an open thread awaiting the player's own reply; you may answer only on behalf of an AI-controlled power, and only after weighing that power's own interest.",
    "7. Never invent an id. Every id you pass to a tool must have come from this prompt or from a tool result you received: a settlement id from inspect_province, a procedure id from the list of open procedures, a force id from the forces listed. A guessed id is the single most common reason a player's order is refused as inapplicable — inspect first, then act.",
    "8. The world is not only the player. Before you finish, the named characters listed below act on their own goals, pressures, and commitments, and the open threads move — whether or not the player's orders succeeded. A turn in which nothing happened except the player's own orders is an incomplete turn.",
    "8a. A power with no named leader still has interests. The engine gives one a leader the moment it is invaded, addressed, or at war — you will find them among the actors below, named after their power ('Boii leader') because the record does not yet know who they are. Give them their proper name with rename_character as soon as you decide who they are, then let them act for their people.",
    "8b. ACTIVITY BUDGET: produce 3–8 distinct, state-backed developments for a normal active turn. Count a movement, levy, diplomatic message, battle/siege outcome, political procedure, or other tool-backed change once; do not pad the Chronicle with generic morale, weather, or 'the matter remains unresolved' notices. At least two developments must come from actors other than the player whenever the world contains other living actors. If conditions truly allow no further action, inspect the relevant forces, treasury, and open threads first, then record the concrete constraint rather than inventing a quiet turn.",
    "8c. REGIONAL REACTION: a foreign force on another power's controlled ground is an emergency. The defending power must react in the same turn with a valid, state-backed response appropriate to its means: raise or move a force, seek an ally, send an ultimatum, raid, fortify, open a siege, submit, or declare war. Do not merely narrate that the balance has changed.",
    "8d. ROMAN REPUBLIC: Rome has domestic politics as well as armies. When the Senate is listed, include a concrete Roman political, economic, social, religious, or military-command development at least every second season. Tie it to current state — an army abroad, a war, casualties, supply, treasury, legitimacy, an office, or an open procedure — and use political tools where a decision is being made. The Senate's scrutiny is not flavour; it must create a procedure, pressure, vote, appointment, factional consequence, or player-facing choice.",
    "9. A power does not ignore an army on its own ground. Every foreign force listed under UNRESOLVED THREADS is being answered by someone this turn: a levy raised, a border watched, an envoy sent, a war declared, or a deliberate decision to submit. If the power in question has no living named leader, create one with create_world_character and let them answer — a polity with no character cannot act, and its silence is your omission, not its policy.",
    "10. An army that meets no opposition fights no battle. start_battle requires at least one force on each side; if the ground you are taking is undefended, do not call it. Besiege the settlement (start_siege takes an empty defender list) or take the province with change_province_control, and say plainly that it was taken unopposed.",
    "10a. change_province_control is not a narrative shortcut: the engine itself now verifies the claim of 'unopposed.' It refuses the transfer unless a living force of the new controller already stands in that exact province AND no living force of any other power stands there too -- so it succeeds precisely when a battle or siege has actually cleared the ground, or when the province genuinely had no defender and your own force already walked in. It never succeeds by your saying so. A province still held by a real defending force can change hands only by winning a siege (start_siege, then end_siege with successfulCapture), by a decisive battle that breaks or removes the defender first, or by a diplomatic cession -- give_territory requires an authorization naming an accepted diplomatic message ceding exactly that ground between exactly those two powers; it has no other path.",
    "10b. A rejected ultimatum is not the end of the story. A power that has been refused, ignored, or countered without result more than once must be shown reacting in proportion: mobilising a force, moving it toward the disputed ground, seeking an ally, raiding, opening a siege, or declaring war -- never a repeat of the same protest with nothing behind it. The engine tracks repeated refusals on a thread and raises pressure on the refused power's own leader for exactly this reason; read that pressure and act on it.",
    "11. A tool that rejects your arguments has not decided anything. Correct them and call it again. Never report a rejected call as the outcome of a player's order until you have tried to fix it, and never repeat the tool's complaint about its own arguments as if it were a reason the world refused — the player reads what you report.",
    "12. Finish with finish_turn. Every event you report must cite a factRef from a tool result you actually received.",
  );
  return lines.join("\n");
}

function orientation(world: WorldState, actorCharacterId: string): string {
  const actor = world.characters.find((character) => character.id === actorCharacterId);
  const lines: string[] = ["AUTHORITATIVE WORLD STATE (orientation; use the inspect tools for detail)"];
  lines.push(`Current step: ${world.elapsedStep}.`);
  if (actor) {
    const polity = world.map.polities.find((candidate) => candidate.id === actor.polityId);
    const province = world.map.provinces.find((candidate) => candidate.id === actor.locationProvinceId);
    lines.push(
      `Player character: ${actor.name} [id: ${actor.id}] of ${polity?.name ?? "no polity"} [id: ${actor.polityId ?? "none"}], at ${province?.name ?? actor.locationProvinceId} [id: ${actor.locationProvinceId}], office ${actor.officeId ?? "none"}.`,
    );
  }

  lines.push("Polities:");
  for (const polity of world.map.polities) lines.push(`  ${polity.name} [id: ${polity.id}]`);

  // A settlement's authoritative id is the one start_siege (and any other
  // settlement-naming tool) actually accepts -- it is rarely the settlement's
  // plain name, lowercased. Listing it here, not only from inspect_province,
  // means a siege proposed the same turn a province first becomes relevant
  // never has to guess at an id that was never shown.
  lines.push(`Provinces (name [id; controlling polity id]; settlements as name [id]):`);
  for (const province of world.map.provinces.slice(0, MAX_PROVINCES_LISTED)) {
    const settlements = province.settlements.length > 0
      ? ` -- settlements: ${province.settlements.map((settlement) => `${settlement.name} [${settlement.id}]`).join(", ")}`
      : "";
    lines.push(`  ${province.name} [${province.id}; ${province.controllerPolityId ?? "none"}]${settlements}`);
  }
  if (world.map.provinces.length > MAX_PROVINCES_LISTED) {
    lines.push(`  ...and ${world.map.provinces.length - MAX_PROVINCES_LISTED} more; use inspect_province by id.`);
  }

  const actorPolityId = actor?.polityId ?? null;
  const accounts = world.material.accounts.filter(
    (account) =>
      account.visibility !== "private"
      || (actorPolityId !== null && account.owner.kind === "polity" && account.owner.id === actorPolityId)
      || (account.owner.kind === "character" && account.owner.id === actorCharacterId),
  );
  if (accounts.length > 0) {
    lines.push("Accounts you may name in economic tools:");
    for (const account of accounts.slice(0, 16)) {
      const ownerName = account.owner.kind === "character"
        ? world.characters.find((character) => character.id === account.owner.id)?.name ?? account.owner.id
        : world.map.polities.find((polity) => polity.id === account.owner.id)?.name ?? account.owner.id;
      lines.push(`  ${ownerName} [account-id: ${account.id}] balance ${account.balance} ${world.material.currency.name} (${account.status})`);
    }
  }

  // The institutions a motion can be brought before, and the eligibility
  // requirements a procedure may name. Both fail closed when an id does not
  // resolve -- an unknown institution makes the sponsor ineligible and an
  // unknown requirement refuses the procedure outright -- so a sponsorship
  // whose ids were guessed is rejected with nothing to show for it. These are
  // the only ids that may appear in those fields.
  if (world.material.institutions.length > 0) {
    lines.push("Institutions a motion may be brought before (institutionId must be one of these, or null):");
    for (const institution of world.material.institutions.slice(0, 12)) {
      const polity = world.map.polities.find((candidate) => candidate.id === institution.polityId);
      lines.push(`  ${institution.name} [id: ${institution.id}] of ${polity?.name ?? institution.polityId}`);
    }
  }
  if (world.material.eligibilityRequirements.length > 0) {
    lines.push("Eligibility requirements that exist (eligibilityRequirementIds may name only these; an empty list is fine):");
    for (const requirement of world.material.eligibilityRequirements.slice(0, 16)) {
      lines.push(`  ${requirement.label} [id: ${requirement.id}]`);
    }
  }

  // Political procedures already open, with their ids and stages. Without
  // this a vote, a nomination, or a cast ballot has no procedure to name, so
  // the id gets invented and the attempt is refused as inapplicable. A vote
  // can only be called on a procedure that already exists and that the caller
  // sponsors -- so if none of these fits, open one first.
  const openProcedures = world.material.politicalProcedures.filter(
    (procedure) => procedure.resolvedAtStep === null && procedure.outcome === null,
  );
  if (openProcedures.length > 0) {
    lines.push("Political procedures currently open (a vote or nomination must name one of these by id):");
    for (const procedure of openProcedures.slice(0, 12)) {
      const sponsor = world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.name ?? procedure.sponsorCharacterId;
      const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId)?.name;
      lines.push(
        `  ${procedure.type} [id: ${procedure.id}] sponsored by ${sponsor}, stage ${procedure.stage}, decided by ${procedure.resolutionMechanism}${institution ? ` before the ${institution}` : ""}.`,
      );
    }
  } else {
    lines.push("No political procedure is currently open. A vote cannot be called until one is opened with open_political_procedure and the caller is its sponsor.");
  }

  if (world.material.forces.length > 0) {
    lines.push("Forces on the map:");
    for (const force of world.material.forces.slice(0, 16)) {
      const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
      const polity = world.map.polities.find((candidate) => candidate.id === force.polityId);
      const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
      lines.push(`  ${force.name} [id: ${force.id}] of ${polity?.name ?? force.polityId}: ${fit} fit at ${province?.name ?? force.locationId} [id: ${force.locationId}]`);
    }
  }

  return lines.join("\n");
}

function campaignMemory(world: WorldState): string {
  const memory = world.campaignMemory;
  const lines: string[] = ["CAMPAIGN MEMORY (committed facts, not narration)"];
  if (memory.durableSummary.length > 0) {
    lines.push("What this campaign has been about:", memory.durableSummary);
  }
  if (memory.recentTurns.length > 0) {
    lines.push("Recent turns:");
    for (const turn of memory.recentTurns) {
      lines.push(`  Step ${turn.atStep}: ${turn.summary.replace(/\n/g, "\n    ")}`);
    }
  }
  if (memory.characterNotes.length > 0) {
    lines.push("Character threads worth keeping continuous:");
    for (const note of memory.characterNotes) {
      const name = world.characters.find((character) => character.id === note.characterId)?.name ?? note.characterId;
      lines.push(`  ${name}: ${note.note}`);
    }
  }
  if (lines.length === 1) lines.push("This is the first resolved turn; there is no prior record.");
  return lines.join("\n");
}

function npcContext(world: WorldState, selected: readonly SelectedCharacter[], actorCharacterId: string): string {
  const lines: string[] = [
    "ACTORS WHO MATTER THIS TURN",
    "These are the named characters the selection system judges relevant. They have their own motives and are not obliged to help the player. Use inspect_actor_memory for any of them before deciding what they do.",
  ];
  const commitmentsFor = (characterId: string) =>
    (world.commitments ?? []).filter((commitment) => commitment.promisorCharacterId === characterId && commitment.status === "pending");

  for (const entry of selected.slice(0, MAX_NPCS_DETAILED)) {
    const character = world.characters.find((candidate) => candidate.id === entry.characterId);
    if (!character || !character.alive || character.id === actorCharacterId) continue;
    const goals = (world.characterGoals ?? []).filter((goal) => goal.characterId === character.id && goal.status === "active").slice(0, 3);
    const plots = (world.characterPlots ?? []).filter((plot) => plot.characterId === character.id && plot.status === "active").slice(0, 2);
    const pressures = (world.characterPressures ?? []).filter((pressure) => pressure.characterId === character.id && pressure.status === "active").slice(0, 3);
    const beliefs = (world.characterBeliefs ?? [])
      .filter((belief) => belief.holderCharacterId === character.id && belief.status === "active" && belief.visibility !== "private")
      .slice(0, 2);
    const commitments = commitmentsFor(character.id).slice(0, 2);
    const recentIntents = (world.characterIntents ?? []).filter((intent) => intent.actorCharacterId === character.id).slice(-2);
    const province = world.map.provinces.find((candidate) => candidate.id === character.locationProvinceId);

    lines.push(
      `  ${character.name} [id: ${character.id}] (${entry.tier}; ${entry.reasons.slice(0, 2).join(", ") || "relevant"}) at ${province?.name ?? character.locationProvinceId}, office ${character.officeId ?? "none"}.`,
    );
    if (goals.length > 0) lines.push(`    wants: ${goals.map((goal) => `${goal.objective} (priority ${goal.priority})`).join("; ")}`);
    if (plots.length > 0) lines.push(`    plotting: ${plots.map((plot) => `${plot.objective} [${plot.stage}]${plot.nextIntendedMove ? `, next ${plot.nextIntendedMove}` : ""}`).join("; ")}`);
    if (pressures.length > 0) lines.push(`    under pressure: ${pressures.map((pressure) => `${pressure.kind} ${pressure.intensity} (${pressure.label})`).join("; ")}`);
    if (beliefs.length > 0) lines.push(`    believes: ${beliefs.map((belief) => belief.claim).join("; ")}`);
    if (commitments.length > 0) lines.push(`    owes: ${commitments.map((commitment) => commitment.description).join("; ")}`);
    if (recentIntents.length > 0) lines.push(`    last acted: ${recentIntents.map((intent) => `${intent.actionType} -> ${intent.status}`).join("; ")}`);
  }
  if (lines.length === 2) lines.push("  No named character other than the player is currently in the relevant set.");
  return lines.join("\n");
}

/**
 * Concrete NPC actions character agency already selected this turn, each
 * carrying the exact workflow and parameters `buildIntentInvocation` produced
 * -- not a description the Game Master must reconstruct into a tool call. The
 * bug this closes: an NPC's formed intention used to be summarized as loose
 * prose the agent could act on only by independently reinventing the same
 * workflow, which it rarely did, so a leader's own chosen action sat
 * "prepared" and then silently "deferred" turn after turn.
 */
function npcFormedIntentions(world: WorldState, proposals: readonly FormedNpcProposal[]): string {
  const lines: string[] = ["FORMED NPC INTENTIONS"];
  if (proposals.length === 0) {
    lines.push("  None this turn.");
    return lines.join("\n");
  }
  lines.push(
    "These are concrete actions already selected by character agency, not suggestions: each names the actor, what they intend, why, and the exact workflow and parameters to invoke. You must either call the named tool with these (or corrected) parameters, or leave it unexecuted -- and only when a conflicting validated event this turn, a deterministic tool refusal, or a clearly recorded deferral you report justifies that. Writing prose about the actor's intention is not executing it and satisfies nothing here.",
  );
  for (const proposal of proposals) {
    const actor = world.characters.find((character) => character.id === proposal.actorCharacterId);
    const actorName = actor?.name ?? proposal.actorCharacterId;
    lines.push(
      `  ${actorName} [id: ${proposal.actorCharacterId}] intends: ${proposal.actionType} -- ${proposal.rationale}`,
      `    invoke: ${proposal.invocation.actionId}(${JSON.stringify(proposal.invocation.parameters)}) [workflows considered: ${proposal.workflowIds.join(", ")}]`,
    );
  }
  return lines.join("\n");
}

function orders(input: GameMasterPromptInput): string {
  const actor = input.world.characters.find((character) => character.id === input.actorCharacterId);
  const lines: string[] = [
    `PLAYER ORDERS THIS TURN (attempts by ${actor?.name ?? input.actorCharacterId}, not outcomes)`,
  ];
  if (input.directives.length === 0) {
    lines.push("  None. The player issued no new orders; the world still moves.");
    return lines.join("\n");
  }
  for (const { id, directive } of input.directives) {
    if (directive.kind === "new") {
      lines.push(`  [${id}] "${directive.text}"`);
    } else if (directive.kind === "revise") {
      lines.push(`  [${id}] revise standing order ${directive.actionId}: "${directive.text}"`);
    } else {
      lines.push(`  [${id}] cancel standing order ${directive.actionId} (applied deterministically; report it as carried out)`);
    }
  }
  lines.push(
    "",
    "An order wrapped in [square brackets] is an out-of-character GM command from the player: carry it out literally with the closest matching tool.",
    "Every directive id above must appear exactly once in finish_turn's directiveOutcomes.",
  );
  return lines.join("\n");
}

export function buildGameMasterSystemPrompt(input: GameMasterPromptInput): string {
  const threads = deriveOpenThreads(input.world);
  return [
    "You are the Game Master of a historical simulation. You simulate one turn.",
    "",
    constitution(input),
    "",
    orientation(input.world, input.actorCharacterId),
    "",
    campaignMemory(input.world),
    "",
    "UNRESOLVED THREADS",
    renderOpenThreads(threads),
    "",
    npcContext(input.world, input.selectedCharacters, input.actorCharacterId),
    "",
    npcFormedIntentions(input.world, input.npcProposals),
    "",
    buildPlayerResolutionContext(input.world, input.playerContext).trim(),
    "",
    orders(input),
    "",
    "HOW TO WORK",
    "Read what you need with the inspect tools. Attempt each player order with the action tool that matches it. Then let the world answer: characters with their own goals, pressures, and commitments act on what just happened, and open threads move. Every effect must go through a tool. When you are done, call finish_turn with a report whose every event cites a factRef you were given.",
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}

export function buildGameMasterOpeningMessage(atStep: number): string {
  return `Simulate step ${atStep}. Begin by inspecting whatever you need, attempt the player's orders, let the world react, then call finish_turn.`;
}
