-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."account_nature" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "public"."account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."bank_account_status" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."bank_account_type" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT', 'CASH', 'VIRTUAL_WALLET');

-- CreateEnum
CREATE TYPE "public"."bank_movement_type" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'CHECK', 'DEBIT', 'FEE', 'INTEREST');

-- CreateEnum
CREATE TYPE "public"."budget_status" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."cash_movement_type" AS ENUM ('OPENING', 'CLOSING', 'INCOME', 'EXPENSE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."cash_register_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."check_status" AS ENUM ('PORTFOLIO', 'DEPOSITED', 'CLEARED', 'REJECTED', 'ENDORSED', 'DELIVERED', 'CASHED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."check_type" AS ENUM ('OWN', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "public"."cost_type" AS ENUM ('DIRECT', 'INDIRECT');

-- CreateEnum
CREATE TYPE "public"."currency" AS ENUM ('USD', 'EUR', 'GBP', 'ARS');

-- CreateEnum
CREATE TYPE "public"."customer_tax_condition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "public"."delivery_note_status" AS ENUM ('PENDING_DELIVERY', 'ACCEPTED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."depreciation_method" AS ENUM ('STRAIGHT_LINE', 'DECLINING_BALANCE');

-- CreateEnum
CREATE TYPE "public"."depreciation_status" AS ENUM ('ACTIVE', 'COMPLETED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."document_action" AS ENUM ('UPLOADED', 'REPLACED', 'RENEWED', 'DELETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."document_applies_to" AS ENUM ('EMPLOYEE', 'EQUIPMENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "public"."document_state" AS ENUM ('PENDING', 'APPROVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."education_level" AS ENUM ('PRIMARY', 'SECONDARY', 'TERTIARY', 'UNIVERSITY', 'POSTGRADUATE');

-- CreateEnum
CREATE TYPE "public"."employee_status" AS ENUM ('INCOMPLETE', 'COMPLETE', 'COMPLETE_EXPIRED_DOCS');

-- CreateEnum
CREATE TYPE "public"."expense_status" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."gender" AS ENUM ('MALE', 'FEMALE', 'NOT_DECLARED');

-- CreateEnum
CREATE TYPE "public"."identity_document_type" AS ENUM ('DNI', 'LE', 'LC', 'PASSPORT');

-- CreateEnum
CREATE TYPE "public"."journal_entry_status" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."lead_status" AS ENUM ('NEW', 'CONTACTED', 'NEGOTIATING', 'CONVERTED', 'REJECTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."marital_status" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'DOMESTIC_PARTNERSHIP');

-- CreateEnum
CREATE TYPE "public"."payment_method" AS ENUM ('CASH', 'CHECK', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "public"."payment_order_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."product_status" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "public"."product_type" AS ENUM ('PRODUCT', 'SERVICE', 'COMBO');

-- CreateEnum
CREATE TYPE "public"."product_usage" AS ENUM ('PURCHASE', 'SALE', 'PURCHASE_SALE');

-- CreateEnum
CREATE TYPE "public"."projection_category" AS ENUM ('SALES', 'PURCHASES', 'SALARIES', 'TAXES', 'RENT', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."projection_status" AS ENUM ('PENDING', 'PARTIAL', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "public"."projection_type" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "public"."purchase_invoice_status" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID', 'PARTIAL_PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."purchase_order_installment_status" AS ENUM ('PENDING', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "public"."purchase_order_invoicing_status" AS ENUM ('NOT_INVOICED', 'PARTIALLY_INVOICED', 'FULLY_INVOICED');

-- CreateEnum
CREATE TYPE "public"."purchase_order_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."quote_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."receipt_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."receiving_note_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."recurring_frequency" AS ENUM ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "public"."sales_invoice_status" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID', 'PARTIAL_PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."session_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."stock_movement_type" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN', 'PRODUCTION', 'LOSS');

-- CreateEnum
CREATE TYPE "public"."supplier_status" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."supplier_tax_condition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO', 'NO_RESPONSABLE', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "public"."tax_status" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "public"."termination_reason" AS ENUM ('DISMISSAL_WITHOUT_CAUSE', 'RESIGNATION', 'DISMISSAL_WITH_CAUSE', 'MUTUAL_AGREEMENT', 'CONTRACT_END', 'DEATH');

-- CreateEnum
CREATE TYPE "public"."union_affiliation_status" AS ENUM ('AFFILIATED', 'NOT_AFFILIATED');

-- CreateEnum
CREATE TYPE "public"."vehicle_condition" AS ENUM ('OPERATIVE', 'NOT_OPERATIVE', 'IN_REPAIR', 'CONDITIONAL_OPERATIVE', 'IN_PREPARATION');

-- CreateEnum
CREATE TYPE "public"."vehicle_status" AS ENUM ('INCOMPLETE', 'COMPLETE', 'COMPLETE_EXPIRED_DOCS', 'APPROVED', 'NOT_APPROVED');

-- CreateEnum
CREATE TYPE "public"."vehicle_termination_reason" AS ENUM ('SALE', 'TOTAL_LOSS', 'RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."vehicle_titularity_type" AS ENUM ('LEASING', 'RENTAL', 'OWNED', 'PLEDGED');

-- CreateEnum
CREATE TYPE "public"."voucher_type" AS ENUM ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C', 'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C', 'RECIBO');

-- CreateEnum
CREATE TYPE "public"."warehouse_type" AS ENUM ('MAIN', 'BRANCH', 'TRANSIT', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "public"."withholding_tax_type" AS ENUM ('IVA', 'GANANCIAS', 'IIBB', 'SUSS');

-- CreateTable
CREATE TABLE "public"."account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "password" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."accounting_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "fiscal_year_start" TIMESTAMP(3) NOT NULL,
    "fiscal_year_end" TIMESTAMP(3) NOT NULL,
    "last_entry_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "default_bank_account_id" UUID,
    "default_cash_account_id" UUID,
    "payables_account_id" UUID,
    "purchases_account_id" UUID,
    "receivables_account_id" UUID,
    "sales_account_id" UUID,
    "vat_credit_account_id" UUID,
    "vat_debit_account_id" UUID,
    "result_account_id" UUID,
    "withholding_ganancias_emitted_account_id" UUID,
    "withholding_ganancias_suffered_account_id" UUID,
    "withholding_iibb_emitted_account_id" UUID,
    "withholding_iibb_suffered_account_id" UUID,
    "withholding_iva_emitted_account_id" UUID,
    "withholding_iva_suffered_account_id" UUID,
    "withholding_suss_emitted_account_id" UUID,
    "withholding_suss_suffered_account_id" UUID,
    "expenses_account_id" UUID,
    "accumulated_depreciation_account_id" UUID,
    "asset_disposal_gain_loss_account_id" UUID,
    "depreciation_expense_account_id" UUID,
    "fixed_asset_account_id" UUID,
    "locked_until_date" TIMESTAMP(3),

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."account_type" NOT NULL,
    "nature" "public"."account_nature" NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asset_value_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "previous_value" DECIMAL(15,2) NOT NULL,
    "new_value" DECIMAL(15,2) NOT NULL,
    "difference_amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "journal_entry_id" UUID,
    "company_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_value_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_type" "public"."bank_account_type" NOT NULL,
    "cbu" TEXT,
    "alias" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "public"."bank_account_status" NOT NULL DEFAULT 'ACTIVE',
    "account_id" UUID,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bank_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "public"."bank_movement_type" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "statement_number" TEXT,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "payment_order_id" UUID,
    "receipt_id" UUID,

    CONSTRAINT "bank_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."budget_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "budget_id" UUID NOT NULL,
    "previous_amounts" JSONB NOT NULL,
    "new_amounts" JSONB NOT NULL,
    "previous_total" DECIMAL(12,2) NOT NULL,
    "new_total" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "status" "public"."budget_status" NOT NULL DEFAULT 'DRAFT',
    "monthly_amounts" JSONB NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cash_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "public"."cash_movement_type" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "session_id" UUID NOT NULL,
    "cash_register_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sales_invoice_id" UUID,
    "purchase_invoice_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cash_register_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_number" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "status" "public"."session_status" NOT NULL DEFAULT 'OPEN',
    "opening_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "expected_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "actual_balance" DECIMAL(15,2),
    "difference" DECIMAL(15,2),
    "opening_notes" TEXT,
    "closing_notes" TEXT,
    "cash_register_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opened_by" TEXT NOT NULL,
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_register_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cash_registers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "status" "public"."cash_register_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "account_id" UUID,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cashflow_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "type" "public"."projection_type" NOT NULL,
    "category" "public"."projection_category" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" DATE NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "public"."projection_status" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "cashflow_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "type" "public"."check_type" NOT NULL,
    "status" "public"."check_status" NOT NULL DEFAULT 'PORTFOLIO',
    "check_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch" TEXT,
    "account_number" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "drawer_name" TEXT NOT NULL,
    "drawer_tax_id" TEXT,
    "payee_name" TEXT,
    "customer_id" UUID,
    "supplier_id" UUID,
    "receipt_payment_id" UUID,
    "payment_order_payment_id" UUID,
    "bank_account_id" UUID,
    "bank_movement_id" UUID,
    "endorsed_to_name" TEXT,
    "endorsed_to_tax_id" TEXT,
    "endorsed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "deposited_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cities" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "province_id" INTEGER NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collective_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "union_id" UUID NOT NULL,

    CONSTRAINT "collective_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "tax_id" TEXT,
    "description" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "country" TEXT,
    "industry" TEXT,
    "tax_status" "public"."tax_status",
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_single_company" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "province_id" INTEGER,
    "city_id" INTEGER,
    "active_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" "public"."document_state" NOT NULL DEFAULT 'PENDING',
    "expiration_date" TIMESTAMP(3),
    "period" TEXT,
    "document_path" TEXT,
    "document_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "rejection_reason" TEXT,
    "uploaded_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_type_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    "role_id" UUID,
    "employee_id" UUID,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_member_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module" TEXT NOT NULL,
    "is_granted" BOOLEAN NOT NULL DEFAULT true,
    "assigned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "member_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,

    CONSTRAINT "company_member_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invited_by" TEXT,
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "role_id" UUID,
    "employee_id" UUID,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,

    CONSTRAINT "company_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."company_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "color" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "company_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "contractor_id" UUID,
    "lead_id" UUID,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contract_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contractor_employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employee_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,

    CONSTRAINT "contractor_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contractor_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicle_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,

    CONSTRAINT "contractor_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contractors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "logo_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "termination_date" TIMESTAMP(3),
    "reason_for_termination" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_limit" DECIMAL(12,2),
    "default_account_id" UUID,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "price_list_id" UUID,
    "tax_condition" "public"."customer_tax_condition" NOT NULL DEFAULT 'CONSUMIDOR_FINAL',

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cost_centers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."countries" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."delivery_note_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_note_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."delivery_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "sales_invoice_id" UUID,
    "delivery_date" DATE NOT NULL,
    "notes" TEXT,
    "status" "public"."delivery_note_status" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."depreciation_schedule_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depreciation_id" UUID NOT NULL,
    "period_number" INTEGER NOT NULL,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "accumulated_amount" DECIMAL(15,2) NOT NULL,
    "book_value_after" DECIMAL(15,2) NOT NULL,
    "is_posted" BOOLEAN NOT NULL DEFAULT false,
    "journal_entry_id" UUID,
    "posted_date" TIMESTAMP(3),
    "posted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depreciation_schedule_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."discount_presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_collective_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "collective_agreement_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_collective_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_contract_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "contract_type_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_contract_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_job_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "job_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_job_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "job_position_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_unions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "union_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_unions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_vehicle_brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "vehicle_brand_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_vehicle_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_type_vehicle_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type_id" UUID NOT NULL,
    "vehicle_type_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "applies_to" "public"."document_applies_to" NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "has_expiration" BOOLEAN NOT NULL DEFAULT false,
    "is_monthly" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_termination" BOOLEAN NOT NULL DEFAULT false,
    "is_multi_resource" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_conditional" BOOLEAN NOT NULL DEFAULT false,
    "genders" "public"."gender"[] DEFAULT ARRAY[]::"public"."gender"[],
    "costTypes" "public"."cost_type"[] DEFAULT ARRAY[]::"public"."cost_type"[],
    "advanced_conditions" JSONB,
    "company_id" UUID NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employee_document_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action" "public"."document_action" NOT NULL,
    "state" "public"."document_state" NOT NULL,
    "document_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "expiration_date" TIMESTAMP(3),
    "reason" TEXT,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "document_id" UUID NOT NULL,

    CONSTRAINT "employee_document_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employee_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" "public"."document_state" NOT NULL DEFAULT 'PENDING',
    "expiration_date" TIMESTAMP(3),
    "period" TEXT,
    "document_path" TEXT,
    "document_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_type_id" UUID NOT NULL,
    "employee_id" UUID,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "employee_number" TEXT NOT NULL,
    "identity_document_type" "public"."identity_document_type" NOT NULL DEFAULT 'DNI',
    "document_number" TEXT NOT NULL,
    "cuil" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3),
    "gender" "public"."gender",
    "marital_status" "public"."marital_status",
    "education_level" "public"."education_level",
    "picture_url" TEXT,
    "picture_key" TEXT,
    "nationality_id" INTEGER,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "street" TEXT NOT NULL,
    "street_number" TEXT NOT NULL,
    "postal_code" TEXT,
    "province_id" INTEGER NOT NULL,
    "city_id" INTEGER,
    "birth_place_id" INTEGER,
    "hire_date" TIMESTAMP(3) NOT NULL,
    "working_hours_per_day" INTEGER,
    "union_affiliation_status" "public"."union_affiliation_status",
    "cost_type" "public"."cost_type",
    "status" "public"."employee_status" NOT NULL DEFAULT 'INCOMPLETE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "termination_date" TIMESTAMP(3),
    "termination_reason" "public"."termination_reason",
    "company_id" UUID NOT NULL,
    "job_position_id" UUID,
    "contract_type_id" UUID,
    "job_category_id" UUID,
    "cost_center_id" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."equipment_document_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action" "public"."document_action" NOT NULL,
    "state" "public"."document_state" NOT NULL,
    "document_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "expiration_date" TIMESTAMP(3),
    "reason" TEXT,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "document_id" UUID NOT NULL,

    CONSTRAINT "equipment_document_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."equipment_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state" "public"."document_state" NOT NULL DEFAULT 'PENDING',
    "expiration_date" TIMESTAMP(3),
    "period" TEXT,
    "document_path" TEXT,
    "document_key" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "rejection_reason" TEXT,
    "uploaded_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_type_id" UUID NOT NULL,
    "vehicle_id" UUID,

    CONSTRAINT "equipment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."equipment_owner_titularity_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "titularity_type" "public"."vehicle_titularity_type" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID NOT NULL,

    CONSTRAINT "equipment_owner_titularity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."equipment_owners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "equipment_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expense_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expense_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "company_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" DATE NOT NULL,
    "due_date" DATE,
    "status" "public"."expense_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "category_id" UUID NOT NULL,
    "supplier_id" UUID,
    "company_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "agreement_id" UUID NOT NULL,

    CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."journal_entry_status" NOT NULL DEFAULT 'DRAFT',
    "post_date" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "original_entry_id" UUID,
    "reversal_entry_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."journal_entry_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "status" "public"."lead_status" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "converted_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "converted_to_client_id" UUID,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_order_id" UUID NOT NULL,
    "invoice_id" UUID,
    "amount" DECIMAL(15,2) NOT NULL,
    "expense_id" UUID,

    CONSTRAINT "payment_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_order_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_order_id" UUID NOT NULL,
    "payment_method" "public"."payment_method" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "cash_register_id" UUID,
    "bank_account_id" UUID,
    "check_number" TEXT,
    "card_last4" TEXT,
    "reference" TEXT,

    CONSTRAINT "payment_order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_order_withholdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_order_id" UUID NOT NULL,
    "tax_type" "public"."withholding_tax_type" NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "certificate_number" TEXT,

    CONSTRAINT "payment_order_withholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "status" "public"."payment_order_status" NOT NULL DEFAULT 'DRAFT',
    "journal_entry_id" UUID,
    "created_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_key" TEXT,
    "document_url" TEXT,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permission_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "performed_by" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "target_name" TEXT,
    "module" TEXT,
    "details" JSONB,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."price_list_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "price_with_tax" DECIMAL(12,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."price_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "last_modified_by" TEXT,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "oem_code" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."product_suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_code" TEXT,
    "supplier_price" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "public"."product_type" NOT NULL DEFAULT 'PRODUCT',
    "category_id" UUID,
    "unit_of_measure" TEXT NOT NULL DEFAULT 'UN',
    "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sale_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sale_price_with_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "min_stock" DECIMAL(12,3) DEFAULT 0,
    "max_stock" DECIMAL(12,3),
    "barcode" TEXT,
    "internal_code" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "status" "public"."product_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "auxiliary_code" TEXT,
    "oem_code" TEXT,
    "product_group_id" UUID,
    "profit_margin" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "usage" "public"."product_usage" NOT NULL DEFAULT 'PURCHASE_SALE',

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projection_document_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "projection_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "sales_invoice_id" UUID,
    "purchase_invoice_id" UUID,
    "expense_id" UUID,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_order_id" UUID,

    CONSTRAINT "projection_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."provinces" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_credit_note_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,

    CONSTRAINT "purchase_credit_note_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "purchase_order_line_id" UUID,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "voucher_type" "public"."voucher_type" NOT NULL,
    "point_of_sale" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "full_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "cae" TEXT,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_taxes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "public"."purchase_invoice_status" NOT NULL DEFAULT 'DRAFT',
    "journal_entry_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_key" TEXT,
    "document_url" TEXT,
    "original_invoice_id" UUID,
    "purchase_order_id" UUID,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "public"."purchase_order_installment_status" NOT NULL DEFAULT 'PENDING',
    "purchase_invoice_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "received_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "payment_conditions" TEXT,
    "delivery_address" TEXT,
    "delivery_notes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "public"."purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "invoicing_status" "public"."purchase_order_invoicing_status" NOT NULL DEFAULT 'NOT_INVOICED',

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_amount" DECIMAL(12,2),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "delivered_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "status" "public"."quote_status" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" "public"."currency" NOT NULL DEFAULT 'ARS',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "contractor_id" UUID,
    "lead_id" UUID,
    "conditions" TEXT,
    "created_by" TEXT NOT NULL DEFAULT '',
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "global_discount_amount" DECIMAL(12,2),
    "global_discount_percent" DECIMAL(5,2),
    "total_before_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipt_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "payment_method" "public"."payment_method" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "cash_register_id" UUID,
    "bank_account_id" UUID,
    "check_number" TEXT,
    "card_last4" TEXT,
    "reference" TEXT,

    CONSTRAINT "receipt_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipt_withholdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "tax_type" "public"."withholding_tax_type" NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "certificate_number" TEXT,

    CONSTRAINT "receipt_withholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "status" "public"."receipt_status" NOT NULL DEFAULT 'DRAFT',
    "journal_entry_id" UUID,
    "created_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_key" TEXT,
    "document_url" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_note_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiving_note_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "purchase_order_line_id" UUID,
    "notes" TEXT,

    CONSTRAINT "receiving_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "purchase_order_id" UUID,
    "purchase_invoice_id" UUID,
    "reception_date" DATE NOT NULL,
    "notes" TEXT,
    "status" "public"."receiving_note_status" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receiving_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" "public"."recurring_frequency" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "last_generated" TIMESTAMP(3),
    "next_due_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_entry_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recurring_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "recurring_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_path" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_credit_note_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,

    CONSTRAINT "sales_credit_note_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2),
    "discount_percent" DECIMAL(5,2),

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "point_of_sale_id" UUID NOT NULL,
    "voucher_type" "public"."voucher_type" NOT NULL,
    "number" INTEGER NOT NULL,
    "full_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "cae" TEXT,
    "cae_expiry_date" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_taxes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internal_notes" TEXT,
    "status" "public"."sales_invoice_status" NOT NULL DEFAULT 'DRAFT',
    "journal_entry_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "document_key" TEXT,
    "document_url" TEXT,
    "original_invoice_id" UUID,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "global_discount_amount" DECIMAL(12,2),
    "global_discount_percent" DECIMAL(5,2),
    "total_before_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_points_of_sale" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "afip_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "sales_points_of_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "public"."stock_movement_type" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_transfer_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "source_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "tax_id" TEXT NOT NULL,
    "tax_condition" "public"."supplier_tax_condition" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Argentina',
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(12,2),
    "default_account_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "status" "public"."supplier_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."type_operatives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "type_operatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."types_of_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "types_of_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."unions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "unions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "image_key" TEXT,
    "image_url" TEXT,
    "legacy_clerk_id" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "active_company_id" UUID,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "locale" TEXT NOT NULL DEFAULT 'es',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "table_preferences" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vehicle_brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "vehicle_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vehicle_depreciations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "method" "public"."depreciation_method" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "status" "public"."depreciation_status" NOT NULL DEFAULT 'ACTIVE',
    "gross_value" DECIMAL(15,2) NOT NULL,
    "salvage_value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "current_book_value" DECIMAL(15,2) NOT NULL,
    "useful_life_months" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "depreciation_rate" DECIMAL(5,2),
    "total_depreciated" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "last_depreciation_date" TIMESTAMP(3),
    "company_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vehicle_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "brand_id" UUID NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vehicle_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "has_hitch" BOOLEAN NOT NULL DEFAULT false,
    "is_tractor_unit" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "intern_number" TEXT,
    "domain" TEXT,
    "chassis" TEXT,
    "engine" TEXT NOT NULL,
    "serie" TEXT,
    "year" TEXT NOT NULL,
    "kilometer" TEXT DEFAULT '0',
    "picture_url" TEXT,
    "picture_key" TEXT,
    "status" "public"."vehicle_status" NOT NULL DEFAULT 'INCOMPLETE',
    "condition" "public"."vehicle_condition" NOT NULL DEFAULT 'OPERATIVE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "termination_date" TIMESTAMP(3),
    "termination_reason" "public"."vehicle_termination_reason",
    "titularity_type" "public"."vehicle_titularity_type",
    "contract_number" TEXT,
    "contract_start_date" TIMESTAMP(3),
    "contract_expiration_date" TIMESTAMP(3),
    "currency" "public"."currency",
    "price" DECIMAL(12,2),
    "monthly_price" DECIMAL(12,2),
    "owner_id" UUID,
    "cost_type" "public"."cost_type",
    "company_id" UUID NOT NULL,
    "brand_id" UUID,
    "model_id" UUID,
    "type_id" UUID NOT NULL,
    "type_of_vehicle_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "sector_id" UUID,
    "type_operative_id" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."warehouse_stocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "available_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."warehouse_type" NOT NULL DEFAULT 'MAIN',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "public"."account"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_company_id_key" ON "public"."accounting_settings"("company_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_company_id_code_key" ON "public"."accounts"("company_id" ASC, "code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "actions_name_key" ON "public"."actions"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "actions_slug_key" ON "public"."actions"("slug" ASC);

-- CreateIndex
CREATE INDEX "asset_value_adjustments_company_id_idx" ON "public"."asset_value_adjustments"("company_id" ASC);

-- CreateIndex
CREATE INDEX "asset_value_adjustments_vehicle_id_idx" ON "public"."asset_value_adjustments"("vehicle_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_company_id_account_number_key" ON "public"."bank_accounts"("company_id" ASC, "account_number" ASC);

-- CreateIndex
CREATE INDEX "bank_accounts_company_id_status_idx" ON "public"."bank_accounts"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "bank_movements_bank_account_id_date_idx" ON "public"."bank_movements"("bank_account_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "bank_movements_company_id_date_idx" ON "public"."bank_movements"("company_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "bank_movements_reconciled_idx" ON "public"."bank_movements"("reconciled" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "budgets_company_id_account_id_fiscal_year_key" ON "public"."budgets"("company_id" ASC, "account_id" ASC, "fiscal_year" ASC);

-- CreateIndex
CREATE INDEX "cash_movements_cash_register_id_date_idx" ON "public"."cash_movements"("cash_register_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "cash_movements_company_id_date_idx" ON "public"."cash_movements"("company_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "cash_movements_session_id_type_idx" ON "public"."cash_movements"("session_id" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cash_register_sessions_cash_register_id_session_number_key" ON "public"."cash_register_sessions"("cash_register_id" ASC, "session_number" ASC);

-- CreateIndex
CREATE INDEX "cash_register_sessions_cash_register_id_status_idx" ON "public"."cash_register_sessions"("cash_register_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "cash_register_sessions_company_id_status_idx" ON "public"."cash_register_sessions"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_company_id_code_key" ON "public"."cash_registers"("company_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "cash_registers_company_id_status_idx" ON "public"."cash_registers"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "cashflow_projections_company_id_date_idx" ON "public"."cashflow_projections"("company_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "cashflow_projections_company_id_status_idx" ON "public"."cashflow_projections"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "checks_bank_movement_id_key" ON "public"."checks"("bank_movement_id" ASC);

-- CreateIndex
CREATE INDEX "checks_company_id_due_date_idx" ON "public"."checks"("company_id" ASC, "due_date" ASC);

-- CreateIndex
CREATE INDEX "checks_company_id_type_status_idx" ON "public"."checks"("company_id" ASC, "type" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "checks_payment_order_payment_id_key" ON "public"."checks"("payment_order_payment_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "checks_receipt_payment_id_key" ON "public"."checks"("receipt_payment_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cities_name_province_id_key" ON "public"."cities"("name" ASC, "province_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "collective_agreements_union_id_name_key" ON "public"."collective_agreements"("union_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "public"."companies"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "companies_tax_id_key" ON "public"."companies"("tax_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_documents_document_type_id_company_id_period_key" ON "public"."company_documents"("document_type_id" ASC, "company_id" ASC, "period" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_company_id_email_key" ON "public"."company_invitations"("company_id" ASC, "email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_token_key" ON "public"."company_invitations"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_member_permissions_member_id_module_action_id_key" ON "public"."company_member_permissions"("member_id" ASC, "module" ASC, "action_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_members_company_id_user_id_key" ON "public"."company_members"("company_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_members_employee_id_key" ON "public"."company_members"("employee_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_role_permissions_role_id_module_action_id_key" ON "public"."company_role_permissions"("role_id" ASC, "module" ASC, "action_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_roles_company_id_slug_key" ON "public"."company_roles"("company_id" ASC, "slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_contractor_id_key" ON "public"."contacts"("contractor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_lead_id_key" ON "public"."contacts"("lead_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contract_types_company_id_name_key" ON "public"."contract_types"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contractor_employees_employee_id_contractor_id_key" ON "public"."contractor_employees"("employee_id" ASC, "contractor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contractor_vehicles_vehicle_id_contractor_id_key" ON "public"."contractor_vehicles"("vehicle_id" ASC, "contractor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_company_id_name_key" ON "public"."contractors"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_company_id_tax_id_key" ON "public"."contractors"("company_id" ASC, "tax_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_company_id_name_key" ON "public"."cost_centers"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "public"."countries"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "public"."countries"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_company_id_number_key" ON "public"."delivery_notes"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_status_idx" ON "public"."delivery_notes"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "delivery_notes_customer_id_idx" ON "public"."delivery_notes"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "delivery_notes_sales_invoice_id_idx" ON "public"."delivery_notes"("sales_invoice_id" ASC);

-- CreateIndex
CREATE INDEX "depreciation_schedule_entries_depreciation_id_idx" ON "public"."depreciation_schedule_entries"("depreciation_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_schedule_entries_depreciation_id_period_number_key" ON "public"."depreciation_schedule_entries"("depreciation_id" ASC, "period_number" ASC);

-- CreateIndex
CREATE INDEX "depreciation_schedule_entries_is_posted_idx" ON "public"."depreciation_schedule_entries"("is_posted" ASC);

-- CreateIndex
CREATE INDEX "depreciation_schedule_entries_scheduled_date_idx" ON "public"."depreciation_schedule_entries"("scheduled_date" ASC);

-- CreateIndex
CREATE INDEX "discount_presets_company_id_idx" ON "public"."discount_presets"("company_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "discount_presets_company_id_name_key" ON "public"."discount_presets"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_collective_agreements_document_type_id_collec_key" ON "public"."document_type_collective_agreements"("document_type_id" ASC, "collective_agreement_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_contract_types_document_type_id_contract_type_key" ON "public"."document_type_contract_types"("document_type_id" ASC, "contract_type_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_job_categories_document_type_id_job_category__key" ON "public"."document_type_job_categories"("document_type_id" ASC, "job_category_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_job_positions_document_type_id_job_position_i_key" ON "public"."document_type_job_positions"("document_type_id" ASC, "job_position_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_unions_document_type_id_union_id_key" ON "public"."document_type_unions"("document_type_id" ASC, "union_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_vehicle_brands_document_type_id_vehicle_brand_key" ON "public"."document_type_vehicle_brands"("document_type_id" ASC, "vehicle_brand_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_type_vehicle_types_document_type_id_vehicle_type_i_key" ON "public"."document_type_vehicle_types"("document_type_id" ASC, "vehicle_type_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_company_id_name_key" ON "public"."document_types"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_company_id_slug_key" ON "public"."document_types"("company_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "employee_document_history_changed_at_idx" ON "public"."employee_document_history"("changed_at" DESC);

-- CreateIndex
CREATE INDEX "employee_document_history_document_id_idx" ON "public"."employee_document_history"("document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_document_type_id_employee_id_period_key" ON "public"."employee_documents"("document_type_id" ASC, "employee_id" ASC, "period" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_cuil_key" ON "public"."employees"("company_id" ASC, "cuil" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_number_key" ON "public"."employees"("company_id" ASC, "employee_number" ASC);

-- CreateIndex
CREATE INDEX "equipment_document_history_changed_at_idx" ON "public"."equipment_document_history"("changed_at" DESC);

-- CreateIndex
CREATE INDEX "equipment_document_history_document_id_idx" ON "public"."equipment_document_history"("document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_documents_document_type_id_vehicle_id_period_key" ON "public"."equipment_documents"("document_type_id" ASC, "vehicle_id" ASC, "period" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_owner_titularity_types_owner_id_titularity_type_key" ON "public"."equipment_owner_titularity_types"("owner_id" ASC, "titularity_type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_owners_company_id_cuit_key" ON "public"."equipment_owners"("company_id" ASC, "cuit" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_company_id_name_key" ON "public"."expense_categories"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_company_id_number_key" ON "public"."expenses"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "expenses_company_id_status_idx" ON "public"."expenses"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_categories_agreement_id_name_key" ON "public"."job_categories"("agreement_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_positions_company_id_name_key" ON "public"."job_positions"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_number_key" ON "public"."journal_entries"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "leads_company_id_tax_id_key" ON "public"."leads"("company_id" ASC, "tax_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_company_id_number_key" ON "public"."payment_orders"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "payment_orders_company_id_status_idx" ON "public"."payment_orders"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "payment_orders_supplier_id_status_idx" ON "public"."payment_orders"("supplier_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "permission_audit_logs_company_id_created_at_idx" ON "public"."permission_audit_logs"("company_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_price_list_id_product_id_key" ON "public"."price_list_items"("price_list_id" ASC, "product_id" ASC);

-- CreateIndex
CREATE INDEX "product_groups_company_id_idx" ON "public"."product_groups"("company_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "product_groups_company_id_name_key" ON "public"."product_groups"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "product_suppliers_product_id_supplier_id_key" ON "public"."product_suppliers"("product_id" ASC, "supplier_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "public"."products"("barcode" ASC);

-- CreateIndex
CREATE INDEX "products_company_id_auxiliary_code_idx" ON "public"."products"("company_id" ASC, "auxiliary_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_code_key" ON "public"."products"("company_id" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "products_company_id_oem_code_idx" ON "public"."products"("company_id" ASC, "oem_code" ASC);

-- CreateIndex
CREATE INDEX "projection_document_links_expense_id_idx" ON "public"."projection_document_links"("expense_id" ASC);

-- CreateIndex
CREATE INDEX "projection_document_links_projection_id_idx" ON "public"."projection_document_links"("projection_id" ASC);

-- CreateIndex
CREATE INDEX "projection_document_links_purchase_invoice_id_idx" ON "public"."projection_document_links"("purchase_invoice_id" ASC);

-- CreateIndex
CREATE INDEX "projection_document_links_purchase_order_id_idx" ON "public"."projection_document_links"("purchase_order_id" ASC);

-- CreateIndex
CREATE INDEX "projection_document_links_sales_invoice_id_idx" ON "public"."projection_document_links"("sales_invoice_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "provinces_name_key" ON "public"."provinces"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_company_id_supplier_id_full_number_key" ON "public"."purchase_invoices"("company_id" ASC, "supplier_id" ASC, "full_number" ASC);

-- CreateIndex
CREATE INDEX "purchase_invoices_purchase_order_id_idx" ON "public"."purchase_invoices"("purchase_order_id" ASC);

-- CreateIndex
CREATE INDEX "purchase_order_installments_company_id_order_id_idx" ON "public"."purchase_order_installments"("company_id" ASC, "order_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_installments_order_id_number_key" ON "public"."purchase_order_installments"("order_id" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "public"."purchase_orders"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "public"."purchase_orders"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "quote_lines_quote_id_idx" ON "public"."quote_lines"("quote_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_company_id_number_key" ON "public"."quotes"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_company_id_number_key" ON "public"."receipts"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "receipts_company_id_status_idx" ON "public"."receipts"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "receipts_customer_id_status_idx" ON "public"."receipts"("customer_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "receiving_notes_company_id_number_key" ON "public"."receiving_notes"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE INDEX "receiving_notes_company_id_status_idx" ON "public"."receiving_notes"("company_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "receiving_notes_purchase_invoice_id_idx" ON "public"."receiving_notes"("purchase_invoice_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_notes_purchase_order_id_idx" ON "public"."receiving_notes"("purchase_order_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "routes_path_key" ON "public"."routes"("path" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_point_of_sale_id_voucher_type_number_key" ON "public"."sales_invoices"("point_of_sale_id" ASC, "voucher_type" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_points_of_sale_company_id_number_key" ON "public"."sales_points_of_sale"("company_id" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_company_id_name_key" ON "public"."sectors"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "public"."session"("token" ASC);

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "public"."session"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_company_id_transfer_number_key" ON "public"."stock_transfers"("company_id" ASC, "transfer_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_code_key" ON "public"."suppliers"("company_id" ASC, "code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_tax_id_key" ON "public"."suppliers"("company_id" ASC, "tax_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "type_operatives_company_id_name_key" ON "public"."type_operatives"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "types_of_vehicles_company_id_name_key" ON "public"."types_of_vehicles"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unions_company_id_name_key" ON "public"."unions"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "public"."user"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_legacy_clerk_id_key" ON "public"."user"("legacy_clerk_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "public"."user_preferences"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_brands_company_id_name_key" ON "public"."vehicle_brands"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "vehicle_depreciations_company_id_idx" ON "public"."vehicle_depreciations"("company_id" ASC);

-- CreateIndex
CREATE INDEX "vehicle_depreciations_status_idx" ON "public"."vehicle_depreciations"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_depreciations_vehicle_id_key" ON "public"."vehicle_depreciations"("vehicle_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_brand_id_name_key" ON "public"."vehicle_models"("brand_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_company_id_name_key" ON "public"."vehicle_types"("company_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_domain_key" ON "public"."vehicles"("company_id" ASC, "domain" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_intern_number_key" ON "public"."vehicles"("company_id" ASC, "intern_number" ASC);

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "public"."verification"("identifier" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_stocks_warehouse_id_product_id_key" ON "public"."warehouse_stocks"("warehouse_id" ASC, "product_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "public"."warehouses"("company_id" ASC, "code" ASC);

-- AddForeignKey
ALTER TABLE "public"."account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_accumulated_depreciation_account_id_fkey" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_asset_disposal_gain_loss_account_id_fkey" FOREIGN KEY ("asset_disposal_gain_loss_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_default_bank_account_id_fkey" FOREIGN KEY ("default_bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_default_cash_account_id_fkey" FOREIGN KEY ("default_cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_expenses_account_id_fkey" FOREIGN KEY ("expenses_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_fixed_asset_account_id_fkey" FOREIGN KEY ("fixed_asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_payables_account_id_fkey" FOREIGN KEY ("payables_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_purchases_account_id_fkey" FOREIGN KEY ("purchases_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_receivables_account_id_fkey" FOREIGN KEY ("receivables_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_result_account_id_fkey" FOREIGN KEY ("result_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_sales_account_id_fkey" FOREIGN KEY ("sales_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_vat_credit_account_id_fkey" FOREIGN KEY ("vat_credit_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_vat_debit_account_id_fkey" FOREIGN KEY ("vat_debit_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_ganancias_emitted_account__fkey" FOREIGN KEY ("withholding_ganancias_emitted_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_ganancias_suffered_account_fkey" FOREIGN KEY ("withholding_ganancias_suffered_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_iibb_emitted_account_id_fkey" FOREIGN KEY ("withholding_iibb_emitted_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_iibb_suffered_account_id_fkey" FOREIGN KEY ("withholding_iibb_suffered_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_iva_emitted_account_id_fkey" FOREIGN KEY ("withholding_iva_emitted_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_iva_suffered_account_id_fkey" FOREIGN KEY ("withholding_iva_suffered_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_suss_emitted_account_id_fkey" FOREIGN KEY ("withholding_suss_emitted_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounting_settings" ADD CONSTRAINT "accounting_settings_withholding_suss_suffered_account_id_fkey" FOREIGN KEY ("withholding_suss_suffered_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asset_value_adjustments" ADD CONSTRAINT "asset_value_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asset_value_adjustments" ADD CONSTRAINT "asset_value_adjustments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asset_value_adjustments" ADD CONSTRAINT "asset_value_adjustments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_movements" ADD CONSTRAINT "bank_movements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_movements" ADD CONSTRAINT "bank_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_movements" ADD CONSTRAINT "bank_movements_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bank_movements" ADD CONSTRAINT "bank_movements_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budget_revisions" ADD CONSTRAINT "budget_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budgets" ADD CONSTRAINT "budgets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budgets" ADD CONSTRAINT "budgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_movements" ADD CONSTRAINT "cash_movements_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_movements" ADD CONSTRAINT "cash_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_movements" ADD CONSTRAINT "cash_movements_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_movements" ADD CONSTRAINT "cash_movements_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_register_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_registers" ADD CONSTRAINT "cash_registers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cash_registers" ADD CONSTRAINT "cash_registers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cashflow_projections" ADD CONSTRAINT "cashflow_projections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_bank_movement_id_fkey" FOREIGN KEY ("bank_movement_id") REFERENCES "public"."bank_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_payment_order_payment_id_fkey" FOREIGN KEY ("payment_order_payment_id") REFERENCES "public"."payment_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_receipt_payment_id_fkey" FOREIGN KEY ("receipt_payment_id") REFERENCES "public"."receipt_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checks" ADD CONSTRAINT "checks_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cities" ADD CONSTRAINT "cities_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."collective_agreements" ADD CONSTRAINT "collective_agreements_union_id_fkey" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_documents" ADD CONSTRAINT "company_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_documents" ADD CONSTRAINT "company_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_invitations" ADD CONSTRAINT "company_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_invitations" ADD CONSTRAINT "company_invitations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_invitations" ADD CONSTRAINT "company_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_member_permissions" ADD CONSTRAINT "company_member_permissions_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_member_permissions" ADD CONSTRAINT "company_member_permissions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."company_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_role_permissions" ADD CONSTRAINT "company_role_permissions_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_role_permissions" ADD CONSTRAINT "company_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."company_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."company_roles" ADD CONSTRAINT "company_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contract_types" ADD CONSTRAINT "contract_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractor_employees" ADD CONSTRAINT "contractor_employees_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractor_employees" ADD CONSTRAINT "contractor_employees_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractor_vehicles" ADD CONSTRAINT "contractor_vehicles_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractor_vehicles" ADD CONSTRAINT "contractor_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractors" ADD CONSTRAINT "contractors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractors" ADD CONSTRAINT "contractors_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contractors" ADD CONSTRAINT "contractors_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cost_centers" ADD CONSTRAINT "cost_centers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "public"."delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_notes" ADD CONSTRAINT "delivery_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_notes" ADD CONSTRAINT "delivery_notes_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."delivery_notes" ADD CONSTRAINT "delivery_notes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."depreciation_schedule_entries" ADD CONSTRAINT "depreciation_schedule_entries_depreciation_id_fkey" FOREIGN KEY ("depreciation_id") REFERENCES "public"."vehicle_depreciations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."depreciation_schedule_entries" ADD CONSTRAINT "depreciation_schedule_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."discount_presets" ADD CONSTRAINT "discount_presets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_collective_agreements" ADD CONSTRAINT "document_type_collective_agreements_collective_agreement_i_fkey" FOREIGN KEY ("collective_agreement_id") REFERENCES "public"."collective_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_collective_agreements" ADD CONSTRAINT "document_type_collective_agreements_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_contract_types" ADD CONSTRAINT "document_type_contract_types_contract_type_id_fkey" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_contract_types" ADD CONSTRAINT "document_type_contract_types_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_job_categories" ADD CONSTRAINT "document_type_job_categories_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_job_categories" ADD CONSTRAINT "document_type_job_categories_job_category_id_fkey" FOREIGN KEY ("job_category_id") REFERENCES "public"."job_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_job_positions" ADD CONSTRAINT "document_type_job_positions_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_job_positions" ADD CONSTRAINT "document_type_job_positions_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "public"."job_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_unions" ADD CONSTRAINT "document_type_unions_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_unions" ADD CONSTRAINT "document_type_unions_union_id_fkey" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_vehicle_brands" ADD CONSTRAINT "document_type_vehicle_brands_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_vehicle_brands" ADD CONSTRAINT "document_type_vehicle_brands_vehicle_brand_id_fkey" FOREIGN KEY ("vehicle_brand_id") REFERENCES "public"."vehicle_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_vehicle_types" ADD CONSTRAINT "document_type_vehicle_types_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_type_vehicle_types" ADD CONSTRAINT "document_type_vehicle_types_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_types" ADD CONSTRAINT "document_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employee_document_history" ADD CONSTRAINT "employee_document_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."employee_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employee_documents" ADD CONSTRAINT "employee_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_birth_place_id_fkey" FOREIGN KEY ("birth_place_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_contract_type_id_fkey" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_job_category_id_fkey" FOREIGN KEY ("job_category_id") REFERENCES "public"."job_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_job_position_id_fkey" FOREIGN KEY ("job_position_id") REFERENCES "public"."job_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_nationality_id_fkey" FOREIGN KEY ("nationality_id") REFERENCES "public"."countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."equipment_document_history" ADD CONSTRAINT "equipment_document_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."equipment_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."equipment_documents" ADD CONSTRAINT "equipment_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."equipment_documents" ADD CONSTRAINT "equipment_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."equipment_owner_titularity_types" ADD CONSTRAINT "equipment_owner_titularity_types_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."equipment_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."equipment_owners" ADD CONSTRAINT "equipment_owners_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expense_categories" ADD CONSTRAINT "expense_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."expenses" ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_categories" ADD CONSTRAINT "job_categories_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."collective_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_positions" ADD CONSTRAINT "job_positions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_original_entry_id_fkey" FOREIGN KEY ("original_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entries" ADD CONSTRAINT "journal_entries_reversal_entry_id_fkey" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_converted_to_client_id_fkey" FOREIGN KEY ("converted_to_client_id") REFERENCES "public"."contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_items" ADD CONSTRAINT "payment_order_items_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_items" ADD CONSTRAINT "payment_order_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_items" ADD CONSTRAINT "payment_order_items_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_payments" ADD CONSTRAINT "payment_order_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_payments" ADD CONSTRAINT "payment_order_payments_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_payments" ADD CONSTRAINT "payment_order_payments_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_order_withholdings" ADD CONSTRAINT "payment_order_withholdings_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_orders" ADD CONSTRAINT "payment_orders_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_orders" ADD CONSTRAINT "payment_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."price_list_items" ADD CONSTRAINT "price_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."price_lists" ADD CONSTRAINT "price_lists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_categories" ADD CONSTRAINT "product_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_groups" ADD CONSTRAINT "product_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_suppliers" ADD CONSTRAINT "product_suppliers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."product_suppliers" ADD CONSTRAINT "product_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."products" ADD CONSTRAINT "products_product_group_id_fkey" FOREIGN KEY ("product_group_id") REFERENCES "public"."product_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "public"."cashflow_projections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projection_document_links" ADD CONSTRAINT "projection_document_links_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_credit_note_applications" ADD CONSTRAINT "purchase_credit_note_applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_credit_note_applications" ADD CONSTRAINT "purchase_credit_note_applications_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_credit_note_applications" ADD CONSTRAINT "purchase_credit_note_applications_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_installments" ADD CONSTRAINT "purchase_order_installments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_installments" ADD CONSTRAINT "purchase_order_installments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_installments" ADD CONSTRAINT "purchase_order_installments_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quote_lines" ADD CONSTRAINT "quote_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."quotes" ADD CONSTRAINT "quotes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_items" ADD CONSTRAINT "receipt_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_payments" ADD CONSTRAINT "receipt_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_payments" ADD CONSTRAINT "receipt_payments_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_payments" ADD CONSTRAINT "receipt_payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_withholdings" ADD CONSTRAINT "receipt_withholdings_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipts" ADD CONSTRAINT "receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipts" ADD CONSTRAINT "receipts_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_note_lines" ADD CONSTRAINT "receiving_note_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_note_lines" ADD CONSTRAINT "receiving_note_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_note_lines" ADD CONSTRAINT "receiving_note_lines_receiving_note_id_fkey" FOREIGN KEY ("receiving_note_id") REFERENCES "public"."receiving_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_notes" ADD CONSTRAINT "receiving_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_notes" ADD CONSTRAINT "receiving_notes_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_notes" ADD CONSTRAINT "receiving_notes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_notes" ADD CONSTRAINT "receiving_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_notes" ADD CONSTRAINT "receiving_notes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recurring_entries" ADD CONSTRAINT "recurring_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recurring_entry_lines" ADD CONSTRAINT "recurring_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recurring_entry_lines" ADD CONSTRAINT "recurring_entry_lines_recurring_entry_id_fkey" FOREIGN KEY ("recurring_entry_id") REFERENCES "public"."recurring_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_credit_note_applications" ADD CONSTRAINT "sales_credit_note_applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_credit_note_applications" ADD CONSTRAINT "sales_credit_note_applications_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "public"."sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_credit_note_applications" ADD CONSTRAINT "sales_credit_note_applications_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoices" ADD CONSTRAINT "sales_invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_invoices" ADD CONSTRAINT "sales_invoices_point_of_sale_id_fkey" FOREIGN KEY ("point_of_sale_id") REFERENCES "public"."sales_points_of_sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_points_of_sale" ADD CONSTRAINT "sales_points_of_sale_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sectors" ADD CONSTRAINT "sectors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_source_warehouse_id_fkey" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."suppliers" ADD CONSTRAINT "suppliers_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."type_operatives" ADD CONSTRAINT "type_operatives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."types_of_vehicles" ADD CONSTRAINT "types_of_vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."unions" ADD CONSTRAINT "unions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicle_brands" ADD CONSTRAINT "vehicle_brands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicle_depreciations" ADD CONSTRAINT "vehicle_depreciations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicle_depreciations" ADD CONSTRAINT "vehicle_depreciations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicle_models" ADD CONSTRAINT "vehicle_models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."vehicle_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicle_types" ADD CONSTRAINT "vehicle_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."vehicle_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."equipment_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_type_of_vehicle_id_fkey" FOREIGN KEY ("type_of_vehicle_id") REFERENCES "public"."types_of_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."vehicles" ADD CONSTRAINT "vehicles_type_operative_id_fkey" FOREIGN KEY ("type_operative_id") REFERENCES "public"."type_operatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouse_stocks" ADD CONSTRAINT "warehouse_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

