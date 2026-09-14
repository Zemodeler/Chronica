import type { WorldState } from "../world/world-state";
import { checkAuthority, type AuthorityIndex } from "../authority/authority-grant";
import type { MatterEntityRef, MatterOffer, WorldMatter } from "./schema";

/**
 * Phase 2 ("NPC routing", docs/plans/ai-world-matters-runtime.md, "3. Actor
 * selection"). Resolves who should receive a given `WorldMatter`, in the
 * doc's stated order:
 *
 * 1. living characters holding an authority named in `matter.requiredAuthority`;
 * 2. recorded responsibility read off the matter's own `sourceRef` (an
 *    office/seat holder, a force's commander, an account's owner, a
 *    household's head, or -- for a province/institution/polity source, which
 *    have no dedicated "leader" field of their own -- any living character
 *    whose `Character.polityId`/`officeId` record them as holding some
 *    office in the relevant polity);
 * 3. characters directly named as stakeholders, plus anyone currently
 *    located in the matter's own province;
 * 4. characters with an active goal/plot that names an entity this matter
 *    also names;
 * 5. a `role:"representative"` entry keyed by the source ref itself, when
 *    nothing above found a living character for an institutional-style
 *    source -- never a fabricated character.
 *
 * Each step only appends recipients not already found by an earlier step
 * (first-found role/score wins), and the player character is never placed
 * in the main list -- seeing it named as an authority-holder or recorded
 * office-holder (steps 1-2, the two senses of "responsible") instead lands
 * the matter's id in `playerResponsibleMatterIds`, per the doc's "Player
 * intervention" section: an autonomous NPC pass must never run the player.
 */

export interface MatterRecipient {
  readonly actorRef: MatterEntityRef;
  readonly role: MatterOffer["role"];
  /** Higher outranks lower; deliberately ladder-shaped (step order dominates any within-step tie). */
  readonly score: number;
  readonly reason: string;
}

export interface ResolveMatterRecipientsResult {
  readonly recipients: readonly MatterRecipient[];
  /** Matter ids (just this one, at most) the player's own responsibility routed here instead of into `recipients`. */
  readonly playerResponsibleMatterIds: readonly string[];
}

// One score band per ladder step -- documented constants, not magic numbers.
// Ordering matters more than the exact gap: any step-N score outranks every
// step-(N+1) score, deliberately, so an authority holder always outranks a
// merely-interested character regardless of how a caller re-sorts ties.
export const AUTHORITY_HOLDER_SCORE = 100;
export const RECORDED_RESPONSIBILITY_SCORE = 80;
export const DIRECTLY_AFFECTED_SCORE = 60;
export const INTERSECTING_INTEREST_SCORE = 40;
export const REPRESENTATIVE_SCORE = 20;

/** Source kinds an institutional star context can stand in for (doc, step 5). Household is deliberately excluded -- a private family concern has no institutional representative. */
const INSTITUTIONAL_SOURCE_KINDS: ReadonlySet<MatterEntityRef["kind"]> = new Set(["institution", "polity", "province", "force"]);

function livingCharacterIds(world: WorldState, ids: Iterable<string | null | undefined>): string[] {
  const found: string[] = [];
  for (const id of ids) {
    if (id === null || id === undefined) continue;
    const character = world.characters.find((c) => c.id === id);
    if (character?.alive) found.push(id);
  }
  return found;
}

/** Living characters recorded as holding some office within `polityId`, read off `Character.officeId`/`polityId` -- the compat mirror `OfficeSeat` itself documents, and the only WorldState-only way to answer "who holds office here" without also threading the scenario's `Office[]` list through this module. */
function officeHoldersInPolity(world: WorldState, polityId: string): string[] {
  return world.characters.filter((c) => c.alive && c.polityId === polityId && c.officeId !== null).map((c) => c.id);
}

