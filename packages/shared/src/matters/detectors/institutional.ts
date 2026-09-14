import type { MatterDetector } from "../detector-types";
import type { DetectedMatter } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// World matters, Phase 5 (docs/plans/ai-world-matters-runtime.md,
// "Institutional time"). The engine never selects a winner here -- these
// detectors only ever say that a term, vacancy, or deadline deserves
// attention; only the existing procedure workflows (`sponsor_procedure`,
// `nominate_candidate`, `call_vote`, `resolve_procedure`,
// `appoint_to_office`) may actually change who holds an office.

const officeTermDetector: MatterDetector = {
  id: "institutional.office_term",
  kinds: ["office_term"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const seat of ctx.world.material.officeSeats) {
      if (seat.termExpiresAtStep === null) continue;
      const lookahead = Math.max(1, Math.floor((seat.termExpiresAtStep - (seat.termStartedAtStep ?? seat.termExpiresAtStep)) / 8) || 4);
      if (seat.termExpiresAtStep - lookahead > ctx.atStep) continue;
      const term = seat.termStartedAtStep ?? 0;
      const overdue = seat.termExpiresAtStep <= ctx.atStep;
      const matter = freshDetectedMatter(ctx, {
        id: `office-term:${seat.id}:term-${term}`,
        kind: "office_term",
        sourceRef: { kind: "seat", id: seat.id },
        summary: `The term for office seat "${seat.id}" (office "${seat.officeId}") ${overdue ? "has expired" : "is approaching its end"}.`,
        intensity: overdue ? 60 : 35,
        provinceId: null,
        visibility: "public",
        cadenceSteps: Math.max(1, lookahead),
      });
      result.push({
        ...matter,
        status: overdue ? "overdue" : "due",
        dueAt: matter.createdAt,
        stakeholderRefs: seat.holderCharacterId === null ? [] : [{ kind: "character", id: seat.holderCharacterId }],
      });
    }
    return result;
  },
};

const seatVacancyDetector: MatterDetector = {
  id: "institutional.seat_vacancy",
  kinds: ["seat_vacancy"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const seat of ctx.world.material.officeSeats) {
      if (seat.status !== "vacant") continue;
      const matter = freshDetectedMatter(ctx, {
        id: `seat-vacancy:${seat.id}`,
        kind: "seat_vacancy",
        sourceRef: { kind: "seat", id: seat.id },
        summary: `Office seat "${seat.id}" (office "${seat.officeId}") is vacant (${seat.vacancyCause}).`,
        intensity: 45,
        provinceId: null,
        visibility: "public",
        cadenceSteps: 4,
      });
      result.push({ ...matter, status: "due", dueAt: matter.createdAt });
    }
    return result;
  },
};

const procedureDeadlineDetector: MatterDetector = {
  id: "institutional.procedure_deadline",
  kinds: ["office_term"],
  detect(ctx) {
    // Shares the `office_term` kind rather than minting a dedicated one: a
    // procedure past its own deadline is the same class of concern
    // (institutional time going unanswered), just keyed to the procedure
    // instead of the seat. `treaty_review`/`commitment_review` are reserved
    // for the domains that actually need their own kind (Phase 7).
    const result: DetectedMatter[] = [];
    for (const procedure of ctx.world.material.politicalProcedures) {
      if (procedure.stage === "resolved" || procedure.stage === "withdrawn" || procedure.stage === "blocked") continue;
      if (procedure.deadlineStep === null || procedure.deadlineStep > ctx.atStep) continue;
      const matter = freshDetectedMatter(ctx, {
        id: `procedure-deadline:${procedure.id}`,
        kind: "office_term",
        sourceRef: { kind: "procedure", id: procedure.id },
        summary: `Political procedure "${procedure.id}" (${procedure.type}) has passed its deadline without resolving.`,
        intensity: 50,
        provinceId: null,
        visibility: procedure.visibility,
        cadenceSteps: 4,
      });
      result.push({
        ...matter,
        status: "overdue",
        dueAt: matter.createdAt,
        stakeholderRefs: [{ kind: "character", id: procedure.sponsorCharacterId }],
      });
    }
    return result;
  },
};

export const institutionalMatterDetectors: readonly MatterDetector[] = [
  officeTermDetector,
  seatVacancyDetector,
  procedureDeadlineDetector,
];
