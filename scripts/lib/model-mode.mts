// Which model a script talks to. Files, unless it is told otherwise.
//
// The base way to play the game while working on it is with the model
// answered by hand -- by a person, or by Claude working as the model -- from
// files (`packages/ai/src/adapters/hand.ts`). It spends nothing, and every
// prompt and every answer can be read afterwards. A real provider is used
// only when a script is given `--live`, and a script that would spend a lot
// still asks for its own confirmation on top.
//
// Nothing here is read before a script's first model call: every adapter in
// the codebase is created at the moment it is needed, from the environment
// as it then stands.

export type ModelMode = "hand" | "live";

/** Sets the environment for the chosen mode and says which it is. */
export function chooseModel(args: readonly string[], handDir: string): ModelMode {
  if (args.includes("--live")) return "live";
  process.env.CHRONICA_AI_MODE = "hand";
  process.env.CHRONICA_HAND_DIR ??= handDir;
  console.log(`Model: answered by hand, from ${process.env.CHRONICA_HAND_DIR}. Pass --live to use the provider instead.`);
  return "hand";
}
