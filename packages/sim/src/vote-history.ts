import { RECENT_VOTERS_KEPT, RECENT_VOTES_KEPT, type PoliticalProcedure, type RecentVote, type VoteRecord, type WorldState } from "@chronica/shared";

/**
 * How the members of a chamber voted lately (docs/plans/government.md, "Offices and data gaps closed").
 *
 * A vote record is kept for every question, but only its totals and one row for each named member, and the records pile up for the length of a game.
 * The chamber itself keeps the last `RECENT_VOTES_KEPT` questions it settled, each with the named men on each side (at most `RECENT_VOTERS_KEPT` a side, in
 * id order, so the same on every replay): enough for a man to read how he and his colleagues have voted, and a size that does not grow. The record is
 * made where a vote is counted (`senate.ts`), nowhere else.
 */
export function rememberTheVote(world: WorldState, institutionId: string, procedure: Pick<PoliticalProcedure, "id" | "label">, record: VoteRecord): WorldState {
  const side = (choice: "yes" | "no" | "abstain"): string[] => [...new Set((record.ballots ?? []).filter((ballot) => ballot.choice === choice).map((ballot) => ballot.characterId))].sort().slice(0, RECENT_VOTERS_KEPT);
  const vote: RecentVote = {
    procedureId: procedure.id, label: procedure.label.slice(0, 160), atStep: record.resolvedAtStep, outcome: record.outcome,
    yesWeight: record.yesWeight, noWeight: record.noWeight, yes: side("yes"), no: side("no"), abstain: side("abstain"),
  };
  return {
    ...world,
    material: {
      ...world.material,
      institutions: world.material.institutions.map((institution) => institution.id !== institutionId
        ? institution
        : { ...institution, recentVotes: [...(institution.recentVotes ?? []).filter((kept) => kept.procedureId !== procedure.id), vote].slice(-RECENT_VOTES_KEPT) }),
    },
  };
}
