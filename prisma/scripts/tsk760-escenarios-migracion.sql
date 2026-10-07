-- =====================================================================================
-- TSK-760, Fase 3 — Escenarios para probar la migración tsk_760_fiscal_years_backfill.
-- SOLO LOCAL, sobre la base COPIA (nunca sobre contable_pms ni producción):
--
--   docker exec -i contable-pms-db psql -U postgres -d contable_tsk760_copia \
--     -v ON_ERROR_STOP=1 < prisma/scripts/tsk760-escenarios-migracion.sql
--
-- Empresas "TSK760-MIG-x" con ids fijos 76076076-0003-4000-8000-000000000NNN. Al inicio
-- borra lo sembrado antes (con session_replication_role = replica: hay POSTED). Fechas
-- fijas 2024-2030; "hoy" de la migración = día UTC en que se corre (pensado para 10/2026).
-- Resultado esperado de cada escenario: tsk760-escenarios-verificar.sql (y plan, Fase 3).
-- =====================================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN
  IF current_database() = 'contable_pms' THEN
    RAISE EXCEPTION 'Este script es solo para la base copia (contable_tsk760_copia)';
  END IF;
END $$;

-- Limpieza de una corrida anterior
SET LOCAL session_replication_role = 'replica';
DELETE FROM journal_entry_lines WHERE entry_id IN
  (SELECT id FROM journal_entries WHERE company_id::text LIKE '76076076-0003-4000-8000-%');
DELETE FROM journal_entries WHERE company_id::text LIKE '76076076-0003-4000-8000-%';
DELETE FROM accounting_periods WHERE fiscal_year_id IN
  (SELECT id FROM fiscal_years WHERE company_id::text LIKE '76076076-0003-4000-8000-%');
DELETE FROM fiscal_years WHERE company_id::text LIKE '76076076-0003-4000-8000-%';
DELETE FROM accounting_settings WHERE company_id::text LIKE '76076076-0003-4000-8000-%';
DELETE FROM accounts WHERE company_id::text LIKE '76076076-0003-4000-8000-%';
DELETE FROM companies WHERE id::text LIKE '76076076-0003-4000-8000-%';
SET LOCAL session_replication_role = 'origin';