/** Step 2: recorded responsibility read off the matter's own source. Handles the source kinds Phase 1's detectors actually produce (household, force, province, institution, polity) plus a few more the same style reaches (account, seat, office) for when later detectors start naming them. */
function recordedResponsibleCharacterIds(world: WorldState, sourceRef: MatterEntityRef): readonly string[] {
  switch (sourceRef.kind) {
    case "household": {
      const household = world.households.find((h) => h.id === sourceRef.id);
      return livingCharacterIds(world, [household?.headCharacterId ?? null]);
    }
    case "force": {
      const force = world.material.forces.find((f) => f.id === sourceRef.id);
      return livingCharacterIds(world, [force?.commanderCharacterId ?? null]);
    }
    case "account": {
      const account = world.material.accounts.find((a) => a.id === sourceRef.id);
      if (!account) return [];
      if (account.owner.kind === "character") return livingCharacterIds(world, [account.owner.id]);
      return officeHoldersInPolity(world, account.owner.id);
    }
    case "seat": {
      const seat = world.material.officeSeats.find((s) => s.id === sourceRef.id);
      return livingCharacterIds(world, [seat?.holderCharacterId ?? null]);
    }
    case "office": {
      const seatHolders = world.material.officeSeats.filter((s) => s.officeId === sourceRef.id && s.status === "held").map((s) => s.holderCharacterId);
      return livingCharacterIds(world, seatHolders);
    }
    case "province": {
      const province = world.map.provinces.find((p) => p.id === sourceRef.id);
      return province?.controllerPolityId ? officeHoldersInPolity(world, province.controllerPolityId) : [];
    }
    case "institution": {
      const institution = world.material.institutions.find((i) => i.id === sourceRef.id);
      return institution ? officeHoldersInPolity(world, institution.polityId) : [];
    }
    case "polity":
      return officeHoldersInPolity(world, sourceRef.id);
    default:
      return [];
  }
}

export function resolveMatterRecipients(
  world: WorldState,
  matter: WorldMatter,
  authorityIndex: AuthorityIndex,
  atStep: number,
  playerCharacterId?: string | null,
): ResolveMatterRecipientsResult {
  const recipients: MatterRecipient[] = [];
  const seenKeys = new Set<string>();
  const playerResponsibleMatterIds: string[] = [];
  void atStep; // accepted for interface parity with the doc's stated signature; the authority index is already resolved as of this step.

  const key = (ref: MatterEntityRef) => `${ref.kind}:${ref.id}`;
  const isPlayer = (characterId: string) => playerCharacterId != null && characterId === playerCharacterId;

  const add = (ref: MatterEntityRef, role: MatterRecipient["role"], score: number, reason: string, routeToPlayerList: boolean): void => {
    if (ref.kind === "character") {
      if (isPlayer(ref.id)) {
        if (routeToPlayerList && !playerResponsibleMatterIds.includes(matter.id)) playerResponsibleMatterIds.push(matter.id);
        return;
      }
      const character = world.characters.find((c) => c.id === ref.id);
      if (!character?.alive) return;
    }
    if (seenKeys.has(key(ref))) return;
    seenKeys.add(key(ref));
    recipients.push({ actorRef: ref, role, score, reason });
  };

  // Step 1: living characters holding a named authority.
  for (const requirement of matter.requiredAuthority) {
    for (const character of world.characters) {
      if (!character.alive) continue;
      const result = checkAuthority(authorityIndex, {
        holder: { kind: "character", id: character.id },
        domain: requirement.domain,
        power: requirement.power,
        scope: requirement.scope,
      });
      if (result.authorized) {
        add(
          { kind: "character", id: character.id },
          "responsible",
          AUTHORITY_HOLDER_SCORE,
          `Holds ${requirement.power} authority in the ${requirement.domain} domain over ${requirement.scope.kind}:${requirement.scope.id}.`,
          true,
        );
      }
    }
  }

  // Step 2: recorded responsibility from the source itself.
  for (const characterId of recordedResponsibleCharacterIds(world, matter.sourceRef)) {
    add(
      { kind: "character", id: characterId },
      "responsible",
      RECORDED_RESPONSIBILITY_SCORE,
      `Recorded responsibility for ${matter.sourceRef.kind}:${matter.sourceRef.id}.`,
      true,
    );
  }

  // Step 3: directly affected -- named stakeholders, plus anyone present where the matter is centered.
  for (const ref of matter.stakeholderRefs) {
    if (ref.kind === "character") add(ref, "affected", DIRECTLY_AFFECTED_SCORE, "Named as a stakeholder in this matter.", false);
  }
  if (matter.provinceId !== null) {
    for (const character of world.characters) {
      if (character.alive && character.locationProvinceId === matter.provinceId) {
        add({ kind: "character", id: character.id }, "affected", DIRECTLY_AFFECTED_SCORE, `Present in ${matter.provinceId}, where this matter is centered.`, false);
      }
    }
  }

  // Step 4: intersecting interest -- an active goal or plot names an entity this matter also names.
  const namedEntityIds = new Set<string>([matter.sourceRef.id, ...matter.responsibleScopeRefs.map((r) => r.id), ...matter.stakeholderRefs.map((r) => r.id)]);
  for (const goal of world.characterGoals ?? []) {
    if (goal.status !== "active") continue;
    if (goal.targetEntityIds.some((id) => namedEntityIds.has(id))) {
      add({ kind: "character", id: goal.characterId }, "interested", INTERSECTING_INTEREST_SCORE, `An active goal ("${goal.objective}") names an entity this matter concerns.`, false);
    }
  }
  for (const plot of world.characterPlots ?? []) {
    if (plot.status !== "active") continue;
    const plotEntityIds = [...plot.participantIds, ...plot.allyIds, ...plot.targetIds];
    if (plotEntityIds.some((id) => namedEntityIds.has(id))) {
      add({ kind: "character", id: plot.characterId }, "interested", INTERSECTING_INTEREST_SCORE, `An active plot ("${plot.objective}") involves an entity this matter concerns.`, false);
    }
  }

  // Step 5: star-context representative fallback -- only when nothing living was found above, and only for an institutional-style source.
  const foundLivingCharacter = recipients.some((r) => r.actorRef.kind === "character");
  if (!foundLivingCharacter && INSTITUTIONAL_SOURCE_KINDS.has(matter.sourceRef.kind)) {
    add(
      matter.sourceRef,
      "representative",
      REPRESENTATIVE_SCORE,
      `No living representative found for ${matter.sourceRef.kind}:${matter.sourceRef.id}; routed to its star context.`,
      false,
    );
  }

  recipients.sort((a, b) => b.score - a.score || a.actorRef.id.localeCompare(b.actorRef.id));
  return { recipients, playerResponsibleMatterIds };
}

