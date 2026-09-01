-- Deleting a save cascades through its player rows; every save-local player
-- reference must cascade as well so PostgreSQL can complete that deletion.
ALTER TABLE "game_invites" DROP CONSTRAINT "game_invites_claimed_player_id_players_id_fk";
ALTER TABLE "game_invites" ADD CONSTRAINT "game_invites_claimed_player_id_players_id_fk"
  FOREIGN KEY ("claimed_player_id") REFERENCES "players"("id") ON DELETE CASCADE;

ALTER TABLE "orders" DROP CONSTRAINT "orders_player_id_players_id_fk";
ALTER TABLE "orders" ADD CONSTRAINT "orders_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;

ALTER TABLE "turn_news_readiness" DROP CONSTRAINT "turn_news_readiness_player_id_players_id_fk";
ALTER TABLE "turn_news_readiness" ADD CONSTRAINT "turn_news_readiness_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;

ALTER TABLE "character_claims" DROP CONSTRAINT "character_claims_player_id_players_id_fk";
ALTER TABLE "character_claims" ADD CONSTRAINT "character_claims_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;
