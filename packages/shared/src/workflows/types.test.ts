import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commandKindOf, type AnyWorkflowDefinition } from "./types";

// docs/27: `commandKindOf` is the single place this classification is made.
// `tools.ts` (tool surface) and `policy.ts` (authority check) both defer to
// it rather than re-deriving the same fact independently.

const stub = (invokerAuthority: AnyWorkflowDefinition["invokerAuthority"]): AnyWorkflowDefinition => ({
  id: "stub_action",
  description: "stub",
  category: "narrative",
  ...(invokerAuthority === undefined ? {} : { invokerAuthority }),
  parametersSchema: z.object({}),
  apply: () => null,
});

describe("commandKindOf", () => {
  it("is agent_action when no invokerAuthority is declared", () => {
    expect(commandKindOf(stub(undefined))).toBe("agent_action");
  });

  it("is agent_action when any non-system invoker is allowed", () => {
    expect(commandKindOf(stub(["system", "player"]))).toBe("agent_action");
  });

  it("is system_effect only when every declared invoker is system", () => {
    expect(commandKindOf(stub(["system"]))).toBe("system_effect");
  });

  it("is agent_action for an empty authority list", () => {
    expect(commandKindOf(stub([]))).toBe("agent_action");
  });
});
