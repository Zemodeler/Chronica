# Billing and coins

## Product rule

Chronica bills AI work in coins. **One coin equals US$1.** For every provider-billed token category—input, output, cache read, and cache write—the player charge is the actual provider cost plus a 50% markup:

```text
coin charge = ceil(provider token cost × 1.5)
```

The calculation uses micro-coins (one millionth of a coin) and rounds up only at the final charge. This avoids floating-point errors and ensures that the same recorded token use always produces the same charge. **Every AI use consumes coins according to its provider-reported token usage**—not only turn resolution. This includes character creation, NPC creation, each NPC chat response, order interpretation, turn resolution, and generated summaries.

Example: an AI operation with a provider cost of $0.20 costs 0.30 coins. A $1.00 provider cost costs 1.50 coins.

## Billing flow

1. The player receives coins through an approved product, grant, or gift code.
2. Before paid AI work begins, the game reserves a maximum amount from the wallet and the save's coin cap.
3. After every provider response or completed provider attempt that reports token usage, the game calculates the 1.5× charge and settles that usage against the hold. A failed request with no reported provider usage does not consume coins.
4. Unused reserved coins return to the player wallet. Insufficient funds or a breached save cap pauses the next AI operation rather than creating an unbounded charge.
5. The account shows available, held, and debt balances plus a ledger history.

## Current implementation

The repository already has coin wallets, coin lots, holds, a ledger, AI-call records, rate cards, game spending caps, gift redemption, and a Paddle payment-gateway adapter. `calculateCoinUsage` records provider cost and calculates the 1.5× marked-up coin charge; the game-creation screen already states that one coin is US$1. The current account UI supports wallet visibility and gift redemption; purchasing is not yet exposed there. Future purchase UI must use the existing payment gateway and credit the purchased coin amount exactly as configured.

## Guardrails

- Persist provider cost, token usage, applied rate-card version, final coin charge, and idempotency key for every settled AI call.
- Do not charge twice when a client retries a request.
- Never settle above the reserved hold; release the unused portion after settlement or failure.
- Do not display a token price that differs from the active rate card. Any future estimate must be labeled as an estimate.
