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
    "7. Never invent an id. Every id you pass to a tool must have come from this prompt or from a tool result you received: a settlement id from inspect_province, a procedure id from the list of open procedures, a force id from the forces listed. A guessed id is the single most common reason a player's order is refused as inapplicable — inspect first, then act.",
    "8. The world is not only the player. Before you finish, the named characters listed below act on their own goals, pressures, and commitments, and the open threads move — whether or not the player's orders succeeded. A turn in which nothing happened except the player's own orders is an incomplete turn.",
    "8a. A power with no named leader still has interests. The engine gives one a leader the moment it is invaded, addressed, or at war — you will find them among the actors below, named after their power ('Boii leader') because the record does not yet know who they are. Give them their proper name with rename_character as soon as you decide who they are, then let them act for their people.",
    "9. A power does not ignore an army on its own ground. Every foreign force listed under UNRESOLVED THREADS is being answered by someone this turn: a levy raised, a border watched, an envoy sent, a war declared, or a deliberate decision to submit. If the power in question has no living named leader, create one with create_world_character and let them answer — a polity with no character cannot act, and its silence is your omission, not its policy.",
    "10. An army that meets no opposition fights no battle. start_battle requires at least one force on each side; if the ground you are taking is undefended, do not call it. Besiege the settlement (start_siege takes an empty defender list) or take the province with change_province_control, and say plainly that it was taken unopposed.",
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

  lines.push(`Provinces (name [id; controlling polity id]):`);
  for (const province of world.map.provinces.slice(0, MAX_PROVINCES_LISTED)) {
    lines.push(`  ${province.name} [${province.id}; ${province.controllerPolityId ?? "none"}]`);
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
