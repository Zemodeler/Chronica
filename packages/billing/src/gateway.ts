export type BillingProductKind = "pack" | "subscription";

export type CheckoutRequest = Readonly<{
  productSlug: string;
  userId: string;
  customerReference: string | null;
  returnUrl: string;
}>;

export type CheckoutSession = Readonly<{
  providerTransactionReference: string;
  checkoutUrl: string;
}>;

export type NormalizedPaymentEvent = Readonly<{
  providerEventReference: string;
  type: string;
  occurredAt: string;
  payload: unknown;
}>;

export interface PaymentGateway {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  createCustomerPortal(customerReference: string): Promise<string>;
  verifyWebhook(rawBody: string, signature: string): Promise<NormalizedPaymentEvent>;
}

export type ProductCatalogEntry = Readonly<{
  slug: string;
  kind: BillingProductKind;
  active: boolean;
  providerPriceReference: string;
  grantMicrocredits: bigint;
}>;

export function findActiveProduct(catalog: readonly ProductCatalogEntry[], slug: string): ProductCatalogEntry | null {
  return catalog.find((product) => product.slug === slug && product.active) ?? null;
}
