import {
  PolityAgreementKindSchema,
  normalizeName,
  spelledAlike,
  whoIsNamed,
  type OrderGoal,
  type OrderGoalProposal,
  type OrderWorkRef,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";

/**
 * What an act of an order is for, read from the act itself.
 *
 * A march says where the army is going; a letter, that an answer is wanted; a
 * vote, that it should pass. These are the goals the model never needs to
 * name, because the act already does -- and they are read from the act even
 * when the world refused it, so "carry Legio I to Messana" refused for want of
 * the Senate's leave still wants Legio I in Messana once the leave comes.
 *
 * `resolve` turns an act's refs into ids: handles made in the same answer,
 * then names.
 */
export function goalsOfAct(
  world: WorldState,
  delta: WorldDelta,
  work: readonly OrderWorkRef[],
  resolve: (ref: string, kind: RefKind) => string | null,
): OrderGoal[] {
  const madeOf = (kind: OrderWorkRef["kind"]): string | null => work.find((ref) => ref.kind === kind)?.id ?? null;
  switch (delta.op) {
    case "force_reinforce": {
      const forceId = resolve(delta.forceRef, "force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      return force === undefined || forceId === null ? [] : [{ kind: "force_strength", forceId, minimum: force.personnel.reduce((sum, category) => sum + category.fit, 0) + delta.men }];
    }
    case "service_contract_open": {
      const contractId = madeOf("contract");
      return contractId === null ? [] : [{ kind: "contract_active", contractId }];
    }
    case "force_modify": {
      if (delta.locationId === undefined) return [];
      const forceId = resolve(delta.forceRef, "force");
      return forceId === null ? [] : [{ kind: "force_at", forceId, provinceId: delta.locationId }];
    }
    case "project_create": {
      const outcome = delta.completionOutcome;
      if (outcome?.kind === "force_move" && outcome.forceRef !== null && outcome.provinceId !== null) {
        const forceId = resolve(outcome.forceRef, "force");
        if (forceId !== null) return [{ kind: "force_at", forceId, provinceId: outcome.provinceId }];
      }
      const projectId = madeOf("project");
      return projectId === null ? [] : [{ kind: "project_done", projectId }];
    }
    case "political_procedure_open": {
      const procedureId = madeOf("procedure");
      return procedureId === null ? [] : [{ kind: "procedure_passed", procedureId }];
    }
    case "diplomatic_message_send": {
      const messageId = madeOf("message");
      return messageId === null ? [] : [{ kind: "answer_from", messageId }];
    }
    case "audit_open": {
      const auditId = madeOf("audit");
      return auditId === null ? [] : [{ kind: "audit_finding", auditId }];
    }
    case "covert_plot_open": {
      const plotId = madeOf("plot");
      return plotId === null ? [] : [{ kind: "plot_outcome", plotId }];
    }
    case "force_create": {
      const id = madeOf("force");
      return id === null ? [] : [{ kind: "exists", of: "force", id }];
    }
    case "generic_entity_create": {
      // A pursuit is an intention, not a thing made: it stands whether or not
      // anything is done, so it can be nobody's goal.
      if (delta.kind === "pursuit") return [];
      const id = madeOf("entity");
      return id === null ? [] : [{ kind: "exists", of: "entity", id }];
    }
    case "money_transfer": {
      if (delta.toAccountRef === null) return [];
      const toAccountId = resolve(delta.toAccountRef, "account");
      const fromAccountId = resolve(delta.fromAccountRef, "account");
      return toAccountId === null ? [] : [{ kind: "paid", toAccountId, fromAccountId, amount: delta.amount, sinceStep: world.elapsedStep }];
    }
    case "settlement_control_set": {
      const polityId = delta.toPolityRef === null ? null : resolve(delta.toPolityRef, "polity");
      const province = world.map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === delta.settlementId));
      const provinceId = delta.inProvinceId ?? province?.id ?? null;
      return polityId === null || provinceId === null ? [] : [{ kind: "control", provinceId, settlementId: delta.settlementId, polityId }];
    }
    case "siege_lay": {
      // A siege is laid to take the city: the order is done when it is held.
      const forceId = resolve(delta.forceRef, "force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      // With no city named, the strongholds of the province the army stands in.
      const settlementId = delta.settlementId ?? null;
      const provinceId = settlementId === null ? force?.locationId : world.map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === settlementId))?.id;
      return force === undefined || provinceId === undefined ? [] : [{ kind: "control", provinceId, settlementId, polityId: force.polityId }];
    }
    case "diplomatic_message_answer": {
      // Answering is what was asked: the letter put to us is settled once answered.
      return world.diplomacy.some((message) => message.id === delta.messageRef) ? [{ kind: "answer_from", messageId: delta.messageRef }] : [];
    }
    case "province_control_set": {
      const polityId = resolve(delta.toPolityRef, "polity");
      return polityId === null ? [] : [{ kind: "control", provinceId: delta.provinceId, settlementId: null, polityId }];
    }
    default:
      return [];
  }
}

