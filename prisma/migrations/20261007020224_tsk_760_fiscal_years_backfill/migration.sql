-- =====================================================================================
-- TSK-760: ejercicios y períodos para todas las empresas con Ajustes, bloqueo de meses
-- sincronizado (A1/D3), fiscal_year_id/period_id en todos los asientos (D4) y contador
-- de numeración (C1). Ver .planes/tsk-760-cierre-contable.md §3.2.2 y sección 4, Fase 3.
--
-- Propiedades:
-- - TRANSACCIONAL: BEGIN/COMMIT explícitos (Prisma 7 no envuelve la migración, H1). Si
--   cualquier sentencia falla, la base queda como estaba (el DISABLE TRIGGER también se
--   revierte: es DDL transaccional) y Prisma la marca fallida (P3009).
-- - IDEMPOTENTE: cada paso tiene guarda (NOT EXISTS, ON CONFLICT, IS DISTINCT FROM).
--   Correrla dos veces deja exactamente lo mismo (huella de la consulta 14 del diagnóstico).
-- - SEGURA: no borra asientos ni líneas; solo borra períodos MONTHLY fuera del rango de su
--   ejercicio que ningún asiento referencia. El trigger de inmutabilidad se deshabilita
--   solo alrededor del UPDATE de fiscal_year_id/period_id. No toca journal_entries.updated_at.
-- - Funciona sobre una base vacía (shadow DB).
-- - Requiere ser dueño de journal_entries (consulta 0 / letra A del diagnóstico).
--
-- Convenciones que deja (las que espera el código de las fases 2 y 4 a 12):
-- - fiscal_years: start_date = día 00:00:00.000, end_date = último día 23:59:59.999 (UTC, D8).
-- - Cada FY: un OPENING (mes de inicio), un MONTHLY por mes calendario y un CLOSING (mes de fin).
-- - accounting_periods.is_closed manda; accounting_settings.locked_until_date = fin del último
--   MONTHLY cerrado de la racha contigua, o NULL (derivado, A1).
-- - accounting_settings.fiscal_year_start/end = rango del FY abierto más antiguo (D11).
-- - last_entry_number = fin de la racha contigua que lo sigue (C1; un número aislado no lo mueve).
-- =====================================================================================
BEGIN;

-- Día de fin de un timestamp. Un fin guardado como "fin del día local" con el servidor en
-- UTC-3 (02:59:59.999 del día siguiente en UTC, B22) pertenece al día anterior.
CREATE OR REPLACE FUNCTION pg_temp.tsk760_dia_fin(ts timestamp) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN ts::time = time '02:59:59.999' THEN (ts - interval '3 hours')::date
              ELSE ts::date END
$$;

-- =====================================================================================
-- Paso 1: normalizar los ejercicios existentes a días UTC (D8) y OPENING/CLOSING (D12)
-- =====================================================================================
UPDATE fiscal_years
SET start_date = start_date::date,
    end_date   = pg_temp.tsk760_dia_fin(end_date) + interval '1 day' - interval '1 millisecond',
    updated_at = now()
WHERE start_date <> start_date::date
   OR end_date <> pg_temp.tsk760_dia_fin(end_date) + interval '1 day' - interval '1 millisecond';

-- month = 0/13 de la migración 20260625 → mes real de inicio/fin. Si el FY tuviera dos
-- OPENING (o dos CLOSING), no se pisa la clave única: el duplicado queda y se informa.
UPDATE accounting_periods p
SET year = EXTRACT(YEAR FROM f.start_date)::int, month = EXTRACT(MONTH FROM f.start_date)::int,
    updated_at = now()
FROM fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'OPENING'
  AND (p.year, p.month) IS DISTINCT FROM
      (EXTRACT(YEAR FROM f.start_date)::int, EXTRACT(MONTH FROM f.start_date)::int)
  AND NOT EXISTS (SELECT 1 FROM accounting_periods q
                  WHERE q.fiscal_year_id = p.fiscal_year_id AND q.type = 'OPENING' AND q.id <> p.id);

UPDATE accounting_periods p
SET year = EXTRACT(YEAR FROM f.end_date)::int, month = EXTRACT(MONTH FROM f.end_date)::int,
    updated_at = now()
FROM fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'CLOSING'
  AND (p.year, p.month) IS DISTINCT FROM
      (EXTRACT(YEAR FROM f.end_date)::int, EXTRACT(MONTH FROM f.end_date)::int)
  AND NOT EXISTS (SELECT 1 FROM accounting_periods q
                  WHERE q.fiscal_year_id = p.fiscal_year_id AND q.type = 'CLOSING' AND q.id <> p.id);

