-- CreateTable
CREATE TABLE "price_indexes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_index_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "index_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "percentage" DECIMAL(6,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_index_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "price_list_id" UUID NOT NULL,
    "index_id" UUID NOT NULL,
    "index_value_id" UUID NOT NULL,
    "percentage" DECIMAL(6,3) NOT NULL,
    "items_affected" INTEGER NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by" TEXT,

    CONSTRAINT "price_list_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_indexes_company_id_name_key" ON "price_indexes"("company_id", "name");

-- CreateIndex
CREATE INDEX "price_index_values_index_id_idx" ON "price_index_values"("index_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_index_values_index_id_period_key" ON "price_index_values"("index_id", "period");

-- CreateIndex
CREATE INDEX "price_list_adjustments_price_list_id_idx" ON "price_list_adjustments"("price_list_id");

-- AddForeignKey
ALTER TABLE "price_indexes" ADD CONSTRAINT "price_indexes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_index_values" ADD CONSTRAINT "price_index_values_index_id_fkey" FOREIGN KEY ("index_id") REFERENCES "price_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_adjustments" ADD CONSTRAINT "price_list_adjustments_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_adjustments" ADD CONSTRAINT "price_list_adjustments_index_id_fkey" FOREIGN KEY ("index_id") REFERENCES "price_indexes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_adjustments" ADD CONSTRAINT "price_list_adjustments_index_value_id_fkey" FOREIGN KEY ("index_value_id") REFERENCES "price_index_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
