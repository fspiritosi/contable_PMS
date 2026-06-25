-- Bloque 12: Integración ARCA (AFIP)
-- Modelos de credenciales y log de solicitudes

-- Tabla de credenciales ARCA
CREATE TABLE "arca_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "cuit" VARCHAR(13) NOT NULL,
    "certificate" BYTEA NOT NULL,
    "private_key" BYTEA NOT NULL,
    "environment" VARCHAR(20) NOT NULL DEFAULT 'HOMOLOGACION',
    "token" TEXT,
    "sign" TEXT,
    "token_expiry" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_credentials_pkey" PRIMARY KEY ("id")
);

-- Tabla de log de solicitudes ARCA
CREATE TABLE "arca_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "invoice_id" UUID,
    "service" VARCHAR(15) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "cae" VARCHAR(14),
    "result" CHAR(1),
    "observations" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arca_requests_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: una credencial por empresa + ambiente
CREATE UNIQUE INDEX "arca_credentials_company_id_environment_key"
ON "arca_credentials"("company_id", "environment");

-- Índices de búsqueda
CREATE INDEX "arca_requests_company_id_created_at_idx"
ON "arca_requests"("company_id", "created_at");

CREATE INDEX "arca_requests_invoice_id_idx"
ON "arca_requests"("invoice_id");

-- Foreign keys
ALTER TABLE "arca_credentials"
ADD CONSTRAINT "arca_credentials_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "arca_requests"
ADD CONSTRAINT "arca_requests_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "arca_requests"
ADD CONSTRAINT "arca_requests_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
