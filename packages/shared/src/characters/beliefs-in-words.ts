import type { BeliefKind } from "./beliefs";

/**
 * What you have heard, said the way you would say it.
 *
 * A belief carries a kind and a confidence from 0 to 100, and the player must
 * be shown neither number nor enum. Nobody thinks "I hold this at 35". They
 * think "it is said", or "I suspect", or "I know" -- and the difference
 * between those three is exactly what the kind and the confidence encode.
 *
 * The confidence bands are pitched against KNOWLEDGE_CHANNEL_DEFAULTS, so
 * what a channel grants lands where a reader would expect it: a direct
 * witness at 95 knows, an ordinary rumour at 35 has merely heard.
 */

/** Above this, a claim of fact is something you would say you know. */
const CERTAIN = 80;
/** Below this, even a fact is only something you were told. */
const SHAKY = 45;

export function beliefInWords(kind: BeliefKind, confidence: number): string {
  switch (kind) {
    case "fact":
      if (confidence >= CERTAIN) return "You know";
      if (confidence >= SHAKY) return "You are fairly sure";
      return "You were told";
    case "rumour":
      return confidence >= CERTAIN ? "It is widely said" : "It is said";
    case "suspicion":
      return confidence >= CERTAIN ? "You are all but certain" : "You suspect";
    case "secret":
      return "You have learned, and few others know";
  }
}