-- Asiento de dos líneas (caja / ventas) con fecha, estado y período opcionales.
CREATE OR REPLACE FUNCTION pg_temp.mig_asiento(
  p_id uuid, p_company uuid, p_number int, p_date timestamp, p_status text, p_desc text,
  p_amount numeric DEFAULT 100, p_fy uuid DEFAULT NULL, p_period uuid DEFAULT NULL,
  p_credit_account uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n text := right(p_company::text, 3);
BEGIN
  INSERT INTO journal_entries (id, company_id, number, date, description, status, created_by,
                               fiscal_year_id, period_id, updated_at)
  VALUES (p_id, p_company, p_number, p_date, p_desc, p_status::journal_entry_status,
          'tsk760-mig', p_fy, p_period, now());
  INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES
    (p_id, ('76076076-0003-4000-8001-000000000' || n)::uuid, p_amount, 0),
    (p_id, COALESCE(p_credit_account, ('76076076-0003-4000-8002-000000000' || n)::uuid), 0, p_amount);
END $$;

-- Empresa + cuentas (caja ASSET, ventas REVENUE) + Ajustes.
CREATE OR REPLACE FUNCTION pg_temp.mig_empresa(
  p_n text, p_name text, p_start timestamp, p_end timestamp,
  p_locked timestamp DEFAULT NULL, p_counter int DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid := ('76076076-0003-4000-8000-000000000' || p_n)::uuid;
BEGIN
  INSERT INTO companies (id, name, updated_at) VALUES (c, 'TSK760-MIG-' || p_name, now());
  INSERT INTO accounts (id, company_id, code, name, type, nature, updated_at) VALUES
    (('76076076-0003-4000-8001-000000000' || p_n)::uuid, c, 'MIG-CAJA', 'Caja', 'ASSET', 'DEBIT', now()),
    (('76076076-0003-4000-8002-000000000' || p_n)::uuid, c, 'MIG-VENTAS', 'Ventas', 'REVENUE', 'CREDIT', now());
  INSERT INTO accounting_settings (company_id, fiscal_year_start, fiscal_year_end, locked_until_date,
                                   last_entry_number, updated_at)
  VALUES (c, p_start, p_end, p_locked, p_counter, now());
  RETURN c;
END $$;

-- FY "viejo" con sus períodos: OPENING/CLOSING con los meses que se pasen (0/13 = 20260625)
-- y MONTHLY de los meses [p_from, p_to] (para poder sembrar meses de más).
CREATE OR REPLACE FUNCTION pg_temp.mig_fy(
  p_fy uuid, p_company uuid, p_number int, p_start timestamp, p_end timestamp,
  p_from date, p_to date, p_open_month int, p_close_month int, p_closed bool DEFAULT false
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fiscal_years (id, company_id, number, start_date, end_date, is_closed, closed_at,
                            closed_by, updated_at)
  VALUES (p_fy, p_company, p_number, p_start, p_end, p_closed,
          CASE WHEN p_closed THEN timestamp '2026-03-15 12:00' END,
          CASE WHEN p_closed THEN 'cierre-viejo' END, now());
  INSERT INTO accounting_periods (fiscal_year_id, year, month, type, updated_at)
  SELECT p_fy, EXTRACT(YEAR FROM m)::int, EXTRACT(MONTH FROM m)::int, 'MONTHLY', now()
  FROM generate_series(p_from, p_to, interval '1 month') m;
  INSERT INTO accounting_periods (fiscal_year_id, year, month, type, updated_at) VALUES
    (p_fy, EXTRACT(YEAR FROM p_start)::int, p_open_month, 'OPENING', now()),
    (p_fy, EXTRACT(YEAR FROM p_end)::int, p_close_month, 'CLOSING', now());
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mig_periodo(p_fy uuid, p_year int, p_month int, p_type text DEFAULT 'MONTHLY')
RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM accounting_periods
  WHERE fiscal_year_id = p_fy AND year = p_year AND month = p_month AND type = p_type::accounting_period_type
$$;

-- -------------------------------------------------------------------------------------
-- 001 (a, F): Ajustes 2024 (03:00Z, formulario viejo), SIN FY, ejercicio vencido.
--   Asientos 2024, 2025 y 03/2026; "Asiento de Apertura" POSTED el 01/01/2024 03:00Z.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE c uuid := pg_temp.mig_empresa('001', 'A-vencido-sin-FY',
  '2024-01-01 03:00', '2024-12-31 03:00', NULL, 5);
BEGIN
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a001-000000000001', c, 1, '2024-01-01 03:00', 'POSTED', 'Asiento de Apertura');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a001-000000000002', c, 2, '2024-06-10 00:00', 'POSTED', 'MIG venta 2024');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a001-000000000003', c, 3, '2025-02-01 00:30', 'DRAFT', 'MIG día 1 a las 00:30Z');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a001-000000000004', c, 4, '2025-11-30 15:00', 'POSTED', 'MIG venta 2025');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a001-000000000005', c, 5, '2026-03-10 00:00', 'DRAFT', 'MIG borrador 2026');
END $$;

-- -------------------------------------------------------------------------------------
-- 002 (b, d, 12): FY de la migración 20260625 (03:00Z, OPENING mes 0, CLOSING mes 13,
--   12 MONTHLY abiertos + uno de más en 01/2027 y otro en 12/2025 referenciado), bloqueo
--   guardado por la UI vieja (2026-04-01 02:59:59.999 = fin de marzo local).
--   DRAFT 02/2026, POSTED 03/2026, REVERSED + reversión en 01/2026, DRAFT 04/2026.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  c uuid := pg_temp.mig_empresa('002', 'B-20260625-bloqueo-UI', '2026-01-01 03:00', '2026-12-31 03:00',
                                '2026-04-01 02:59:59.999', 6);
  fy uuid := '76076076-0003-4000-9000-000000000002';
BEGIN
  PERFORM pg_temp.mig_fy(fy, c, 1, '2026-01-01 03:00', '2026-12-31 03:00', '2025-12-01', '2027-01-01', 0, 13);
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000001', c, 1, '2026-02-10 00:00', 'DRAFT', 'MIG borrador febrero');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000002', c, 2, '2026-03-05 00:00', 'POSTED', 'MIG registrado marzo',
                              100, fy, pg_temp.mig_periodo(fy, 2026, 3));
  -- Nacen DRAFT (el trigger permite tocarlos) y pasan a REVERSED/POSTED al final.
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000004', c, 4, '2026-01-20 00:00', 'DRAFT', 'MIG reversión enero');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000003', c, 3, '2026-01-15 00:00', 'DRAFT', 'MIG anulado enero');
  UPDATE journal_entries SET reversal_entry_id = '76076076-0003-4000-a002-000000000004', status = 'REVERSED',
         reversed_at = '2026-01-20', reversed_by = 'u'
  WHERE id = '76076076-0003-4000-a002-000000000003';
  UPDATE journal_entries SET original_entry_id = '76076076-0003-4000-a002-000000000003', status = 'POSTED'
  WHERE id = '76076076-0003-4000-a002-000000000004';
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000005', c, 5, '2026-04-08 00:00', 'DRAFT', 'MIG borrador abril');
  -- DRAFT anterior al FY apuntando al MONTHLY de más de 12/2025 (quedará sin FY y el período se borra)
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a002-000000000006', c, 6, '2025-12-20 00:00', 'DRAFT', 'MIG borrador antes del FY',
                              100, fy, pg_temp.mig_periodo(fy, 2025, 12));
