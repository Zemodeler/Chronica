import type { PoliticalProcedure } from "../material-state";
import type { WorldState } from "../world/world-state";

// Political procedures store a workflow id and its parameters because the
// executor needs them. A reader needs the question the institution is being
// asked to decide, not those implementation details. This is deliberately
// deterministic and shared by the workflow summaries, the GM's orientation,
// and the Chronicle.

function polityName(world: WorldState, id: unknown): string | null {
  return typeof id === "string" ? world.map.polities.find((polity) => polity.id === id)?.name ?? null : null;
}

function characterName(world: WorldState, id: unknown): string | null {
  return typeof id === "string" ? world.characters.find((character) => character.id === id)?.name ?? null : null;
}

function forceName(world: WorldState, id: unknown): string | null {
  return typeof id === "string" ? world.material.forces.find((force) => force.id === id)?.name ?? null : null;
}

function provinceName(world: WorldState, id: unknown): string | null {
  return typeof id === "string" ? world.map.provinces.find((province) => province.id === id)?.name ?? null : null;
}

function settlementName(world: WorldState, id: unknown): string | null {
  if (typeof id !== "string") return null;
  for (const province of world.map.provinces) {
    const settlement = province.settlements.find((candidate) => candidate.id === id);
    if (settlement) return settlement.name;
  }
  return null;
}

function accountName(world: WorldState, id: unknown): string | null {
  if (typeof id !== "string") return null;
  const account = world.material.accounts.find((candidate) => candidate.id === id);
  if (!account) return null;
  if (account.owner.kind === "character") return characterName(world, account.owner.id);
  return polityName(world, account.owner.id);
}

function officeName(world: WorldState, id: unknown): string | null {
  // Office definitions live in scenario government rules rather than the
  // mutable world snapshot.  We can still make a stored office id readable
  // without leaking it verbatim into the Chronicle.
  void world;
  return typeof id === "string" ? humanizeAction(id) : null;
}

function amount(params: Record<string, unknown>): string | null {
  const value = params["amount"] ?? params["requestedAmount"];
  return typeof value === "number" ? String(value) : null;
}

function reason(params: Record<string, unknown>): string | null {
  const value = params["reason"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function subjectName(world: WorldState, procedure: PoliticalProcedure): string | null {
  switch (procedure.subjectKind) {
    case "character": return characterName(world, procedure.subjectId);
    case "force": return forceName(world, procedure.subjectId);
    case "polity": return polityName(world, procedure.subjectId);
    case "office_seat": return officeName(world, procedure.subjectId);
    default: return null;
  }
}

function humanizeAction(id: string): string {
  return id.replace(/[_-]+/g, " ").trim();
}

/** States a procedure's real-world question without exposing engine ids. */
export function describePoliticalQuestion(world: WorldState, procedure: PoliticalProcedure): string {
  const params = procedure.linkedWorkflowParams;
  switch (procedure.linkedWorkflowId) {
    case "start_war": {
      const first = polityName(world, params["polityAId"]);
      const second = polityName(world, params["polityBId"]);
      return first && second ? `whether ${first} should go to war with ${second}` : "whether to go to war";
    }
    case "end_war": {
      const first = polityName(world, params["polityAId"]);
      const second = polityName(world, params["polityBId"]);
      return first && second ? `whether ${first} and ${second} should make peace` : "whether to make peace";
    }
    case "assign_command": {
      const commander = characterName(world, params["commanderCharacterId"]);
      const force = forceName(world, params["forceId"]);
      return commander && force ? `whether ${commander} should command ${force}` : "who should hold the command";
    }
    case "appoint_to_office": {
      const candidate = characterName(world, params["characterId"]);
      const office = officeName(world, params["officeId"]);
      return candidate && office ? `whether ${candidate} should receive the office of ${office}` : candidate ? `whether ${candidate} should receive the office` : "who should receive the office";
    }
    case "remove_from_office": {
      const holder = characterName(world, params["characterId"]);
      return holder ? `whether ${holder} should be removed from office` : "whether the officeholder should be removed";
    }
    case "move_force": {
      const force = forceName(world, params["forceId"]);
      const destination = provinceName(world, params["destinationProvinceId"]);
      return force && destination ? `whether ${force} should march to ${destination}` : "whether the force should march";
    }
    case "create_force": {
      const location = provinceName(world, params["locationProvinceId"]);
      return location ? `whether a new force should be raised at ${location}` : "whether a new force should be raised";
    }
    case "start_siege": {
      const settlement = settlementName(world, params["settlementId"]);
      return settlement ? `whether ${settlement} should be put under siege` : "whether to begin a siege";
    }
    case "end_siege": {
      const settlement = settlementName(world, params["settlementId"]);
      return settlement ? `whether the siege of ${settlement} should end` : "whether the siege should end";
    }
    case "sign_treaty":
      return "whether the proposed treaty should be ratified";
    case "give_territory": {
      const province = provinceName(world, params["provinceId"]);
      return province ? `whether ${province} should be ceded` : "whether territory should be ceded";
    }
    case "change_province_control": {
      const province = provinceName(world, params["provinceId"]);
      const recipient = polityName(world, params["newControllerPolityId"]);
      return province && recipient ? `whether control of ${province} should pass to ${recipient}` : "whether control of the province should change";
    }
    case "collect_emergency_taxation": {
      const province = provinceName(world, params["provinceId"]);
      const requested = amount(params);
      const why = reason(params);
      const core = province ? `whether ${requested ?? "emergency"} funds should be raised in ${province}` : "whether emergency funds should be raised";
      return why ? `${core} for ${why}` : core;
    }
    case "add_gold": {
      const account = accountName(world, params["accountId"]);
      const value = amount(params);
      const why = reason(params);
      const core = account && value ? `whether ${value} should be added to ${account}'s funds` : "whether funds should be added";
      return why ? `${core} for ${why}` : core;
    }
    case "remove_gold": {
      const account = accountName(world, params["accountId"]);
      const value = amount(params);
      const why = reason(params);
      const core = account && value ? `whether ${value} should be spent from ${account}'s funds` : "whether funds should be spent";
      return why ? `${core} for ${why}` : core;
    }
    case "transfer_gold": {
      const source = accountName(world, params["sourceAccountId"]);
      const destination = accountName(world, params["destinationAccountId"]);
      const value = amount(params);
      const why = reason(params);
      const core = source && destination && value ? `whether ${value} should be transferred from ${source} to ${destination}` : "whether funds should be transferred";
      return why ? `${core} for ${why}` : core;
    }
    case "challenge_legitimacy": {
      const polity = polityName(world, params["polityId"]);
      const institution = typeof params["institutionId"] === "string"
        ? world.material.institutions.find((candidate) => candidate.id === params["institutionId"])?.name ?? null
        : null;
      const why = reason(params);
      const target = institution ?? polity ?? subjectName(world, procedure) ?? "the ruling authority";
      return why ? `whether the legitimacy of ${target} should be challenged over ${why}` : `whether the legitimacy of ${target} should be challenged`;
    }
    default:
      // A registered workflow not yet given a tailored wording still names
      // what it would do, its subject, and any recorded reason. A Chronicle
      // must never make a reader guess what "the proposed measure" was.
      {
        const subject = subjectName(world, procedure);
        const why = reason(params);
        const core = subject
          ? `whether ${subject} should authorize ${humanizeAction(procedure.linkedWorkflowId)}`
          : `whether the authority should authorize ${humanizeAction(procedure.linkedWorkflowId)}`;
        return why ? `${core} for ${why}` : core;
      }
  }
}