/** What the orchestrator named a goal by, resolved; null when any of it names nothing. */
export function resolveGoal(world: WorldState, proposal: OrderGoalProposal, actorPolityId: string | null, resolve: (ref: string, kind: RefKind) => string | null): OrderGoal | null {
  const at = (kind: RefKind): string | null => (proposal.at === null ? null : resolve(proposal.at, kind));
  switch (proposal.kind) {
    case "force_strength": {
      const forceId = resolve(proposal.ref, "force");
      return forceId === null || proposal.amount === null ? null : { kind: "force_strength", forceId, minimum: Math.ceil(proposal.amount) };
    }
    case "force_at": {
      const forceId = resolve(proposal.ref, "force");
      const provinceId = at("province");
      return forceId === null || provinceId === null ? null : { kind: "force_at", forceId, provinceId };
    }
    case "control": {
      const polityId = resolve(proposal.ref, "polity");
      const provinceId = at("province");
      return provinceId === null || polityId === null ? null : { kind: "control", provinceId, settlementId: null, polityId };
    }
    case "agreement_open": {
      const withPolityId = resolve(proposal.ref, "polity");
      const agreementKind = PolityAgreementKindSchema.safeParse(proposal.at);
      return withPolityId === null || actorPolityId === null || !agreementKind.success ? null : { kind: "agreement_open", agreementKind: agreementKind.data, polityId: actorPolityId, withPolityId };
    }
    case "seat_held": {
      const characterId = resolve(proposal.ref, "character");
      const officeId = at("office");
      return officeId === null || characterId === null ? null : { kind: "seat_held", officeId, characterId };
    }
    case "paid": {
      const toAccountId = resolve(proposal.ref, "account");
      return toAccountId === null || proposal.amount === null ? null : { kind: "paid", toAccountId, fromAccountId: null, amount: proposal.amount, sinceStep: world.elapsedStep };
    }
  }
}

export type RefKind = "force" | "province" | "polity" | "account" | "character" | "office";

/**
 * A ref as the model writes it, to an id: a handle made in the same answer,
 * an id that exists, or a name that names exactly one thing.
 */
export function refResolver(world: WorldState, assignedIds: ReadonlyMap<string, string>): (ref: string, kind: RefKind) => string | null {
  return (ref, kind) => {
    if (ref.startsWith("local:")) return assignedIds.get(ref.slice("local:".length)) ?? null;
    const named = <T extends { readonly id: string; readonly name: string }>(list: readonly T[]): string | null => {
      if (list.some((entry) => entry.id === ref)) return ref;
      const spoken = ref.replace(/[-_]+/g, " ");
      const matches = list.filter((entry) => normalizeName(entry.name) === normalizeName(spoken) || spelledAlike(entry.name, spoken));
      return matches.length === 1 ? matches[0]!.id : null;
    };
    switch (kind) {
      case "force":
        return named(world.material.forces);
      case "province":
        return named(world.map.provinces);
      case "polity":
        return named(world.map.polities);
      case "character":
        return world.characters.some((character) => character.id === ref) ? ref : whoIsNamed(world.characters, ref.replace(/[-_]+/g, " "))?.id ?? null;
      case "account":
        return world.material.accounts.some((account) => account.id === ref) ? ref : null;
      case "office":
        return world.material.officeSeats.some((seat) => seat.officeId === ref) ? ref : null;
    }
  };
}

/**
 * The goals of a part: what its acts are for, then what the orchestrator said
 * that the acts do not. Where the two want the same army somewhere else, the
 * named final destination wins over an inferred staging location; the difference is
 * returned to be written down.
 */
export function mergeGoals(derived: readonly OrderGoal[], named: readonly OrderGoal[]): { readonly goals: OrderGoal[]; readonly conflicts: readonly string[] } {
  const goals: OrderGoal[] = [];
  const conflicts: string[] = [];
  const key = (goal: OrderGoal): string => JSON.stringify(goal.kind === "paid" ? { ...goal, sinceStep: 0 } : goal);
  for (const goal of derived) if (!goals.some((known) => key(known) === key(goal))) goals.push(goal);
  for (const goal of named) {
    if (goals.some((known) => key(known) === key(goal))) continue;
    const clash = goal.kind === "force_at" && goals.some((known) => known.kind === "force_at" && known.forceId === goal.forceId && known.provinceId !== goal.provinceId);
    if (clash) {
      for (let at = goals.length - 1; at >= 0; at--) if (goals[at]!.kind === "force_at" && (goals[at] as Extract<OrderGoal, { kind: "force_at" }>).forceId === goal.forceId) goals.splice(at, 1);
      goals.push(goal);
      conflicts.push(`The order's reading sent ${goal.forceId} to ${goal.provinceId}; its act sends it elsewhere; the requested destination remains the goal.`);
      continue;
    }
    goals.push(goal);
  }
  return { goals: goals.slice(0, 4), conflicts };
}