-- =====================================================================================
-- Paso 2: FY 1 para empresas con Ajustes y sin ejercicios (B2/B23) y ejercicios
--         contiguos de 12 meses hasta cubrir hoy o el último asiento (tope: hoy + 1 año, C8)
-- =====================================================================================
-- Rango de Ajustes inválido (fin <= inicio): no se crea nada y se informa en el paso 8.
INSERT INTO fiscal_years (company_id, number, start_date, end_date, updated_at)
SELECT s.company_id, 1,
       s.fiscal_year_start::date,
       pg_temp.tsk760_dia_fin(s.fiscal_year_end) + interval '1 day' - interval '1 millisecond',
       now()
FROM accounting_settings s
WHERE NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)
  AND pg_temp.tsk760_dia_fin(s.fiscal_year_end) > s.fiscal_year_start::date;

DO $$
DECLARE
  r        record;
  last_fy  record;
  v_start  date;
  v_hoy    date := (now() AT TIME ZONE 'UTC')::date;
  creados  int := 0;
BEGIN
  -- Objetivo: hoy, o el último asiento si es posterior, ignorando los que pasan el tope
  -- (un año mal tipeado, p. ej. 2030, no crea ejercicios: queda sin FY y se informa).
  FOR r IN
    SELECT s.company_id,
           GREATEST(v_hoy,
                    COALESCE((SELECT max(j.date)::date FROM journal_entries j
                              WHERE j.company_id = s.company_id
                                AND j.date::date <= (v_hoy + interval '1 year')::date), v_hoy)
           ) AS objetivo
    FROM accounting_settings s
    WHERE EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)
  LOOP
    LOOP
      SELECT number, end_date INTO last_fy
      FROM fiscal_years WHERE company_id = r.company_id ORDER BY number DESC LIMIT 1;
      EXIT WHEN last_fy.end_date::date >= r.objetivo;
      v_start := last_fy.end_date::date + 1;
      INSERT INTO fiscal_years (company_id, number, start_date, end_date, updated_at)
      VALUES (r.company_id, last_fy.number + 1, v_start,
              v_start + interval '12 months' - interval '1 millisecond', now());
      creados := creados + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'TSK-760 paso 2: ejercicios siguientes creados: %', creados;
END $$;

