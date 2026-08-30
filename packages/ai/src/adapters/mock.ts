import type { AiOperation } from "@chronica/shared";
import type { AiAdapter, AiCallResult } from "../adapter";

// Deterministic fixture for tests. Returns a minimal valid JSON blob so callers
// that parse the content won't throw on unexpected structure.

export function createMockAdapter(fixedContent = "{}"): AiAdapter {
  return {
    async call(_operation: AiOperation): Promise<AiCallResult> {
      return {
        content: fixedContent,
        model: "mock",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    },
  };
}
