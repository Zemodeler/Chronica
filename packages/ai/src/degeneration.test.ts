import { describe, expect, it } from "vitest";
import { watchForDegeneration } from "./degeneration";

/** Feeds a string a few characters at a time, as a stream arrives. */
function stream(operation: Parameters<typeof watchForDegeneration>[0], text: string): string | null {
  const watch = watchForDegeneration(operation);
  for (let index = 0; index < text.length; index += 7) {
    const said = watch.feed(text.slice(index, index + 7));
    if (said !== null) return said;
  }
  return null;
}

describe("a model that has stopped saying anything", () => {
  it("catches the filler a live burst actually produced", () => {
    // "1p2q3r4s5t6u7v8w9x0y1z2a3b..." inside an unterminated string, which ran
    // to sixteen thousand tokens and seventy-five seconds before its ceiling
    // stopped it.
    const digits = "0123456789";
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let filler = "";
    for (let index = 0; index < 8_000; index += 1) filler += digits[index % 10]! + letters[index % 26]!;
    expect(stream("simulate_cognition", `{"actors":[{"reasoning":"${filler}`)).toContain("without any JSON structure");
  });

  it("leaves a long, well-formed answer alone", () => {
    // Fifty people's worth of proposals: enormous, and never far from a brace.
    const actor = `{"actorRef":{"kind":"character","id":"a"},"reasoning":"He waits.","proposal":{"deltas":[],"facts":[]}},`;
    expect(stream("simulate_cognition", `{"actors":[${actor.repeat(50)}]}`)).toBeNull();
  });

  it("lets the historian write prose the schema does not cap", () => {
    // A Chronicle body is unbounded and genuinely has no structure in it, so
    // it gets far more room than the structured calls do.
    const passage = "The legions went north through a country emptied before them. ".repeat(80);
    expect(stream("compose_chronicle", `{"entries":[{"thread":1,"title":"North","body":"${passage}"}]}`)).toBeNull();
  });

  it("says nothing about a short answer, however odd it looks", () => {
    expect(stream("simulate_cognition", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });

  it("forgives a long string that ends and lets the answer continue", () => {
    const summary = "x".repeat(2_500);
    expect(stream("simulate_cognition", `{"actors":[{"reasoning":"${summary}","proposal":{"deltas":[]}}]}`)).toBeNull();
  });
});
