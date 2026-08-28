ALTER TABLE "dialogue_messages" ADD COLUMN "client_request_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "dialogue_messages_session_request_unique" ON "dialogue_messages" USING btree ("session_id","client_request_id");
