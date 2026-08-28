import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { findActiveProduct, type NormalizedPaymentEvent, type PaymentGateway, type ProductCatalogEntry } from "../gateway";

export class PaddlePaymentGateway implements PaymentGateway {
  readonly #client: Paddle;
  readonly #webhookSecret: string;
  readonly #catalog: readonly ProductCatalogEntry[];

  constructor(input: Readonly<{ apiKey: string; webhookSecret: string; sandbox: boolean; catalog: readonly ProductCatalogEntry[] }>) {
    if (input.apiKey === "" || input.webhookSecret === "") throw new TypeError("Paddle credentials must be non-empty.");
    this.#client = new Paddle(input.apiKey, { environment: input.sandbox ? Environment.sandbox : Environment.production });
    this.#webhookSecret = input.webhookSecret;
    this.#catalog = input.catalog;
  }

  async createCheckout(request: Parameters<PaymentGateway["createCheckout"]>[0]) {
    const product = findActiveProduct(this.#catalog, request.productSlug);
    if (product === null) throw new RangeError("Unknown or inactive billing product.");
    const transaction = await this.#client.transactions.create({
      items: [{ priceId: product.providerPriceReference, quantity: 1 }],
      customerId: request.customerReference,
      customData: { chronicaUserId: request.userId, productSlug: product.slug },
      checkout: { url: request.returnUrl },
    });
    const checkoutUrl = transaction.checkout?.url;
    if (checkoutUrl === null || checkoutUrl === undefined) throw new Error("Paddle did not return a checkout URL.");
    return { providerTransactionReference: transaction.id, checkoutUrl };
  }

  async createCustomerPortal(customerReference: string): Promise<string> {
    const session = await this.#client.customerPortalSessions.create(customerReference, []);
    return session.urls.general.overview;
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<NormalizedPaymentEvent> {
    const event = await this.#client.webhooks.unmarshal(rawBody, this.#webhookSecret, signature);
    return {
      providerEventReference: event.eventId,
      type: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.data,
    };
  }
}