-- =====================================================================================
-- Paso 3: períodos — OPENING, un MONTHLY por mes calendario del rango y CLOSING
-- =====================================================================================
INSERT INTO accounting_periods (fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT f.id, EXTRACT(YEAR FROM m)::int, EXTRACT(MONTH FROM m)::int, 'MONTHLY', false, now()
FROM fiscal_years f
CROSS JOIN LATERAL generate_series(date_trunc('month', f.start_date),
                                   date_trunc('month', f.end_date),
                                   interval '1 month') AS m
ON CONFLICT (fiscal_year_id, year, month, type) DO NOTHING;

INSERT INTO accounting_periods (fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT f.id, EXTRACT(YEAR FROM f.start_date)::int, EXTRACT(MONTH FROM f.start_date)::int,
       'OPENING', false, now()
FROM fiscal_years f
WHERE NOT EXISTS (SELECT 1 FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING');

INSERT INTO accounting_periods (fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT f.id, EXTRACT(YEAR FROM f.end_date)::int, EXTRACT(MONTH FROM f.end_date)::int,
       'CLOSING', false, now()
FROM fiscal_years f
WHERE NOT EXISTS (SELECT 1 FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING');

-- =====================================================================================
-- Paso 4: fiscal_year_id/period_id de TODOS los asientos (D4), por día UTC. El trigger de
--         inmutabilidad se deshabilita SOLO alrededor de este UPDATE (nada más en el medio).
--         - FY: el que contiene el día del asiento (si hubiera dos, el de menor número);
--           sin FY → NULL (anteriores al primero o más allá del tope; se informan).
--         - Período: refundición → CLOSING; apertura generada o "Asiento de Apertura" del
--           día de inicio → OPENING; si ya está en el OPENING/CLOSING de ese FY (p. ej. la
--           reversión de una apertura, Fase 7) se conserva; si no, MONTHLY del mes UTC.
-- =====================================================================================
ALTER TABLE journal_entries DISABLE TRIGGER trg_journal_entry_immutable;

WITH destino AS (
  SELECT DISTINCT ON (j.id)
         j.id,
         f.id AS fy_id,
         CASE
           WHEN f.id IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM fiscal_years x WHERE x.closing_entry_id = j.id)
             THEN (SELECT p.id FROM accounting_periods p
                   WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING' ORDER BY p.id LIMIT 1)
           WHEN EXISTS (SELECT 1 FROM fiscal_years x WHERE x.opening_entry_id = j.id)
             OR (j.description = 'Asiento de Apertura' AND j.date::date = f.start_date::date)
             THEN (SELECT p.id FROM accounting_periods p
                   WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING' ORDER BY p.id LIMIT 1)
           WHEN EXISTS (SELECT 1 FROM accounting_periods p
                        WHERE p.id = j.period_id AND p.fiscal_year_id = f.id
                          AND p.type IN ('OPENING', 'CLOSING'))
             THEN j.period_id
           ELSE (SELECT p.id FROM accounting_periods p
                 WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY'
                   AND p.year = EXTRACT(YEAR FROM j.date)::int
                   AND p.month = EXTRACT(MONTH FROM j.date)::int)
         END AS period_id
  FROM journal_entries j
  LEFT JOIN fiscal_years f
    ON f.company_id = j.company_id
   AND j.date::date BETWEEN f.start_date::date AND f.end_date::date
  ORDER BY j.id, f.number
)
UPDATE journal_entries j
SET fiscal_year_id = d.fy_id, period_id = d.period_id
FROM destino d
WHERE d.id = j.id
  AND (j.fiscal_year_id IS DISTINCT FROM d.fy_id OR j.period_id IS DISTINCT FROM d.period_id);

ALTER TABLE journal_entries ENABLE TRIGGER trg_journal_entry_immutable;

-- =====================================================================================
-- Paso 5: MONTHLY fuera del rango de su FY (20260625 creaba siempre 12; el bug de 13 meses
--         del cierre viejo). Después del paso 4, para que los asientos ya se hayan movido a
--         su período correcto. Solo si ningún asiento lo referencia (el SET NULL de la FK
--         tocaría asientos POSTED).
-- =====================================================================================
DELETE FROM accounting_periods p
USING fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'MONTHLY'
  AND (make_date(p.year, p.month, 1) < date_trunc('month', f.start_date)::date
       OR make_date(p.year, p.month, 1) > date_trunc('month', f.end_date)::date)
  AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.period_id = p.id);

-- =====================================================================================
-- Paso 6: is_closed por unión (D3), FY cerrados, huecos, OPENING tras un cierre (C7),
--         locked_until_date derivado y fechas de Ajustes (D11)
-- =====================================================================================
DO $$
DECLARE n_union int; n_fy int; n_apertura int; n_hueco int; n_lock int; n_ajustes int;
BEGIN
  -- 6a. unión: is_closed actual O fin_del_mes <= locked_until_date (por día)
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, now()),
      closed_by = COALESCE(p.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f JOIN accounting_settings s ON s.company_id = f.company_id
  WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY' AND NOT p.is_closed
    AND s.locked_until_date IS NOT NULL
    AND (make_date(p.year, p.month, 1) + interval '1 month' - interval '1 day')::date
        <= s.locked_until_date::date;
  GET DIAGNOSTICS n_union = ROW_COUNT;

  -- 6b. FY cerrado → todos sus períodos cerrados (MONTHLY, OPENING, CLOSING)
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, f.closed_at, now()),
      closed_by = COALESCE(p.closed_by, f.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f
  WHERE p.fiscal_year_id = f.id AND f.is_closed AND NOT p.is_closed;
  GET DIAGNOSTICS n_fy = ROW_COUNT;

  -- 6c. C7: el OPENING del ejercicio que sigue a uno cerrado queda cerrado (lo hace el cierre)
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, prev.closed_at, now()),
      closed_by = COALESCE(p.closed_by, prev.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f
  JOIN fiscal_years prev ON prev.company_id = f.company_id AND prev.number = f.number - 1
  WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING' AND prev.is_closed AND NOT p.is_closed;
  GET DIAGNOSTICS n_apertura = ROW_COUNT;

  -- 6d. huecos: todo MONTHLY anterior al último MONTHLY cerrado de la empresa (A1)
  WITH ultimo AS (
    SELECT f.company_id, max(make_date(p.year, p.month, 1)) AS mes
    FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
    WHERE p.type = 'MONTHLY' AND p.is_closed
    GROUP BY f.company_id
  )
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, now()),
      closed_by = COALESCE(p.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f JOIN ultimo u ON u.company_id = f.company_id
  WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY' AND NOT p.is_closed
    AND make_date(p.year, p.month, 1) < u.mes;
  GET DIAGNOSTICS n_hueco = ROW_COUNT;

  -- 6e. locked_until_date = fin UTC del último MONTHLY cerrado (ya contiguo tras 6d), o NULL.
  --     Solo empresas con ejercicios (sin FY, el bloqueo heredado queda como está).
  WITH ultimo AS (
    SELECT f.company_id,
           max(make_date(p.year, p.month, 1)) + interval '1 month' - interval '1 millisecond' AS hasta
    FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
    WHERE p.type = 'MONTHLY' AND p.is_closed
    GROUP BY f.company_id
  )
  UPDATE accounting_settings s
  SET locked_until_date = u.hasta, updated_at = now()
  FROM (SELECT s2.company_id, u2.hasta FROM accounting_settings s2
        LEFT JOIN ultimo u2 ON u2.company_id = s2.company_id
        WHERE EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s2.company_id)) u
  WHERE u.company_id = s.company_id AND s.locked_until_date IS DISTINCT FROM u.hasta;
  GET DIAGNOSTICS n_lock = ROW_COUNT;

  -- 6f. fechas de Ajustes = rango del FY abierto más antiguo (D11)
  UPDATE accounting_settings s
  SET fiscal_year_start = f.start_date, fiscal_year_end = f.end_date, updated_at = now()
  FROM (SELECT DISTINCT ON (company_id) company_id, start_date, end_date
        FROM fiscal_years WHERE NOT is_closed ORDER BY company_id, number) f
  WHERE f.company_id = s.company_id
    AND (s.fiscal_year_start, s.fiscal_year_end) IS DISTINCT FROM (f.start_date, f.end_date);
  GET DIAGNOSTICS n_ajustes = ROW_COUNT;

  RAISE NOTICE 'TSK-760 paso 6: meses cerrados por unión %, por FY cerrado %, aperturas tras cierre %, por hueco %; bloqueos recalculados %; Ajustes alineados %',
    n_union, n_fy, n_apertura, n_hueco, n_lock, n_ajustes;
END $$;

-- =====================================================================================
-- Paso 7: contador = último número de la racha contigua que sigue al contador (C1).
--         Un número aislado (p. ej. 999999) no lo mueve: nextEntryNumberTx lo saltea.
-- =====================================================================================
UPDATE accounting_settings s
SET last_entry_number = x.ultimo_contiguo, updated_at = now()
FROM (
  SELECT s2.company_id,
         (SELECT min(j.number) FROM journal_entries j
          WHERE j.company_id = s2.company_id AND j.number > s2.last_entry_number
            AND NOT EXISTS (SELECT 1 FROM journal_entries k
                            WHERE k.company_id = j.company_id AND k.number = j.number + 1)
         ) AS ultimo_contiguo
  FROM accounting_settings s2
  WHERE EXISTS (SELECT 1 FROM journal_entries j
                WHERE j.company_id = s2.company_id AND j.number = s2.last_entry_number + 1)
) x
WHERE x.company_id = s.company_id;

-- =====================================================================================
-- Paso 8: controles finales e informe de lo que no se pudo asignar
-- =====================================================================================
DO $$
DECLARE r record;
BEGIN
  -- Red de seguridad: si el trigger no quedó habilitado, se aborta todo (ROLLBACK).
  IF EXISTS (SELECT 1 FROM pg_trigger
             WHERE tgname = 'trg_journal_entry_immutable' AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'TSK-760: trg_journal_entry_immutable no quedó habilitado';
  END IF;

  FOR r IN
    SELECT s.company_id, s.fiscal_year_start, s.fiscal_year_end FROM accounting_settings s
    WHERE NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)
  LOOP
    RAISE NOTICE 'TSK-760: empresa % sin ejercicio: rango de Ajustes inválido (% a %)',
      r.company_id, r.fiscal_year_start, r.fiscal_year_end;
  END LOOP;
  FOR r IN
    SELECT j.company_id, count(*) AS n, min(j.date)::date AS desde, max(j.date)::date AS hasta
    FROM journal_entries j WHERE j.fiscal_year_id IS NULL GROUP BY j.company_id
  LOOP
    RAISE NOTICE 'TSK-760: empresa % tiene % asientos fuera de todo ejercicio (% a %)',
      r.company_id, r.n, r.desde, r.hasta;
  END LOOP;
  FOR r IN
    SELECT j.company_id, count(*) AS n FROM journal_entries j
    WHERE j.fiscal_year_id IS NOT NULL AND j.period_id IS NULL GROUP BY j.company_id
  LOOP
    RAISE NOTICE 'TSK-760: empresa % tiene % asientos con ejercicio y sin período', r.company_id, r.n;
  END LOOP;
  FOR r IN
    SELECT p.fiscal_year_id, p.type, count(*) AS n FROM accounting_periods p
    WHERE p.type IN ('OPENING', 'CLOSING') GROUP BY 1, 2 HAVING count(*) > 1
  LOOP
    RAISE NOTICE 'TSK-760: el ejercicio % tiene % períodos %', r.fiscal_year_id, r.n, r.type;
  END LOOP;
  FOR r IN
    SELECT s.company_id, count(*) AS n, max(j.number) AS max_num
    FROM accounting_settings s JOIN journal_entries j ON j.company_id = s.company_id
    WHERE j.number > s.last_entry_number GROUP BY s.company_id
  LOOP
    RAISE NOTICE 'TSK-760: empresa % tiene % números aislados sobre el contador (máx %); nextEntryNumberTx los saltea',
      r.company_id, r.n, r.max_num;
  END LOOP;
END $$;

COMMIT;
