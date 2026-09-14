import { unansweredMessages } from "../../world/diplomacy";
import type { MatterDetector } from "../detector-types";
import type { DetectedMatter } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// World matters, Phase 7 -- diplomatic domain (docs/plans/
// ai-world-matters-runtime.md, "Diplomatic": "envoys or proposals awaiting
// answers"). No new workflow needed: `answer_diplomatic_message` and
// `withdraw_diplomatic_message` (`workflows/definitions/diplomacy.ts`)
// already fully answer this matter. `unansweredMessages` (`world/diplomacy.ts`)
// already exists to find exactly the state this detector reads -- reused
// verbatim, not reimplemented.

const REPLY_OVERDUE_LOOKAHEAD_STEPS = 3;

const diplomaticMessageDetector: MatterDetector = {
  id: "diplomatic.pending_reply",
  kinds: ["treaty_review"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const message of unansweredMessages(ctx.world.diplomacy)) {
      const overdue = message.replyDueByStep !== null && message.replyDueByStep <= ctx.atStep;
      const dueSoon = message.replyDueByStep !== null && message.replyDueByStep - REPLY_OVERDUE_LOOKAHEAD_STEPS <= ctx.atStep;
      const sender = ctx.world.characters.find((c) => c.id === message.fromCharacterId);
      const matter = freshDetectedMatter(ctx, {
        id: `treaty-review:${message.id}`,
        kind: "treaty_review",
        sourceRef: { kind: "diplomatic_message", id: message.id },
        summary: `${sender?.name ?? message.fromPolityId} sent a ${message.kind.replace(/_/g, " ")} (subject: "${message.subject}") awaiting reply.`,
        intensity: overdue ? 55 : dueSoon ? 40 : 25,
        provinceId: null,
        visibility: message.visibility,
        cadenceSteps: 4,
      });
      result.push({
        ...matter,
        status: overdue ? "overdue" : dueSoon ? "due" : "upcoming",
        dueAt: message.replyDueByStep === null ? null : { day: matter.createdAt.day, minute: matter.createdAt.minute },
        // The recipient is who actually needs to act; the sender is a
        // stakeholder (they are owed an answer) without being responsible
        // for producing one -- doc's "responsible vs. interested" distinction.
        stakeholderRefs: [
          ...(message.toCharacterId === null ? [] : [{ kind: "character" as const, id: message.toCharacterId }]),
          { kind: "character" as const, id: message.fromCharacterId },
          { kind: "polity" as const, id: message.toPolityId },
        ],
      });
    }
    return result;
  },
};

export const diplomaticMatterDetectors: readonly MatterDetector[] = [diplomaticMessageDetector];
