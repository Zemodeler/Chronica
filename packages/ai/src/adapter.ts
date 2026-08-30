import type { AiOperation } from "@chronica/shared";

export interface AiCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

export interface AiAdapter {
  call(operation: AiOperation, systemPrompt: string, userMessage: string): Promise<AiCallResult>;
}