END $$;

-- -------------------------------------------------------------------------------------
-- 003 (c, K): FY normalizado con ene-feb is_closed y bloqueo NULL. Asiento POSTED del
--   01/05 00:00Z mal imputado a abril (código viejo en hora local); apertura REVERSED y su
--   reversión POSTED en el OPENING (datos de la Fase 7): la reversión conserva el OPENING.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  c uuid := pg_temp.mig_empresa('003', 'C-meses-cerrados-sin-bloqueo', '2026-01-01 00:00', '2026-12-31 23:59:59.999');
  fy uuid := '76076076-0003-4000-9000-000000000003';
BEGIN
  PERFORM pg_temp.mig_fy(fy, c, 1, '2026-01-01 00:00', '2026-12-31 23:59:59.999', '2026-01-01', '2026-12-01', 1, 12);
  UPDATE accounting_periods SET is_closed = true, closed_at = '2026-03-02', closed_by = 'u'
  WHERE fiscal_year_id = fy AND type = 'MONTHLY' AND month IN (1, 2);
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a003-000000000001', c, 1, '2026-05-01 00:00', 'POSTED', 'MIG depreciación 01/05 00:00Z',
                              100, fy, pg_temp.mig_periodo(fy, 2026, 4));
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a003-000000000002', c, 2, '2026-01-01 00:00', 'REVERSED', 'Asiento de Apertura',
                              100, fy, pg_temp.mig_periodo(fy, 2026, 1, 'OPENING'));
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a003-000000000003', c, 3, '2026-01-01 00:00', 'POSTED',
                              'Anulación del asiento N° 2 - Asiento de Apertura', 100, fy, pg_temp.mig_periodo(fy, 2026, 1, 'OPENING'));
END $$;

-- -------------------------------------------------------------------------------------
-- 005 (e, Q, R): Ajustes 2025 sin FY; asientos antes del inicio (2024-12-15), dentro del
--   año siguiente a hoy (2027-03-10, crea FY 2027) y más allá del tope (2030-01-10).
-- -------------------------------------------------------------------------------------
DO $$
DECLARE c uuid := pg_temp.mig_empresa('005', 'E-fuera-de-ejercicio', '2025-01-01 03:00', '2025-12-31 03:00', NULL, 4);
BEGIN
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a005-000000000001', c, 1, '2024-12-15 00:00', 'POSTED', 'MIG antes del primer ejercicio');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a005-000000000002', c, 2, '2025-06-01 00:00', 'DRAFT', 'MIG 2025');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a005-000000000003', c, 3, '2027-03-10 00:00', 'DRAFT', 'MIG 2027 (dentro del tope)');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a005-000000000004', c, 4, '2030-01-10 00:00', 'DRAFT', 'MIG 2030 (año mal tipeado)');
END $$;

-- -------------------------------------------------------------------------------------
-- 006 (f): hueco — marzo cerrado, enero y febrero abiertos, bloqueo NULL.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  c uuid := pg_temp.mig_empresa('006', 'F-hueco', '2026-01-01 00:00', '2026-12-31 23:59:59.999');
  fy uuid := '76076076-0003-4000-9000-000000000006';
BEGIN
  PERFORM pg_temp.mig_fy(fy, c, 1, '2026-01-01 00:00', '2026-12-31 23:59:59.999', '2026-01-01', '2026-12-01', 1, 12);
  UPDATE accounting_periods SET is_closed = true WHERE fiscal_year_id = fy AND type = 'MONTHLY' AND month = 3;
END $$;

