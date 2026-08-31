// Resolution pipeline shared types.
//
// These live here rather than in packages/shared because they are specific to
// the web-layer orchestration and will move to apps/worker when that process
// exists. No packages/shared code imports from here.

export type ResolutionStep =
  | "interpret"
  | "assess"
  | "adjudicate"
  | "execute_player"
  | "reaction"
  | "simulate"
  | "character_advise"
  | "consolidate"
  | "world_direct"
  | "execute_world"
  | "chronicle"
  | "commit"
  // Legacy — kept so old audit logs remain readable.
  | "world_sim"
  | "manage"
  | "execute";

export interface ResolutionProgress {
  readonly step: ResolutionStep;
  readonly label: string;
  readonly done: boolean;
}

export const STEP_LABELS: Record<ResolutionStep, string> = {
  interpret: "Interpreting your orders…",
  assess: "Assessing feasibility…",
  adjudicate: "Calculating consequences…",
  execute_player: "Applying your actions…",
  reaction: "Observing reactions…",
  simulate: "Simulating the world…",
  character_advise: "Consulting character intentions…",
  consolidate: "Consolidating proposals…",
  world_direct: "World Director deciding…",
  execute_world: "Applying world changes…",
  chronicle: "Writing the chronicle…",
  commit: "Saving the new world…",
  // Legacy labels
  world_sim: "Simulating the world…",
  manage: "Reviewing proposed actions…",
  execute: "Applying changes…",
};
