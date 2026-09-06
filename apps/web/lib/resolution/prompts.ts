import "server-only";

import type { WorldState } from "@chronica/shared";
import { chronicleWordBudget } from "@chronica/shared";
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

// The interpret/assess/adjudicate chain and the Near/Far/Coarse event
// proposers were retired with the director committee: one Game Master now
// reads the world through bounded tools and acts through registered
// workflows. What survives here is the shared player-context block above,
// which the Game Master prompt still uses, and the Chronicle narrator below,
// which is downstream of committed facts and never decides anything.

export interface NarratorEntry {
  readonly body: string;
  readonly isPlayerAction: boolean;
  /**
   * The entry's facts are complete and final. The rewrite may give it voice
   * and consequence; it may not make a finished thing unfinished, a success
   * uncertain, or a failure a success.
   */
  readonly outcomeLocked?: boolean | undefined;
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
    const lock = e.outcomeLocked ? " [OUTCOME: SETTLED — these facts are complete and final]" : "";
    const cast = e.characterMentions && e.characterMentions.length > 0
      ? `\n   CAST: ${e.characterMentions.map((member) => `${member.name} (${member.role})`).join(", ")}`
      : "";
    const status = e.knowledgeStatus && e.knowledgeStatus !== "confirmed" ? ` [KNOWLEDGE: ${e.knowledgeStatus.toUpperCase()}]` : "";
    const depth = ` [DEPTH: ${depthLabel(e.depth)}]`;
    const brief = e.battleBrief ? battleBriefLine(e.battleBrief) : "";
    return `${i + 1}. [${kind}${chainNote}${status}${depth}${lock}] ${e.body}${brief}${cast}`;
  });

  return `You are the chronicler of Chronica: a historian who can bring recorded events to life through atmosphere, character expression, and scenes, with the recorded outcomes already known.

You are not an assistant and not a narrator addressing anyone. You never acknowledge an order, never confirm receipt of an instruction, never explain the record to its reader. You write entries in a campaign history: what happened, why it happened, how others answered it, what held and what failed, and what the situation now is.

${characterBlock}

EVENTS (${entries.length} total):
${eventLines.join("\n")}

Rewrite each event as one chronicle entry, at the length its own [DEPTH: ...] tag states — a "dispatch" is a compact one- or two-sentence notice, a "paragraph" is one substantial paragraph, and a "scene" may run several paragraphs with atmosphere, named participants, and a decisive turn. Return EXACTLY ${entries.length} entries, one per input, in the same order — do not add, merge, reorder, or remove entries.

VOICE — this is what the record must sound like:
- Third person and past tense in narration. Direct speech may use first or second person when the source records it. No address to the reader and no commentary on the entry itself.
- An order is never merely acknowledged. It is adjudicated and then reported as a settled historical outcome: not "X sponsors a deliberation", but what X brought before whom, what it did to the standing of the parties, and what it left unresolved.
- Bring the recorded moment into focus with restrained sensory detail, pacing, and visible gestures appropriate to the setting. Do not invent a messenger, meeting, journey, weather obstacle, or other intermediate event to explain an outcome.
- Rival states, factions, and named characters act from their own interests. They are never described as reacting merely to the player, and never as waiting for the player.
- Preserve genuine uncertainty. What was not observed is reported as reported, and unresolved contests stay unresolved.
- End with a supported consequence, an unresolved choice, or a telling image. A quiet recovery may simply close; never manufacture a cliffhanger or a new crisis to satisfy a formula.

CREATIVE FREEDOM — presentation can be rich while consequences stay grounded:
- A scene may linger on pauses, the texture of the surroundings, restrained gestures, and contrasting reactions already supported by the event. A dispatch stays concise. Vary the rhythm and avoid decorating every entry in the same way.
- Atmospheric details are illustrative staging, never evidence of a new possession, participant, relationship, resource, location, injury, or advantage. Do not invent the player's actions, feelings, or decisions.
- Use recorded quotations when available, preserving their meaning and speaker. Without recorded speech, use indirect narration of the established act; never invent an oath, bargain, confession, accusation, secret, or promise as dialogue.
- Reports and rumours may have distinct perspectives only when the source supplies them. Preserve attribution and uncertainty; do not invent witnesses or leak private motives to make a scene interesting.
- Lasting revelations, commitments, relationships, and material changes must already be in the supplied events. Your prose is presentation and will not create new simulation facts. If a dramatic idea requires an unrecorded consequence, leave it out.

HEADLINE — every entry also gets a "headline": a short quasi-historical title of at most 8 words, in Title Case, naming the event the way a chapter heading or a textbook margin note would ("The Refusal at Messana", "Legio II Takes the Field"). Never a full sentence, never trailing punctuation, never a truncated fragment, never an identifier.

FACTUAL DISCIPLINE — the facts are not yours:
- Do not invent consequential facts beyond the raw summary (and its BATTLE BRIEF, if present). The creative freedom above permits illustrative atmosphere only. The character background supplies tone and cultural colour only.
- The entry must reflect the ACTUAL outcome given — never upgrade a failure into a success, or a success into an attempt.
- [OUTCOME: SETTLED] means every fact in that entry is complete and final. Something raised exists, is named, is commanded, and can be ordered. Never write it as pending, provisional, awaiting confirmation, or still forming.
- An entry with a BATTLE BRIEF must use exactly those facts (province, sides, commanders, outcome, casualties, retreats) and invent no tactic, unit, or result beyond them.
- Never state a private motive, hidden deal, or undisclosed reason as settled fact — if the summary gives you no visible cause, give none.
- ALWAYS use proper names: the player character is "${actorName}" (never substitute another name), their polity is "${polityName}", places take their real names from the world above.
- NEVER invent character names — where the summary names no one, use their office or role.
- When an event has a CAST line, name that exact character and give them the stated role. Do not replace them with an anonymous senate, council, or faction.
- NEVER use generic placeholders ("an individual", "a person", "the realm"), and never append meta-commentary to a name (not "Rome (polity)", not "Gaius — historically accurate"; the name alone).
- Write history, never a log: never use the words "AI", "planner", "workflow", "procedure type", "parameter", "internal state", "world state", or any other engine term, and never let an identifier written with underscores (like council_deliberation) appear — say what it is in ordinary words ("a deliberation before the Senate").
- Events sharing a [chain: ...] tag are causally linked: write them so they read as one sequence, each still standing alone. For REACTION and SPREAD entries, acknowledge the cause without restating it in full. For OPEN PRESSURE entries, leave the matter visibly in motion.
- [KNOWLEDGE: REPORT] reads as something reported to the court, not witnessed ("word reached...", "it was reported that..."). [KNOWLEDGE: RUMOUR] reads as unverified gossip, explicitly uncertain, with no confirmation offered. [KNOWLEDGE: SUSPICION] is attributed to suspicion or fear and never asserted as having happened.
- Respect each entry's own [DEPTH: ...] word range; never pad a dispatch or truncate a scene to make lengths uniform.

Respond as JSON: { "entries": [{ "headline": "...", "body": "...", "isPlayerAction": true/false }] }`;
}
