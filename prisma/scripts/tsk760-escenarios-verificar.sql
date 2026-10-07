-- =====================================================================================
-- TSK-760, Fase 3 — Verifica el resultado de la migración tsk_760_fiscal_years_backfill
-- sobre los escenarios de tsk760-escenarios-migracion.sql. No escribe (ROLLBACK). Sale con error en
-- el primer esperado que no se cumple; si todo da, imprime "OK".
--
--   docker exec -i contable-pms-db psql -U postgres -d contable_tsk760_copia \
--     -v ON_ERROR_STOP=1 < prisma/scripts/tsk760-escenarios-verificar.sql
--
-- Pensado para correrse con "hoy" en 10/2026 (los FY hacia adelante dependen de la fecha).
-- =====================================================================================
\set ON_ERROR_STOP on
BEGIN; -- termina en ROLLBACK: no escribe nada (las funciones pg_temp se descartan)

CREATE OR REPLACE FUNCTION pg_temp.esperar(p_desc text, p_real text, p_esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_real IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION 'FALLA % — esperado [%], real [%]', p_desc, p_esperado, p_real;
  END IF;
END $$;

-- Ejercicios de una empresa: "N:inicio/fin/cerrado/MONTHLY" separados por ';'
CREATE OR REPLACE FUNCTION pg_temp.fys(p_n text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(f.number || ':' || f.start_date || '/' || f.end_date || '/' || f.is_closed || '/' ||
                    (SELECT count(*) FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY'),
                    ';' ORDER BY f.number)
  FROM fiscal_years f WHERE f.company_id = ('76076076-0003-4000-8000-000000000' || p_n)::uuid
$$;
-- OPENING/CLOSING de un FY: "año-mes:cerrado" de cada uno
CREATE OR REPLACE FUNCTION pg_temp.oc(p_n text, p_fy int) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(p.type || ' ' || p.year || '-' || p.month || ':' || p.is_closed, ',' ORDER BY p.type::text)
  FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
  WHERE f.company_id = ('76076076-0003-4000-8000-000000000' || p_n)::uuid AND f.number = p_fy
    AND p.type IN ('OPENING', 'CLOSING')
$$;
-- Meses MONTHLY cerrados de un FY ("1,2,3")
CREATE OR REPLACE FUNCTION pg_temp.cerrados(p_n text, p_fy int) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(p.month::text, ',' ORDER BY p.year, p.month), '')
  FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
  WHERE f.company_id = ('76076076-0003-4000-8000-000000000' || p_n)::uuid AND f.number = p_fy
    AND p.type = 'MONTHLY' AND p.is_closed
$$;
-- Ajustes: "inicio/fin/bloqueo/contador"
CREATE OR REPLACE FUNCTION pg_temp.ajustes(p_n text) RETURNS text LANGUAGE sql AS $$
  SELECT fiscal_year_start || '/' || fiscal_year_end || '/' || COALESCE(locked_until_date::text, 'NULL')
         || '/' || last_entry_number
  FROM accounting_settings WHERE company_id = ('76076076-0003-4000-8000-000000000' || p_n)::uuid
$$;
-- Asiento por número: "FY período-tipo" o "NULL"
CREATE OR REPLACE FUNCTION pg_temp.asiento(p_n text, p_num int) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(f.number || ' ' || p.year || '-' || p.month || ' ' || p.type, 'NULL')
  FROM journal_entries j
  LEFT JOIN fiscal_years f ON f.id = j.fiscal_year_id
  LEFT JOIN accounting_periods p ON p.id = j.period_id
  WHERE j.company_id = ('76076076-0003-4000-8000-000000000' || p_n)::uuid AND j.number = p_num
$$;

DO $$
BEGIN
  -- Triggers
  PERFORM pg_temp.esperar('triggers habilitados',
    (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('trg_journal_entry_immutable', 'trg_journal_entry_line_immutable') AND tgenabled = 'O'), '2');

  -- 001: vencido sin FY → 3 ejercicios de 12 meses; Ajustes = FY 1; apertura en OPENING
  PERFORM pg_temp.esperar('001 ejercicios', pg_temp.fys('001'),
    '1:2024-01-01 00:00:00/2024-12-31 23:59:59.999/false/12;2:2025-01-01 00:00:00/2025-12-31 23:59:59.999/false/12;3:2026-01-01 00:00:00/2026-12-31 23:59:59.999/false/12');
  PERFORM pg_temp.esperar('001 OPENING/CLOSING FY1', pg_temp.oc('001', 1), 'CLOSING 2024-12:false,OPENING 2024-1:false');
  PERFORM pg_temp.esperar('001 Ajustes', pg_temp.ajustes('001'), '2024-01-01 00:00:00/2024-12-31 23:59:59.999/NULL/5');
  PERFORM pg_temp.esperar('001 N°1 apertura', pg_temp.asiento('001', 1), '1 2024-1 OPENING');
  PERFORM pg_temp.esperar('001 N°3 día 1 00:30Z', pg_temp.asiento('001', 3), '2 2025-2 MONTHLY');
  PERFORM pg_temp.esperar('001 N°5 2026', pg_temp.asiento('001', 5), '3 2026-3 MONTHLY');

  -- 002: 20260625 + bloqueo UI → ene-mar cerrados, meses de más borrados, 0/13 corregidos
  PERFORM pg_temp.esperar('002 ejercicios', pg_temp.fys('002'), '1:2026-01-01 00:00:00/2026-12-31 23:59:59.999/false/12');
  PERFORM pg_temp.esperar('002 meses cerrados', pg_temp.cerrados('002', 1), '1,2,3');
  PERFORM pg_temp.esperar('002 OPENING/CLOSING', pg_temp.oc('002', 1), 'CLOSING 2026-12:false,OPENING 2026-1:false');
  PERFORM pg_temp.esperar('002 Ajustes', pg_temp.ajustes('002'), '2026-01-01 00:00:00/2026-12-31 23:59:59.999/2026-03-31 23:59:59.999/6');
  PERFORM pg_temp.esperar('002 N°1 DRAFT feb', pg_temp.asiento('002', 1), '1 2026-2 MONTHLY');
  PERFORM pg_temp.esperar('002 N°2 POSTED mar', pg_temp.asiento('002', 2), '1 2026-3 MONTHLY');
  PERFORM pg_temp.esperar('002 N°3 REVERSED', pg_temp.asiento('002', 3), '1 2026-1 MONTHLY');
  PERFORM pg_temp.esperar('002 N°4 reversión', pg_temp.asiento('002', 4), '1 2026-1 MONTHLY');
  PERFORM pg_temp.esperar('002 N°6 antes del FY', pg_temp.asiento('002', 6), 'NULL');

  -- 003: ene-feb cerrados sin bloqueo → bloqueo 28/02; 01/05 00:00Z a mayo; OPENING conservado
  PERFORM pg_temp.esperar('003 meses cerrados', pg_temp.cerrados('003', 1), '1,2');
  PERFORM pg_temp.esperar('003 Ajustes', pg_temp.ajustes('003'), '2026-01-01 00:00:00/2026-12-31 23:59:59.999/2026-02-28 23:59:59.999/3');
  PERFORM pg_temp.esperar('003 N°1 mal imputado', pg_temp.asiento('003', 1), '1 2026-5 MONTHLY');
  PERFORM pg_temp.esperar('003 N°2 apertura REVERSED', pg_temp.asiento('003', 2), '1 2026-1 OPENING');
  PERFORM pg_temp.esperar('003 N°3 reversión de apertura', pg_temp.asiento('003', 3), '1 2026-1 OPENING');

  -- 005: fuera de ejercicio → FY 2025, 2026 y 2027 (por el asiento 03/2027); 2030 y 2024 sin FY
  PERFORM pg_temp.esperar('005 ejercicios', pg_temp.fys('005'),
    '1:2025-01-01 00:00:00/2025-12-31 23:59:59.999/false/12;2:2026-01-01 00:00:00/2026-12-31 23:59:59.999/false/12;3:2027-01-01 00:00:00/2027-12-31 23:59:59.999/false/12');
  PERFORM pg_temp.esperar('005 N°1 antes', pg_temp.asiento('005', 1), 'NULL');
  PERFORM pg_temp.esperar('005 N°3 2027', pg_temp.asiento('005', 3), '3 2027-3 MONTHLY');
  PERFORM pg_temp.esperar('005 N°4 2030', pg_temp.asiento('005', 4), 'NULL');

  -- 006: hueco → ene-mar cerrados, bloqueo 31/03
  PERFORM pg_temp.esperar('006 meses cerrados', pg_temp.cerrados('006', 1), '1,2,3');
  PERFORM pg_temp.esperar('006 Ajustes', pg_temp.ajustes('006'), '2026-01-01 00:00:00/2026-12-31 23:59:59.999/2026-03-31 23:59:59.999/0');

  -- 007: cierre viejo → FY1 todo cerrado, FY2 normalizado (12 meses), OPENING FY2 cerrado (C7)
  PERFORM pg_temp.esperar('007 ejercicios', pg_temp.fys('007'),
    '1:2025-01-01 00:00:00/2025-12-31 23:59:59.999/true/12;2:2026-01-01 00:00:00/2026-12-31 23:59:59.999/false/12');
  PERFORM pg_temp.esperar('007 FY1 meses', pg_temp.cerrados('007', 1), '1,2,3,4,5,6,7,8,9,10,11,12');
  PERFORM pg_temp.esperar('007 FY1 OPENING/CLOSING', pg_temp.oc('007', 1), 'CLOSING 2025-12:true,OPENING 2025-1:true');
  PERFORM pg_temp.esperar('007 FY2 OPENING/CLOSING', pg_temp.oc('007', 2), 'CLOSING 2026-12:false,OPENING 2026-1:true');
  PERFORM pg_temp.esperar('007 Ajustes', pg_temp.ajustes('007'), '2026-01-01 00:00:00/2026-12-31 23:59:59.999/2025-12-31 23:59:59.999/4');
  PERFORM pg_temp.esperar('007 refundición', pg_temp.asiento('007', 2), '1 2025-12 CLOSING');
  PERFORM pg_temp.esperar('007 apertura', pg_temp.asiento('007', 3), '2 2026-1 OPENING');
  PERFORM pg_temp.esperar('007 cuenta inactiva intacta',
    (SELECT is_active::text FROM accounts WHERE id = '76076076-0003-4000-8003-000000000007'), 'false');

  -- 008: contador 10 + 11, 12 → 12; 999999 no lo mueve
  PERFORM pg_temp.esperar('008 Ajustes', pg_temp.ajustes('008'), '2026-01-01 00:00:00/2026-12-31 23:59:59.999/NULL/12');

  -- 009: rango inválido → sin FY, Ajustes sin tocar
  PERFORM pg_temp.esperar('009 ejercicios', pg_temp.fys('009'), NULL);
  PERFORM pg_temp.esperar('009 Ajustes', pg_temp.ajustes('009'), '2026-12-31 03:00:00/2026-01-01 03:00:00/NULL/1');
  PERFORM pg_temp.esperar('009 N°1', pg_temp.asiento('009', 1), 'NULL');

  -- 010: meses incompletos → FY 15/01/2026-14/01/2027 con 13 MONTHLY
  PERFORM pg_temp.esperar('010 ejercicios', pg_temp.fys('010'), '1:2026-01-15 00:00:00/2027-01-14 23:59:59.999/false/13');
  PERFORM pg_temp.esperar('010 N°2 enero 2027', pg_temp.asiento('010', 2), '1 2027-1 MONTHLY');

  -- Invariantes globales (todas las empresas de la base)
  PERFORM pg_temp.esperar('asientos con FY y sin período',
    (SELECT count(*)::text FROM journal_entries WHERE fiscal_year_id IS NOT NULL AND period_id IS NULL), '0');
  PERFORM pg_temp.esperar('FY sin normalizar',
    (SELECT count(*)::text FROM fiscal_years WHERE start_date <> start_date::date
       OR end_date <> end_date::date + interval '1 day' - interval '1 millisecond'), '0');
  PERFORM pg_temp.esperar('FY sin exactamente un OPENING y un CLOSING',
    (SELECT count(*)::text FROM fiscal_years f WHERE
       (SELECT count(*) FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING') <> 1
       OR (SELECT count(*) FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING') <> 1), '0');
  PERFORM pg_temp.esperar('MONTHLY fuera del rango de su FY',
    (SELECT count(*)::text FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
     WHERE p.type = 'MONTHLY' AND (make_date(p.year, p.month, 1) < date_trunc('month', f.start_date)::date
                                   OR make_date(p.year, p.month, 1) > date_trunc('month', f.end_date)::date)), '0');
  PERFORM pg_temp.esperar('asientos en un período de otro FY',
    (SELECT count(*)::text FROM journal_entries j JOIN accounting_periods p ON p.id = j.period_id
     WHERE p.fiscal_year_id IS DISTINCT FROM j.fiscal_year_id), '0');
  PERFORM pg_temp.esperar('consulta 6: meses desincronizados',
    (SELECT count(*)::text FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
       JOIN accounting_settings s ON s.company_id = f.company_id
     WHERE p.type = 'MONTHLY' AND p.is_closed <> (s.locked_until_date IS NOT NULL
       AND (make_date(p.year, p.month, 1) + interval '1 month - 1 day')::date <= s.locked_until_date::date)), '0');
END $$;

ROLLBACK;
\echo 'OK: todos los escenarios TSK760-MIG dan lo esperado.'