-- -------------------------------------------------------------------------------------
-- 007 (g, G, T, 12): FY 1 (2025) cerrado por el código viejo con noviembre y CLOSING
--   abiertos, refundición vinculada; FY 2 (2026) creado por el cierre viejo con el servidor
--   en UTC-3: fin 2027-01-01 02:59:59.999 y 13 MONTHLY (01/2026 a 01/2027), apertura
--   vinculada y OPENING abierto. Ajustes todavía en 2025. Cuenta de resultado INACTIVA con
--   saldo POSTED (la migración no la toca; la cuenta el diagnóstico, letra T).
-- -------------------------------------------------------------------------------------
DO $$
DECLARE
  c uuid := pg_temp.mig_empresa('007', 'G-cierre-viejo', '2025-01-01 03:00', '2025-12-31 03:00', NULL, 4);
  fy1 uuid := '76076076-0003-4000-9000-000000000071';
  fy2 uuid := '76076076-0003-4000-9000-000000000072';
  inactiva uuid := '76076076-0003-4000-8003-000000000007';
BEGIN
  INSERT INTO accounts (id, company_id, code, name, type, nature, is_active, updated_at)
  VALUES (inactiva, c, 'MIG-OTROS-ING', 'Otros ingresos (inactiva)', 'REVENUE', 'CREDIT', false, now());
  PERFORM pg_temp.mig_fy(fy1, c, 1, '2025-01-01 03:00', '2025-12-31 03:00', '2025-01-01', '2025-12-01', 0, 13, true);
  UPDATE accounting_periods SET is_closed = true WHERE fiscal_year_id = fy1 AND NOT (type = 'MONTHLY' AND month = 11) AND type <> 'CLOSING';
  PERFORM pg_temp.mig_fy(fy2, c, 2, '2026-01-01 00:00', '2027-01-01 02:59:59.999', '2026-01-01', '2027-01-01', 1, 1);
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a007-000000000001', c, 1, '2025-04-10 00:00', 'POSTED', 'MIG venta con cuenta hoy inactiva',
                              500, NULL, NULL, inactiva);
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a007-000000000002', c, 2, '2025-12-31 00:00', 'POSTED', 'Cierre de ejercicio fiscal 2025');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a007-000000000003', c, 3, '2026-01-01 00:00', 'POSTED', 'Apertura de ejercicio fiscal 2026');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a007-000000000004', c, 4, '2026-02-10 00:00', 'DRAFT', 'MIG borrador 2026');
  UPDATE fiscal_years SET closing_entry_id = '76076076-0003-4000-a007-000000000002' WHERE id = fy1;
  UPDATE fiscal_years SET opening_entry_id = '76076076-0003-4000-a007-000000000003' WHERE id = fy2;
END $$;

-- -------------------------------------------------------------------------------------
-- 008 (h, O, P): contador 10 con asientos 11 y 12 (caminos no atómicos) y un 999999 aislado.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE c uuid := pg_temp.mig_empresa('008', 'H-numeracion', '2026-01-01 03:00', '2026-12-31 03:00', NULL, 10);
BEGIN
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a008-000000000010', c, 10, '2026-02-01 12:00', 'POSTED', 'MIG 10');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a008-000000000011', c, 11, '2026-02-02 12:00', 'DRAFT', 'MIG 11');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a008-000000000012', c, 12, '2026-02-03 12:00', 'DRAFT', 'MIG 12');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a008-000000999999', c, 999999, '2026-07-10 00:00', 'DRAFT', 'dbg');
END $$;

-- -------------------------------------------------------------------------------------
-- 009 (robustez): Ajustes con rango inválido (fin anterior al inicio) y un asiento.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE c uuid := pg_temp.mig_empresa('009', 'I-rango-invalido', '2026-12-31 03:00', '2026-01-01 03:00', NULL, 1);
BEGIN
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a009-000000000001', c, 1, '2026-05-05 00:00', 'DRAFT', 'MIG rango inválido');
END $$;

-- -------------------------------------------------------------------------------------
-- 010 (meses_completos = f): Ajustes 15/01/2026 → 14/01/2027 sin FY, asientos en los dos eneros.
-- -------------------------------------------------------------------------------------
DO $$
DECLARE c uuid := pg_temp.mig_empresa('010', 'J-meses-incompletos', '2026-01-15 03:00', '2027-01-14 03:00', NULL, 2);
BEGIN
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a010-000000000001', c, 1, '2026-01-20 00:00', 'POSTED', 'MIG enero 2026');
  PERFORM pg_temp.mig_asiento('76076076-0003-4000-a010-000000000002', c, 2, '2027-01-10 00:00', 'DRAFT', 'MIG enero 2027');
END $$;

COMMIT;
\echo 'Escenarios TSK760-MIG sembrados.'
