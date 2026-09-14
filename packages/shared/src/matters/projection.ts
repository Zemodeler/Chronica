import type { AuthorityIndex } from "../authority/authority-grant";
import { checkAuthority } from "../authority/authority-grant";
import type { Fact } from "../world/facts";
import { factsVisibleTo } from "../world/facts";
import type { WorldInstant } from "../world/instant";
import type { WorldState } from "../world/world-state";
import { resolveMatterRecipients, type MatterRecipient } from "./routing";
import type { MatterAuthorityRequirement, MatterDisposition, MatterEntityRef, WorldMatter, WorldMatterKind } from "./schema";

/**
 * The bounded per-character view `buildNpcAgentContext` hands an NPC agent
 * (docs/plans/ai-world-matters-runtime.md, "NPC integration" -> "Context
 * projection"): why the matter concerns this character, its timing state,
 * the entities and facts involved (facts filtered through the same
 * actor-relative visibility rules as everything else this character knows),
 * this character's relevant authority or its absence, any plan already
 * addressing it, and its last disposition if it has been offered before.
 */
export interface ProjectedMatter {
  readonly matterId: string;
  readonly kind: WorldMatterKind;
  readonly summary: string;
  /** This character's role in `resolveMatterRecipients`'s ladder, and why they were placed there -- never phrased as an instruction. */
  readonly role: MatterRecipient["role"];
  readonly whyRelevant: string;
  /** `WorldMatter.status` directly -- what is approaching, due, overdue, or resolved. */
  readonly timing: WorldMatter["status"];
  readonly urgency: number;
  readonly dueAt: WorldInstant | null;
  readonly knownEntities: readonly MatterEntityRef[];
  readonly knownFactSummaries: readonly string[];
  readonly relevantAuthority: readonly { readonly requirement: MatterAuthorityRequirement; readonly held: boolean }[];
  readonly existingPlanId: string | null;
  readonly lastDisposition: MatterDisposition | null;
}

const PROJECTABLE_STATUSES: ReadonlySet<WorldMatter["status"]> = new Set(["upcoming", "due", "overdue"]);

/** A private matter's ladder-found "interested"/"representative" roles are dropped -- only someone directly responsible for or affected by it (steps 1-3) may see a private matter at all, matching the doc's "Knowledge and visibility" rule that private household/personal-debt matters stay out of general context. */
function isVisibleRole(matter: WorldMatter, role: MatterRecipient["role"]): boolean {
  if (matter.visibility !== "private") return true;
  return role === "responsible" || role === "affected";
}

function buildProjectedMatter(
  world: WorldState,
  matter: WorldMatter,
  recipient: MatterRecipient,
  characterId: string,
  authorityIndex: AuthorityIndex,
  facts: readonly Fact[],
  atInstant: WorldInstant,
): ProjectedMatter {
  const observer = { kind: "character" as const, id: characterId };
  const visible = factsVisibleTo(facts, observer, atInstant);
  const visibleIds = new Set(visible.map((f) => f.id));
  const knownFactSummaries = matter.relevantFactIds.filter((id) => visibleIds.has(id)).map((id) => visible.find((f) => f.id === id)!.summary);

  const relevantAuthority = matter.requiredAuthority.map((requirement) => ({
    requirement,
    held: checkAuthority(authorityIndex, { holder: { kind: "character", id: characterId }, domain: requirement.domain, power: requirement.power, scope: requirement.scope }).authorized,
  }));

  return {
    matterId: matter.id,
    kind: matter.kind,
    summary: matter.summary,
    role: recipient.role,
    whyRelevant: recipient.reason,
    timing: matter.status,
    urgency: matter.urgency,
    dueAt: matter.dueAt,
    knownEntities: [matter.sourceRef, ...matter.responsibleScopeRefs, ...matter.stakeholderRefs],
    knownFactSummaries,
    relevantAuthority,
    existingPlanId: matter.standingPlanId,
    lastDisposition: matter.dispositions.length > 0 ? matter.dispositions[matter.dispositions.length - 1]! : null,
  };
}

/**
 * Bounded matters projection for one character (doc, "Context projection"):
 * every currently-live matter where `resolveMatterRecipients` names this
 * character, respecting `matter.visibility`, capped at `max` and prioritized
 * by urgency. `playerCharacterId` is omitted from the `resolveMatterRecipients`
 * call -- this function is only ever asked about a living NPC actor (never
 * the player; `buildNpcAgentContext` never runs for the player character), so
 * there is no player-exclusion decision for it to make here.
 */
export function projectMattersForCharacter(
  world: WorldState,
  characterId: string,
  authorityIndex: AuthorityIndex,
  facts: readonly Fact[],
  atInstant: WorldInstant,
  max = 5,
): readonly ProjectedMatter[] {
  const projected: ProjectedMatter[] = [];
  for (const matter of world.worldMatters ?? []) {
    if (!PROJECTABLE_STATUSES.has(matter.status)) continue;
    const { recipients } = resolveMatterRecipients(world, matter, authorityIndex, world.elapsedStep, null);
    const mine = recipients.find((r) => r.actorRef.kind === "character" && r.actorRef.id === characterId);
    if (mine === undefined || !isVisibleRole(matter, mine.role)) continue;
    projected.push(buildProjectedMatter(world, matter, mine, characterId, authorityIndex, facts, atInstant));
  }
  projected.sort((a, b) => b.urgency - a.urgency || a.matterId.localeCompare(b.matterId));
  return projected.slice(0, max);
}
