// Resolution pipeline shared types.
//
// These live here rather than in packages/shared because they are specific to
// the web-layer orchestration and will move to apps/worker when that process
// exists. No packages/shared code imports from here.

export type ResolutionStep =
  | "interpret"
  | "assess"
  | "adjudicate"
  | "world_sim"
  | "manage"
  | "execute"
  | "chronicle"
  | "commit";

export interface ResolutionProgress {
  readonly step: ResolutionStep;
  readonly label: string;
  readonly done: boolean;
}

export const STEP_LABELS: Record<ResolutionStep, string> = {
  interpret: "Interpreting your orders…",
  assess: "Assessing feasibility…",
  adjudicate: "Calculating consequences…",
  world_sim: "Simulating the world…",
  manage: "Reviewing proposed actions…",
  execute: "Applying changes…",
  chronicle: "Writing the chronicle…",
  commit: "Saving the new world…",
};
