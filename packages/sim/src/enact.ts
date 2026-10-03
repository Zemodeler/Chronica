import { carryOutMilitaryReform } from "./military-reform";
import {
  allOffices,
  boundedId,
  deriveOfficeActions,
  labelFromCategoryId,
  isMagistracy,
  vacateOfficeOf,
  type FactProposalDraft,
  type Office,
  type SuccessionRule,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { amend, type ChangeVia } from "./constitutions";
import { carryOutDepartment } from "./departments";
import { carryOutReformLaws } from "./reform-laws";
import { grantForBudget } from "./voted-budgets";
import { grantFranchise } from "./submission";

/**
 * A measure carried, and what it does.
 *
 * A question put to a council used to change nothing by being answered. A
 * grain law passed and then had to be carried out a second time by hand, and
 * no vote of any kind could reform an office or found a council -- so the
 * whole constitutional history of a republic, which is most of what a Roman
 * political career was spent on, could be argued about and never happen.
 *
 * Carried out once, on the day the procedure passes, and never again. Every
 * part is the engine's to size: a law's effects are the same closed verbs a
 * building has, and an office's powers are named in the world's own ops.
 */
/** How long a waiver stands: long enough for one election. */
const WAIVER_DAYS = 365;

export function carryOutEnactment(
  world: WorldState,
  procedureId: string,
  atStep: number,
  ids: IdFactory,
  scenarioOffices: readonly Office[],
  scenarioSuccessionRules: readonly SuccessionRule[] = [],
): { world: WorldState; facts: FactProposalDraft[] } {
  const enactment = world.enactments.find((candidate) => candidate.procedureId === procedureId && candidate.enactedAtStep === null);
  if (enactment === undefined) return { world, facts: [] };
  const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
  const title = procedure?.label ?? "The measure";
  const facts: FactProposalDraft[] = [];
  let next = world;
  const said: string[] = [];

  if (enactment.budget != null) {
    const budget = enactment.budget;
    const account = next.material.accounts.find((candidate) => candidate.id === budget.accountId);
    if (account?.owner.kind === "polity" && account.owner.id === enactment.polityId) {
      next = { ...next, genericEntities: [...next.genericEntities, {
        id: ids.next("entity"), kind: "budget_authorization", label: budget.purpose.slice(0, 160),
        ownerRef: { kind: "polity", id: enactment.polityId },
        attributes: { procedureId, accountId: budget.accountId, authorizedAmount: budget.amount },
        linkedEntityIds: [budget.accountId], createdAtStep: atStep, provenanceEventIds: [], provinceId: null, effects: [],
      }] };
      said.push(budget.amount === null ? `a dedicated budget is established from ${account.id} for ${budget.purpose}` : `${budget.amount} is authorised from ${account.id} for ${budget.purpose}`);
      // And somebody may spend it (`voted-budgets.ts`).
      const grant = grantForBudget(next, enactment, procedure?.sponsorCharacterId ?? null, atStep);
      if (grant !== null) {
        next = { ...next, authorityGrants: [...next.authorityGrants.filter((existing) => existing.id !== grant.id), grant] };
        said.push(`${next.characters.find((character) => character.id === grant.holder.id)?.name ?? grant.holder.id} is to spend it`);
      }
    }
  }

  // A law that goes on doing something. It has no one place to stand, so it
  // acts over the whole of the power's ground.
  if (enactment.effects.length > 0) {
    next = {
      ...next,
      genericEntities: [...next.genericEntities, {
        id: ids.next("entity"),
        kind: "law",
        label: title.slice(0, 160),
        ownerRef: { kind: "polity" as const, id: enactment.polityId },
        attributes: { procedureId },
        linkedEntityIds: [],
        createdAtStep: atStep,
        provenanceEventIds: [],
        provinceId: null,
        effects: enactment.effects.map((effect) => ({ ...effect, scope: "realm" as const })),
        ...(enactment.upkeep === null ? {} : { upkeep: enactment.upkeep }),
      }],
    };
    said.push("it is now law");
  }

  // An office reformed, made, or done away with.
  if (enactment.office !== null) {
    const reform = enactment.office;
    const known = allOffices(next, scenarioOffices);
    const existing = known.find((office) => office.id === reform.officeId);
    const label = reform.officeLabel ?? existing?.label ?? labelFromCategoryId(reform.officeId);
    if (reform.abolish) {
      if (existing !== undefined) {
        for (const seat of next.material.officeSeats.filter((candidate) => candidate.officeId === existing.id && candidate.holderCharacterId !== null)) {
          next = vacateOfficeOf(next, seat.holderCharacterId!, existing.id, "removal", atStep);
        }
        next = {
          ...next,
          // Kept, so the men who held it are still described as having held
          // it; emptied of every power, and of the rule that would refill it.
          offices: [...next.offices.filter((office) => office.id !== existing.id), {
            ...existing, authorisedActionIds: [], successionRuleId: "abolished", treasuryAccountId: null, treasuryPermissions: [],
          }],
          material: { ...next.material, officeSeats: next.material.officeSeats.filter((seat) => seat.officeId !== existing.id) },
        };
        said.push(`the office of ${existing.label} is abolished`);
      }
    } else {
      const base: Office = existing ?? {
        id: reform.officeId,
        label,
        polityId: enactment.polityId,
        authorisedActionIds: [],
        sponsorableCategories: [],
        treasuryAccountId: null,
        treasuryPermissions: [],
        incomeSourceId: null,
        expectedBlocId: null,
        successionRuleId: "appointed-by-the-government",
        eligibilityRequirementIds: [],
      };
      const reformed: Office = {
        ...base,
        label,
        ...(reform.authorises === null ? {} : { authorisedActionIds: deriveOfficeActions(label, [...reform.authorises]) }),
        ...(reform.termDays === undefined ? {} : reform.termDays === null ? { termDays: undefined } : { termDays: reform.termDays }),
      };
      next = { ...next, offices: [...next.offices.filter((office) => office.id !== reformed.id), reformed] };

      // As many seats as it now has. Held seats are never taken away by a
      // reform; a college made smaller shrinks as its members leave.
      // A college larger than the men it names is resized, not re-seated.
      if (reform.seats !== null && reformed.seatCount !== undefined) {
        next = { ...next, offices: next.offices.map((office) => (office.id === reformed.id ? { ...office, seatCount: reform.seats! } : office)) };
      } else if (reform.seats !== null) {
        const seats = next.material.officeSeats.filter((seat) => seat.officeId === reformed.id);
        const extra = reform.seats - seats.length;
        let officeSeats = next.material.officeSeats;
        if (extra > 0) {
          const template = seats[0];
          officeSeats = [...officeSeats, ...Array.from({ length: extra }, (_, index) => ({
            id: boundedId(reformed.id, "seat", seats.length + index),
            officeId: reformed.id,
            seatIndex: seats.length + index,
            holderCharacterId: null,
            status: "vacant" as const,
            vacancyCause: "never_filled" as const,
            termStartedAtStep: null,
            termExpiresAtStep: null,
            appointmentProcedureId: null,
            removalProcedureId: null,
            eligibilityRequirementIds: [...(template?.eligibilityRequirementIds ?? reformed.eligibilityRequirementIds)],
          }))];
        } else if (extra < 0) {
          const surplus = new Set(seats.filter((seat) => seat.holderCharacterId === null).slice(0, -extra).map((seat) => seat.id));
          officeSeats = officeSeats.filter((seat) => !surplus.has(seat.id));
        }
        next = { ...next, material: { ...next.material, officeSeats } };
      }
      said.push(existing === undefined ? `the office of ${label} is created` : `the office of ${label} is reformed`);
    }
  }

  // A department: who is in charge of a piece of the state's work.
  if (enactment.department != null) {
    const carried = carryOutDepartment(next, enactment.polityId, enactment.department, atStep, ids, scenarioOffices, procedure?.sponsorCharacterId ?? null, title);
    next = carried.world;
    said.push(...carried.said);
  }

  // Its armies remade: doctrines, recruitment, terms of service, a body redrawn.
  if (enactment.military != null) {
    const carried = carryOutMilitaryReform(next, enactment.polityId, enactment.military, atStep, procedure?.sponsorCharacterId ?? null, procedureId);
    next = carried.world;
    said.push(...carried.said);
  }

  // A council that did not exist, with one bloc of members to begin with.
  // Who sits in it, and how they vote, is the world's to fill in.
  if (enactment.body !== null) {
    const id = ids.next("institution");
    next = {
      ...next,
      material: {
        ...next.material,
        institutions: [...next.material.institutions, {
          id,
          polityId: enactment.polityId,
          name: enactment.body.name,
          votingBlocs: [{
            id: `${id}-members`, name: "Members", representedInterest: "its members", weight: 100,
            baseSupport: 0, yesThreshold: 10, noThreshold: -10, causes: [],
          }],
          franchise: "council" as const,
          totalVotingWeight: 100,
          quorumBps: 5_000,
          passageThresholdBps: 5_000,
          denominator: "cast" as const,
        }],
      },
    };
    said.push(`${enactment.body.name} is founded`);
  }

  // The ladder set aside for one man. Only a body's vote, or the highest
  // magistrate there is -- a dictator -- can do it: a decree a man writes and
  // settles himself excuses nobody.
  if (enactment.waiver !== null) {
    const waiver = enactment.waiver;
    const polityOffices = allOffices(next, scenarioOffices).filter((office) => office.polityId === enactment.polityId && isMagistracy(office) && office.rank !== undefined);
    const highest = Math.max(-Infinity, ...polityOffices.map((office) => office.rank!));
    const byTheHighest = procedure !== undefined && next.material.officeSeats.some((seat) => seat.holderCharacterId === procedure.sponsorCharacterId && seat.status === "held"
      && polityOffices.some((office) => office.id === seat.officeId && office.rank === highest));
    const excused = next.characters.find((character) => character.id === waiver.characterId);
    const office = allOffices(next, scenarioOffices).find((candidate) => candidate.id === waiver.officeId);
    if (excused !== undefined && office !== undefined && (procedure?.resolutionMechanism === "vote" || byTheHighest)) {
      next = {
        ...next,
        characters: next.characters.map((character) => (character.id === excused.id
          ? { ...character, eligibilityWaivers: [...character.eligibilityWaivers.filter((existing) => existing.officeId !== office.id), { officeId: office.id, untilStep: atStep + WAIVER_DAYS }] }
          : character)),
      };
      said.push(`${excused.name} may stand for ${office.label} as the law would otherwise forbid`);
    }
  }

  // Land for the landless, and debts eased (`reform-laws.ts`).
  const reformed = carryOutReformLaws(next, enactment, atStep, ids, procedure?.sponsorCharacterId ?? null);
  next = reformed.world;
  said.push(...reformed.said);

  // The citizenship given to allies: those that will have it are one state with it now (`submission.ts`).
  if (enactment.franchise != null) {
    const given = grantFranchise(next, enactment.polityId, enactment.franchise.polityIds, enactment.franchise.status, atStep, procedureId);
    next = given.world;
    facts.push(...given.facts);
    said.push(...given.said);
  }

  // The work it voted, begun today: every stage falls due from the day of the
  // vote, not the day the question was put.
  if (enactment.projectId != null) {
    const work = next.projects.find((project) => project.id === enactment.projectId && project.status === "proposed");
    if (work !== undefined) {
      const span = Math.max(0, ...work.milestones.map((milestone) => milestone.requiredAtElapsedOffset));
      next = { ...next, projects: next.projects.map((project) => (project.id === work.id
        ? { ...project, status: "in_progress" as const, startedAtStep: atStep, targetCompletionStep: atStep + span }
        : project)) };
      said.push(`${work.label} is begun`);
    }
  }

  // The constitution itself, changed as parts: a form recast, a chamber
  // founded or done away with, a throne made elective.
  if (enactment.constitution != null) {
    const record = procedure?.voteRecordId == null ? undefined : next.material.voteRecords.find((candidate) => candidate.id === procedure.voteRecordId);
    const via: ChangeVia | undefined = procedure === undefined ? undefined : {
      procedureId: procedure.id,
      bodyName: next.material.institutions.find((institution) => institution.id === procedure.institutionId)?.name ?? null,
      vote: record === undefined ? null : { yes: record.yesWeight, no: record.noWeight },
    };
    const amended = amend(next, enactment.polityId, enactment.constitution, { offices: scenarioOffices, successionRules: scenarioSuccessionRules }, atStep, ids, title, procedure?.sponsorCharacterId ?? null, via);
    next = amended.world;
    facts.push(...amended.facts);
    said.push(...amended.said);
  }

  const voted = procedure?.voteRecordId == null ? undefined : next.material.voteRecords.find((candidate) => candidate.id === procedure.voteRecordId);
  next = {
    ...next,
    enactments: next.enactments.map((candidate) => (candidate.procedureId === enactment.procedureId && candidate.enactedAtStep === null ? {
      ...candidate,
      enactedAtStep: atStep,
      record: {
        title: title.slice(0, 200),
        bodyName: next.material.institutions.find((institution) => institution.id === procedure?.institutionId)?.name ?? null,
        sponsorCharacterId: procedure?.sponsorCharacterId ?? null,
        decidedAtStep: procedure?.resolvedAtStep ?? atStep,
        vote: voted === undefined ? null : { yes: voted.yesWeight, no: voted.noWeight },
        said: said.join("; ").slice(0, 600),
      },
    } : candidate)),
  };
  if (said.length > 0) {
    facts.push({
      localId: `enacted_${procedureId}`.slice(0, 60),
      kind: "law_enacted",
      summary: `${title} was carried, and ${said.join("; ")}.`,
      affectedRefs: [{ kind: "polity", id: enactment.polityId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 55,
    });
  }
  return { world: next, facts };
}
