import { findActiveProduct, type NormalizedPaymentEvent, type PaymentGateway, type ProductCatalogEntry } from "../gateway";

export class FixturePaymentGateway implements PaymentGateway {
  readonly #catalog: readonly ProductCatalogEntry[];

  constructor(catalog: readonly ProductCatalogEntry[]) {
    this.#catalog = catalog;
  }

  createCheckout(request: Parameters<PaymentGateway["createCheckout"]>[0]) {
    const product = findActiveProduct(this.#catalog, request.productSlug);
    if (product === null) return Promise.reject(new RangeError("Unknown or inactive billing product."));
    return Promise.resolve({
      providerTransactionReference: `fixture:${request.userId}:${product.slug}`,
      checkoutUrl: `${request.returnUrl}?fixture_transaction=${encodeURIComponent(product.slug)}`,
    });
  }

  createCustomerPortal(customerReference: string): Promise<string> {
    if (customerReference.trim() === "") return Promise.reject(new TypeError("A customer reference is required."));
    return Promise.resolve(`/account/portal?fixture_customer=${encodeURIComponent(customerReference)}`);
  }

  verifyWebhook(rawBody: string, signature: string): Promise<NormalizedPaymentEvent> {
    if (signature !== "fixture-valid") return Promise.reject(new Error("Invalid fixture webhook signature."));
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isFixtureEvent(parsed)) return Promise.reject(new TypeError("Invalid fixture payment event."));
    return Promise.resolve({
      providerEventReference: parsed.eventId,
      type: parsed.type,
      occurredAt: parsed.occurredAt,
      payload: parsed.payload,
    });
  }
}

function isFixtureEvent(value: unknown): value is { eventId: string; type: string; occurredAt: string; payload: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.eventId === "string"
    && typeof candidate.type === "string"
    && typeof candidate.occurredAt === "string"
    && "payload" in candidate;
}
