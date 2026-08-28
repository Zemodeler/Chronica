import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { authAccounts, authSessions, authVerifications } from "./auth";
import { aiCalls, billingEvents, creditLedgerEntries, creditWallets } from "./billing";
import { characterClaims, gameInvites, games, scenarioMapAssets, scenarioVersions } from "./game";

describe("database-enforced M1 boundaries", () => {
  it("keeps authentication and invite tokens unique", () => {
    expect(indexNames(authSessions)).toContain("auth_sessions_token_unique");
    expect(indexNames(gameInvites)).toContain("game_invites_token_hash_unique");
    expect(getTableConfig(authVerifications).columns.map((column) => column.name)).toContain("expires_at");
    expect(getTableConfig(authAccounts).columns.map((column) => column.name)).toContain("issuer");
    expect(indexNames(authAccounts)).toContain("auth_accounts_issuer_account_unique");
  });

  it("enforces one active claim for both a character and a player", () => {
    expect(indexNames(characterClaims)).toEqual(expect.arrayContaining([
      "character_claims_active_unique",
      "character_claims_player_active_unique",
    ]));
  });

  it("pins immutable continuity inputs on games", () => {
    expect(getTableConfig(games).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "starting_seat_count",
      "extra_principals_per_player",
      "news_timeout_seconds",
    ]));
  });

  it("makes webhook and ledger idempotency database constraints", () => {
    expect(indexNames(billingEvents)).toContain("billing_events_provider_unique");
    expect(indexNames(creditLedgerEntries)).toContain("credit_ledger_idempotency_unique");
    expect(indexNames(creditWallets)).toContain("credit_wallets_user_unique");
    expect(indexNames(aiCalls)).toContain("ai_calls_idempotency_unique");
  });

  it("keeps a scenario version's starting world beside its rules, not inside them", () => {
    // `definition` is validated against ScenarioDefinitionSchema (rules only);
    // `initial_world` is what packages/db/src/queries/turns.ts createGame reads to
    // open a new game's turn 0 -- see the column comment in schema/game.ts.
    expect(getTableConfig(scenarioVersions).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["definition", "initial_world"]),
    );
  });

  it("pins a validated GeoJSON asset to the scenario version", () => {
    expect(getTableConfig(scenarioVersions).columns.map((column) => column.name)).toContain("map_asset_id");
    expect(getTableConfig(scenarioMapAssets).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "object_key", "mime_type", "checksum", "feature_count", "bounding_box", "rights_confirmed_at",
    ]));
  });
});

function indexNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).indexes.map((index) => index.config.name ?? "");
}
