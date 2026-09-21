import { describe, expect, it } from "vitest";
import type { MoneyObligation } from "../material-state";
import { bandStrength, controlInWords, moraleInWords, payInWords, provisionInWords } from "./in-words";

const obligation = (over: Partial<MoneyObligation> = {}): MoneyObligation => ({
  id: "ob-1", kind: "army_pay", label: "Pay of the First", payerAccountId: "acc-1",
  amount: 1_000, cadenceSteps: 30, nextDueStep: 30, priority: 100,
  arrears: 0, missedPeriods: 0, active: true, ...over,
});

describe("in words, never in numbers", () => {
  it("never lets a number reach the player", () => {
    const said = [
      ...[0, 1_999, 3_499, 4_999, 6_999, 8_499, 10_000].map(moraleInWords),
      ...[0, 1_999, 3_999, 6_499, 8_499, 10_000].map(controlInWords),
      ...(["provisioned", "shortage", "critical"] as const).map(provisionInWords),
    ];
    for (const phrase of said) expect(phrase).not.toMatch(/\d/);
  });

  it("covers every band boundary from both sides", () => {
    expect(moraleInWords(10_000)).toBe("in high spirits");
    expect(moraleInWords(8_500)).toBe("in high spirits");
    expect(moraleInWords(8_499)).toBe("in good heart");
    expect(moraleInWords(0)).toBe("fit only to run");
    expect(controlInWords(8_500)).toBe("held firmly");
    expect(controlInWords(0)).toBe("yours in law only");
  });

  it("distinguishes unpaid from unpayable", () => {
    // A force nobody has undertaken to pay is not a force that is up to date.
    expect(payInWords(undefined, 0)).toBe("Nobody has undertaken to pay them");
    expect(payInWords(obligation(), 0)).toBe("Paid");
    expect(payInWords(obligation({ arrears: 2_000, missedPeriods: 2 }), 2)).toBe("2 periods of pay owed");
    expect(payInWords(obligation({ arrears: 1_000, missedPeriods: 1 }), 1)).toBe("One period of pay owed");
  });

  it("takes the worse of the two arrears readings, because they can disagree", () => {
    expect(payInWords(obligation({ arrears: 3_000, missedPeriods: 3 }), 1)).toBe("3 periods of pay owed");
    expect(payInWords(obligation({ arrears: 3_000, missedPeriods: 1 }), 3)).toBe("3 periods of pay owed");
  });

  it("bands a strength the way a bystander would quote it", () => {
    expect(bandStrength(94)).toBe(90);
    expect(bandStrength(437)).toBe(400);
    expect(bandStrength(4_210)).toBe(4_000);
    expect(bandStrength(4_260)).toBe(4_500);
  });
});