const PRIORITY_STATUSES: ReadonlySet<WorldMatter["status"]> = new Set(["due", "overdue"]);
/** "due" outranks "overdue" is wrong on its face -- overdue is the more urgent state -- so overdue-first, then due, mirrors `WorldMatter.status`'s own escalation direction. */
const STATUS_RANK: Readonly<Record<WorldMatter["status"], number>> = { overdue: 0, due: 1, upcoming: 2, addressed: 3, cancelled: 4 };

export interface MatterPriorityActorsResult {
  readonly priorityCharacterIds: readonly string[];
  readonly reasons: ReadonlyMap<string, readonly string[]>;
  readonly playerResponsibleMatterIds: readonly string[];
}

/**
 * The merged, deduplicated, budget-capped priority list `selectRelevantActors`
 * folds in (doc, "Selection budgets"): every `due`/`overdue` matter's
 * `resolveMatterRecipients` result, collapsed so one character facing five
 * matters gets one entry with all five reasons, ranked by matter urgency/
 * review order, with the same round-robin rotation
 * `world-development-scheduler.ts`'s `selectDevelopmentActors` used to keep
 * one high-urgency backlog from starving every other character's turn.
 *
 * Deviation from the doc's literal signature: `authorityIndex` is added --
 * `resolveMatterRecipients` cannot run without it, and the doc's own listed
 * parameters omitted it.
 */
export function matterPriorityActors(
  world: WorldState,
  authorityIndex: AuthorityIndex,
  atStep: number,
  playerCharacterId: string,
  maxReserved = 3,
): MatterPriorityActorsResult {
  const matters = (world.worldMatters ?? [])
    .filter((m) => PRIORITY_STATUSES.has(m.status))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.nextReviewAt.day - b.nextReviewAt.day || a.nextReviewAt.minute - b.nextReviewAt.minute || a.id.localeCompare(b.id));

  const reasons = new Map<string, string[]>();
  const bestScore = new Map<string, number>();
  const order: string[] = [];
  const playerResponsibleMatterIds: string[] = [];

  for (const matter of matters) {
    const { recipients, playerResponsibleMatterIds: playerIds } = resolveMatterRecipients(world, matter, authorityIndex, atStep, playerCharacterId);
    playerResponsibleMatterIds.push(...playerIds);
    for (const recipient of recipients) {
      if (recipient.actorRef.kind !== "character") continue; // representative-fallback entries have no character to prioritize
      const characterId = recipient.actorRef.id;
      if (!reasons.has(characterId)) {
        reasons.set(characterId, []);
        order.push(characterId);
      }
      reasons.get(characterId)!.push(`${matter.summary} (${recipient.reason})`);
      bestScore.set(characterId, Math.max(bestScore.get(characterId) ?? 0, recipient.score));
    }
  }

  const ranked = [...order].sort((a, b) => (bestScore.get(b) ?? 0) - (bestScore.get(a) ?? 0) || a.localeCompare(b));
  const offset = ranked.length === 0 ? 0 : (atStep * 3) % ranked.length;
  const rotated = [...ranked.slice(offset), ...ranked.slice(0, offset)];
  const priorityCharacterIds = rotated.slice(0, maxReserved);

  return { priorityCharacterIds, reasons, playerResponsibleMatterIds: [...new Set(playerResponsibleMatterIds)] };
}
