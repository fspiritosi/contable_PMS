-- Tabla agregada por @codecontrol/taskapp-cli para el módulo de Ayuda.
-- Guarda last_seen_at y last_seen_status_id por (user_id, taskapp_ticket_id).

CREATE TABLE IF NOT EXISTS "support_ticket_views" (
    "user_id" UUID NOT NULL,
    "taskapp_ticket_id" BIGINT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "last_seen_status_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "support_ticket_views_pkey" PRIMARY KEY ("user_id", "taskapp_ticket_id")
);

CREATE INDEX IF NOT EXISTS "idx_support_ticket_views_user_id"
  ON "support_ticket_views" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_support_ticket_views_taskapp_ticket_id"
  ON "support_ticket_views" ("taskapp_ticket_id");
