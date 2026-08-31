ALTER TABLE "npc_chat_knowledgebases"
  ADD COLUMN "biography" text,
  ADD COLUMN "culture" text,
  ADD COLUMN "faith" text,
  ADD COLUMN "socio_economic_class" text,
  ADD COLUMN "role" text,
  ADD COLUMN "skills" jsonb,
  ADD COLUMN "goals" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN "backstory" jsonb NOT NULL DEFAULT '[]';
