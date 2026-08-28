import { describe, expect, it } from "vitest";
import { FixturePaymentGateway } from "./fixture";

const gateway = new FixturePaymentGateway([
  { slug: "chronica_1000", kind: "pack", active: true, providerPriceReference: "opaque-fixture", grantMicrocredits: 1_000_000n },
]);

describe("fixture payment gateway", () => {
  it("accepts stable product slugs and rejects client-selected provider references", async () => {
    const checkout = await gateway.createCheckout({ productSlug: "chronica_1000", userId: "user-1", customerReference: null, returnUrl: "https://example.test/account/return" });
    expect(checkout.checkoutUrl).toContain("chronica_1000");
    await expect(gateway.createCheckout({ productSlug: "pri_attacker", userId: "user-1", customerReference: null, returnUrl: "https://example.test" })).rejects.toThrow(/Unknown/);
  });

  it("normalizes only signed fixture events", async () => {
    const body = JSON.stringify({ eventId: "evt-1", type: "transaction.completed", occurredAt: "2026-08-19T10:00:00Z", payload: { productSlug: "chronica_1000" } });
    await expect(gateway.verifyWebhook(body, "invalid")).rejects.toThrow(/signature/);
    await expect(gateway.verifyWebhook(body, "fixture-valid")).resolves.toMatchObject({ providerEventReference: "evt-1" });
  });
});
