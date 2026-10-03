import { isDelivered, isStanding, negotiationBusinesses, readDepartments, type DiplomaticMessage, type Fact, type Office, type WorldState } from "@chronica/shared";
import { diplomaticAnswererOf } from "./letters";

/** Only the participant's own correspondence, including replies after their return journey. */
export function diplomaticMemory(world: WorldState, characterId: string): DiplomaticMessage[] {
  const day = world.instant.day;
  const character = world.characters.find((person) => person.id === characterId);
  const reader = readDepartments(world);
  const polityId = character?.polityId;
  const official = polityId != null && [...reader.rulers(polityId), ...reader.holding({ kind: "polity", id: polityId }, "foreign_letters").people, ...reader.holding({ kind: "polity", id: polityId }, "peace_talks").people].some((person) => person.id === characterId);
  return world.diplomacy.flatMap((message) => {
    if (message.fromCharacterId === characterId || (official && message.fromPolityId === polityId && message.visibility !== "private")) {
      const returnDay = (message.answeredAtStep ?? day) + Math.max(0, (message.deliveredOnDay ?? message.sentAtStep) - message.sentAtStep);
      // An answer still on the road is not yet known -- unless what it did is:
      // a people that gave itself up is public news before its letter is home.
      const theyEnded = world.map.polities.some((polity) => polity.id === message.toPolityId && !isStanding(polity));
      return [message.status === "answered" && day < returnDay && !theyEnded
        ? { ...message, status: "awaiting_reply" as const, answer: null, answerText: null, answeredAtStep: null }
        : message];
    }
    return (message.toCharacterId === characterId || (official && message.toPolityId === polityId && message.visibility !== "private")) && isDelivered(message, day) ? [message] : [];
  });
}

export function describeDiplomaticBusiness(world: WorldState, characterId: string): string[] {
  const memory = diplomaticMemory(world, characterId);
  const business = negotiationBusinesses(memory).sort((a, b) => b.latest.sentAtStep - a.latest.sentAtStep).slice(0, 6);
  if (business.length === 0) return [];
  const polityId = world.characters.find((person) => person.id === characterId)?.polityId;
  const lines = ["Diplomatic business already under way (do not restart it):"];
  for (const entry of business) {
    const owned = entry.messages.find((message) => message.fromPolityId === polityId);
    const addressed = entry.messages.find((message) => message.toPolityId === polityId);
    const owner = owned?.fromCharacterId ?? addressed?.toCharacterId ?? characterId;
    lines.push(`  - business [${entry.id}], issueKey "${entry.issueKey}"; our negotiator [${owner}]. Objective: ${entry.objective}. Stage: ${entry.stage}. Question: ${entry.question}.`);
    const agreed = entry.messages.filter((message) => message.answer === "accepted").at(-1);
    if (agreed !== undefined) lines.push(`    Already agreed in correspondence: ${agreed.terms} ${agreed.answerText ?? ""}${agreed.agreementId == null ? " (correspondence only; no binding treaty recorded)" : ` (agreement [${agreed.agreementId}])`}`);
    for (const message of entry.messages.slice(-3)) {
      const position = message.negotiation?.positions.map((row) => `${row.issue}: ${row.value}`).join("; ") ?? message.terms;
      lines.push(`    Letter [${message.id}] on day ${message.sentAtStep}, ${message.fromCharacterId === characterId ? "sent by them" : "received"}: ${position}. ${message.status === "awaiting_reply" ? `Awaiting reply${message.deliveredOnDay !== undefined && message.deliveredOnDay !== null && message.deliveredOnDay > world.instant.day ? `; on the road until day ${message.deliveredOnDay}` : ""}${message.replyDueByStep === null ? "" : `; due day ${message.replyDueByStep}${message.deliveredOnDay === undefined || message.deliveredOnDay === null || message.deliveredOnDay === message.sentAtStep ? "" : ` (the days allowed run from its arrival on day ${message.deliveredOnDay})`}`}.` : `${message.answer}: ${message.answerText ?? ""}`}`);
    }
  }
  return lines;
}

/** Routine correspondence interests its participants, not every office holder. */
export function routineDiplomaticFact(fact: Fact, world: WorldState): boolean {
  if (!["letter_sent", "letter_answered", "diplomatic_message", "diplomatic_message_sent", "diplomatic_response", "diplomacy"].includes(fact.kind)) return false;
  const parties = fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id);
  const related = world.diplomacy.filter((message) => parties.includes(message.fromPolityId) && parties.includes(message.toPolityId)
    && (fact.summary.includes(message.subject) || ((message.sentAtStep === fact.atStep || message.answeredAtStep === fact.atStep)
      && fact.affectedEntities.some((entity) => entity.kind === "character" && [message.fromCharacterId, message.toCharacterId].includes(entity.id)))));
  return related.length > 0 && related.every((message) => message.kind === "letter" && (message.proposes ?? []).length === 0 && (message.clauses ?? []).length === 0 && message.onRefusal == null);
}

export function ownsGovernmentAim(world: WorldState, characterId: string, polityId: string, offices: readonly Office[]): boolean {
  const reader = readDepartments(world);
  if (reader.rulers(polityId).some((person) => person.id === characterId)) return true;
  const outlook = world.polityOutlooks.find((entry) => entry.polityId === polityId);
  if (outlook === undefined) return false;
  const aim = `${outlook.primaryObjective} ${outlook.intentions.join(" ")} ${outlook.concerns.map((entry) => entry.label).join(" ")}`;
  const holds = (lever: "tax_roll" | "supply" | "levy" | "grain" | "peace_talks") => reader.holding({ kind: "polity", id: polityId }, lever).people.some((person) => person.id === characterId);
  return (/war|enemy|retake|take back|drive.*from|dominion/i.test(aim) && (holds("supply") || holds("levy") || world.material.forces.some((force) => force.commanderCharacterId === characterId && force.polityId === polityId)))
    || (/treasur|financ|debt|tax|money/i.test(aim) && holds("tax_roll"))
    || (/grain|hunger|food/i.test(aim) && holds("grain"))
    || (/peace|treaty|allian|negotiat|consult/i.test(aim) && (holds("peace_talks") || diplomaticAnswererOf(world, polityId, offices) === characterId));
}
