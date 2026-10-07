#!/usr/bin/env bash
# =============================================================================
# TSK-760 — Diagnóstico de SOLO LECTURA del cierre contable (ejercicios, meses,
# bloqueo, numeración y asientos). Se corre ANTES y DESPUÉS del deploy.
# Ver .planes/tsk-760-cierre-contable.md §1.6.3, Fase 1 y §3.7.6.
#
# Uso:
#   bash prisma/scripts/diagnostico-tsk760.sh                 # producción (sudo docker, contablemas-contablemas)
#   bash prisma/scripts/diagnostico-tsk760.sh --local         # dev: contenedor contable-pms-db
#   bash prisma/scripts/diagnostico-tsk760.sh --db <contenedor>
#   bash prisma/scripts/diagnostico-tsk760.sh --local --database contable_tsk760_copia   # otra base del contenedor
#
# Guardar la salida:  bash prisma/scripts/diagnostico-tsk760.sh > diag-antes.txt 2>&1
#
# Garantías de solo lectura:
#   - todo el SQL corre dentro de `BEGIN TRANSACTION READ ONLY` y termina en `ROLLBACK`;
#   - además `SET default_transaction_read_only = on` (solo esta sesión, no persiste);
#   - los `SET LOCAL` (zona horaria y timeout) valen solo dentro de esa transacción;
#   - no hay INSERT/UPDATE/DELETE/ALTER/DROP/CREATE; `ON_ERROR_STOP` corta ante el primer error.
# =============================================================================
set -euo pipefail

MODE="prod"
CONTAINER=""
DATABASE=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local"; shift ;;
    --db)
      [[ $# -ge 2 ]] || { echo "Falta el nombre del contenedor después de --db" >&2; exit 2; }
      MODE="custom"; CONTAINER="$2"; shift 2 ;;
    --database)
      [[ $# -ge 2 ]] || { echo "Falta el nombre de la base después de --database" >&2; exit 2; }
      DATABASE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# docker con o sin sudo: en producción siempre sudo; en local, sudo solo si hace falta.
if [[ "$MODE" == "prod" ]]; then
  DOCKER=(sudo docker)
elif docker ps -q >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo docker)
fi

case "$MODE" in
  prod)
    CONTAINER="$("${DOCKER[@]}" ps -q --filter name=contablemas-contablemas)"
    if [[ -z "$CONTAINER" ]]; then
      echo "No se encontró el contenedor de Postgres (filtro name=contablemas-contablemas)." >&2
      exit 1
    fi
    if [[ "$(wc -l <<<"$CONTAINER")" -gt 1 ]]; then
      echo "Hay más de un contenedor que coincide con name=contablemas-contablemas:" >&2
      echo "$CONTAINER" >&2
      echo "Usá --db <id> con el que corresponda." >&2
      exit 1
    fi
    ;;
  local) CONTAINER="contable-pms-db" ;;
esac

echo "=============================================================================="
echo " TSK-760 — diagnóstico de cierre contable (SOLO LECTURA)"
echo " Modo: $MODE | contenedor: $CONTAINER | base: ${DATABASE:-\$POSTGRES_DB del contenedor}"
echo " Fecha del host: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================================================="
echo
echo "== Zona horaria del servidor de la APP (B22)"
echo "   Comando manual, en el servidor de producción:"
echo "     sudo docker exec \$(sudo docker ps -q --filter name=contablemas-frontend) printenv TZ"
echo "     sudo docker exec \$(sudo docker ps -q --filter name=contablemas-frontend) date"
echo "   Esperado: TZ vacío (sin definir) y date en UTC. Si TZ está definida (p. ej."
echo "   America/Argentina/Buenos_Aires), avisar: cambia la lectura de B22 y del bloqueo."
if [[ "$MODE" == "prod" ]]; then
  APP="$("${DOCKER[@]}" ps -q --filter name=contablemas-frontend | head -n 1 || true)"
  if [[ -n "$APP" ]]; then
    echo "   Resultado (contenedor $APP):"
    echo "     TZ   = $("${DOCKER[@]}" exec "$APP" printenv TZ 2>/dev/null || echo '(sin definir)')"
    echo "     date = $("${DOCKER[@]}" exec "$APP" date 2>/dev/null || echo '(no se pudo leer)')"
  else
    echo "   (no se encontró el contenedor de la app con name=contablemas-frontend)"
  fi
else
  echo "   Resultado en este host (modo $MODE, no es la app de prod):"
  echo "     TZ   = ${TZ:-(sin definir)}"
  echo "     date = $(date)"
fi
echo

"${DOCKER[@]}" exec -i "$CONTAINER" \
  sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -P pager=off' sh "$DATABASE" <<'SQL'
\set QUIET on
SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL TimeZone = 'UTC';
\set QUIET off

\echo '=============================================================================='
\echo '0) Permisos para la migración y estado de los triggers'
\echo '   La migración hace ALTER TABLE journal_entries DISABLE TRIGGER: el usuario'
\echo '   tiene que ser dueño (o superusuario). puede_alterar = f  =>  NO DEPLOYAR.'
\echo '=============================================================================='
SELECT current_user AS usuario,
       t.tableowner AS duenio_journal_entries,
       (r.rolsuper OR pg_has_role(current_user, t.tableowner, 'MEMBER')) AS puede_alterar,
       r.rolsuper AS superusuario,
       current_database() AS base,
       split_part(version(), ' ', 2) AS postgres
FROM pg_tables t JOIN pg_roles r ON r.rolname = current_user
WHERE t.schemaname = 'public' AND t.tablename = 'journal_entries';

SELECT tg.tgname AS trigger, c.relname AS tabla, tg.tgenabled AS estado,
       CASE tg.tgenabled WHEN 'O' THEN 'ok (habilitado)' ELSE 'REVISAR: no está habilitado' END AS lectura
FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
WHERE tg.tgname IN ('trg_journal_entry_immutable', 'trg_journal_entry_line_immutable')
ORDER BY 1;

\echo ''
\echo '-- Migraciones de Prisma: fallidas (deben ser 0 filas) y las 3 últimas aplicadas'
SELECT migration_name, started_at, 'FALLIDA (P3009)' AS estado
FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT migration_name, finished_at FROM _prisma_migrations
WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 3;

\echo ''
\echo '=============================================================================='
\echo '1) Empresas: Ajustes, ejercicios y bloqueo'
\echo '   bloqueo_hora = 02:59:59.999 => se guardó desde la UI con fin de mes local (B22).'
\echo '   EJERCICIO VENCIDO SIN CERRAR => el backfill crea más de un ejercicio (D1).'
\echo '   meses_completos = f => el rango de Ajustes no va de día 1 a fin de mes (C3).'
\echo '=============================================================================='
SELECT c.name AS empresa,
       s.fiscal_year_start::text AS ej_inicio_raw,
       s.fiscal_year_end::text AS ej_fin_raw,
       s.locked_until_date::text AS bloqueado_hasta_raw,
       to_char(s.locked_until_date, 'HH24:MI:SS.MS') AS bloqueo_hora,
       s.last_entry_number AS contador,
       (SELECT count(*) FROM fiscal_years f WHERE f.company_id = c.id) AS ejercicios,
       (SELECT count(*) FROM fiscal_years f WHERE f.company_id = c.id AND f.is_closed) AS ej_cerrados,
       CASE WHEN s.company_id IS NULL THEN NULL
            ELSE extract(day FROM s.fiscal_year_start) = 1
                 AND s.fiscal_year_end::date = (date_trunc('month', s.fiscal_year_end) + interval '1 month - 1 day')::date
       END AS meses_completos,
       CASE WHEN s.company_id IS NULL THEN 'SIN AJUSTES (no usa contabilidad)'
            WHEN s.fiscal_year_end < now() THEN 'EJERCICIO VENCIDO SIN CERRAR'
            ELSE 'ok' END AS estado,
       (SELECT count(*) FROM journal_entries j WHERE j.company_id = c.id) AS asientos
FROM companies c LEFT JOIN accounting_settings s ON s.company_id = c.id
ORDER BY asientos DESC, 1;

\echo ''
\echo '=============================================================================='
\echo '2) Asientos sin ejercicio/período (B7), por empresa y estado'
\echo '   Antes del deploy: esperable todo sin_ejercicio. Después: 0 (salvo los de la 13).'
\echo '=============================================================================='
SELECT c.name AS empresa, j.status::text AS estado, count(*) AS total,
       count(*) FILTER (WHERE j.fiscal_year_id IS NULL) AS sin_ejercicio,
       count(*) FILTER (WHERE j.period_id IS NULL) AS sin_periodo
FROM journal_entries j JOIN companies c ON c.id = j.company_id
GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '=============================================================================='
\echo '3) Asientos fuera del ejercicio de Ajustes, por mes'
\echo '   ANTES = anteriores al primer ejercicio (quedan sin FY, D1).'
\echo '   DESPUES = posteriores al fin (el backfill crea el ejercicio siguiente).'
\echo '=============================================================================='
SELECT c.name AS empresa, to_char(j.date, 'YYYY-MM') AS mes, j.status::text AS estado,
       CASE WHEN j.date::date < s.fiscal_year_start::date THEN 'ANTES' ELSE 'DESPUES' END AS lado,
       count(*) AS asientos
FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
JOIN companies c ON c.id = j.company_id
WHERE j.date::date < s.fiscal_year_start::date OR j.date::date > s.fiscal_year_end::date
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3;

\echo ''
\echo '=============================================================================='
\echo '4) Borradores en meses que quedarían cerrados (escenario 1 de 1.6.2)'
\echo '   Cada fila: asientos DRAFT que después del deploy no se pueden registrar'
\echo '   sin reabrir el mes. Si hay filas, avisar a la clienta ANTES del deploy.'
\echo '=============================================================================='
SELECT c.name AS empresa, to_char(j.date, 'YYYY-MM') AS mes, count(*) AS borradores
FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
JOIN companies c ON c.id = j.company_id
LEFT JOIN accounting_periods p ON p.id = j.period_id
WHERE j.status = 'DRAFT'
  AND ((s.locked_until_date IS NOT NULL AND j.date::date <= s.locked_until_date::date) OR p.is_closed)
GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '=============================================================================='
\echo '5) Ejercicios ya cerrados: borradores dentro (B4) y asientos creados después'
\echo '   Si hay filas, ya hubo un cierre anual en prod: revisar datos a mano.'
\echo '=============================================================================='
SELECT c.name AS empresa, f.number AS ejercicio, f.closed_at,
       count(j.id) FILTER (WHERE j.status = 'DRAFT') AS borradores,
       count(j.id) FILTER (WHERE j.created_at > f.closed_at
                             AND j.id IS DISTINCT FROM f.closing_entry_id) AS creados_post_cierre
FROM fiscal_years f JOIN companies c ON c.id = f.company_id
LEFT JOIN journal_entries j ON j.company_id = f.company_id
  AND j.date::date BETWEEN f.start_date::date AND f.end_date::date
WHERE f.is_closed
GROUP BY 1, 2, 3 ORDER BY 1, 2;

\echo ''
\echo '=============================================================================='
\echo '6) Meses (MONTHLY) cuyo is_closed no coincide con bloqueado_hasta (B3)'
\echo '   Escenario 2 de 1.6.2. El backfill los cierra por unión (D3).'
\echo '=============================================================================='
SELECT c.name AS empresa, p.year AS anio, p.month AS mes, p.is_closed,
       s.locked_until_date::date AS bloqueado_hasta,
       CASE WHEN p.is_closed THEN 'CERRADO pero después del bloqueo: hoy las integraciones pasan'
            ELSE 'ABIERTO dentro del bloqueo: hoy manuales y Registrar pasan' END AS efecto
FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
JOIN accounting_settings s ON s.company_id = f.company_id
JOIN companies c ON c.id = f.company_id
WHERE p.type = 'MONTHLY'
  AND p.is_closed <> (s.locked_until_date IS NOT NULL
       AND (make_date(p.year, p.month, 1) + interval '1 month - 1 day')::date
           <= s.locked_until_date::date)
ORDER BY 1, 2, 3;

\echo ''
\echo '=============================================================================='
\echo '7) Numeración: asientos por encima del contador (B8, C1)'
\echo '   racha_contigua = contador+1, +2... ocupados: el backfill sube el contador hasta ahí.'
\echo '   aislados = números sueltos más arriba: NO mueven el contador; se saltean (C1).'
\echo '=============================================================================='
WITH sobre AS (
  SELECT j.company_id, j.number, s.last_entry_number AS contador,
         row_number() OVER (PARTITION BY j.company_id ORDER BY j.number) AS rn
  FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
  WHERE j.number > s.last_entry_number
)
SELECT c.name AS empresa, min(x.contador) AS contador, max(x.number) AS max_numero,
       count(*) AS sobre_contador,
       count(*) FILTER (WHERE x.number - x.contador = x.rn) AS racha_contigua,
       count(*) FILTER (WHERE x.number - x.contador <> x.rn) AS aislados,
       left(string_agg(x.number::text, ',' ORDER BY x.number)
              FILTER (WHERE x.number - x.contador <> x.rn), 80) AS numeros_aislados
FROM sobre x JOIN companies c ON c.id = x.company_id
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '8) Comprobantes en BORRADOR con fecha en un mes bloqueado (escenario 4)'
\echo '   Fallarán al confirmar después del deploy (hoy fondos pasa).'
\echo '=============================================================================='
SELECT x.tipo, c.name AS empresa, count(*) AS comprobantes FROM (
  SELECT 'VENTA' AS tipo, d.company_id, d.issue_date AS fecha FROM sales_invoices d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'COMPRA', d.company_id, d.issue_date FROM purchase_invoices d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'RECIBO', d.company_id, d.date FROM receipts d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'OP', d.company_id, d.date FROM payment_orders d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'GASTO', d.company_id, d.date FROM expenses d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'FONDOS', d.company_id, d.date FROM fund_movements d WHERE d.status = 'DRAFT'
) x JOIN accounting_settings s ON s.company_id = x.company_id
JOIN companies c ON c.id = x.company_id
WHERE s.locked_until_date IS NOT NULL AND x.fecha::date <= s.locked_until_date::date
GROUP BY 1, 2 ORDER BY 2, 1;

\echo ''
\echo '=============================================================================='
\echo '9) Asientos desbalanceados (B21, C5)'
\echo '   POSTED desbalanceado = dato a corregir a mano. DRAFT desbalanceado = no se'
\echo '   podrá registrar y traba el cierre de su mes (C5/C6).'
\echo '=============================================================================='
SELECT c.name AS empresa, j.number AS numero, j.date::date AS fecha, j.status::text AS estado,
       left(j.description, 60) AS descripcion, sum(l.debit) AS debe, sum(l.credit) AS haber
FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id
JOIN companies c ON c.id = j.company_id
GROUP BY 1, 2, 3, 4, 5 HAVING abs(sum(l.debit) - sum(l.credit)) >= 0.01 ORDER BY 1, 2;

\echo ''
\echo '=============================================================================='
\echo '10) Asientos cuyo mes cambia entre UTC y UTC-3 (B22, D8)'
\echo '    En prod (UTC) no cambian de mes con el arreglo; solo informativo.'
\echo '=============================================================================='
SELECT c.name AS empresa, count(*) AS asientos
FROM journal_entries j JOIN companies c ON c.id = j.company_id
WHERE date_trunc('month', j.date) <> date_trunc('month', j.date - interval '3 hours')
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '11) Documentos vigentes con asiento REVERSED (B10)'
\echo '    Si hay filas: alguien anuló desde Asientos el asiento de un documento vivo.'
\echo '=============================================================================='
SELECT x.tipo, count(*) AS documentos FROM (
  SELECT 'VENTA' AS tipo, d.journal_entry_id FROM sales_invoices d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'COMPRA', d.journal_entry_id FROM purchase_invoices d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'RECIBO', d.journal_entry_id FROM receipts d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'OP', d.journal_entry_id FROM payment_orders d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'GASTO', d.journal_entry_id FROM expenses d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'FONDOS', d.journal_entry_id FROM fund_movements d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'DEPRECIACION', d.journal_entry_id FROM depreciation_schedule_entries d
  UNION ALL SELECT 'REVALUO', d.journal_entry_id FROM asset_value_adjustments d
) x JOIN journal_entries j ON j.id = x.journal_entry_id
WHERE j.status = 'REVERSED' GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '12) Ejercicios existentes: forma y coincidencia con Ajustes (D8, D12, C3)'
\echo '    apertura_mes/cierre_mes 0 y 13 = convención de la migración 20260625 (se'
\echo '    corrige). igual_a_ajustes = f en el ejercicio abierto => Ajustes y FY divergen.'
\echo '=============================================================================='
SELECT c.name AS empresa, f.number AS ejercicio,
       f.start_date::text AS inicio_raw, f.end_date::text AS fin_raw, f.is_closed AS cerrado,
       (SELECT count(*) FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY') AS meses,
       (SELECT count(*) FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY' AND p.is_closed) AS meses_cerrados,
       (SELECT string_agg(p.month::text, ',') FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING') AS apertura_mes,
       (SELECT string_agg(p.month::text, ',') FROM accounting_periods p WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING') AS cierre_mes,
       (f.start_date::date = s.fiscal_year_start::date AND f.end_date::date = s.fiscal_year_end::date) AS igual_a_ajustes,
       f.closing_entry_id IS NOT NULL AS tiene_refundicion,
       f.opening_entry_id IS NOT NULL AS tiene_apertura
FROM fiscal_years f JOIN companies c ON c.id = f.company_id
LEFT JOIN accounting_settings s ON s.company_id = f.company_id
ORDER BY 1, 2;

\echo ''
\echo '-- Empresas con Ajustes y SIN ningún ejercicio (las que crea el backfill, B2)'
SELECT c.name AS empresa, s.fiscal_year_start::date AS ej_inicio, s.fiscal_year_end::date AS ej_fin
FROM accounting_settings s JOIN companies c ON c.id = s.company_id
WHERE NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)
ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '13) Asientos que quedarían fuera de todo ejercicio (D1, C8)'
\echo '    antes_inicio: fecha anterior al inicio de Ajustes (quedan sin FY; si son DRAFT'
\echo '    ya no se podrán registrar). recientes = cargados en los últimos 90 días: indica'
\echo '    que la clienta sigue cargando fechas viejas. mas_alla_tope = fecha > hoy + 1 año.'
\echo '=============================================================================='
SELECT c.name AS empresa,
       count(*) FILTER (WHERE j.date::date < s.fiscal_year_start::date) AS antes_inicio,
       count(*) FILTER (WHERE j.date::date < s.fiscal_year_start::date AND j.status = 'DRAFT') AS antes_inicio_draft,
       count(*) FILTER (WHERE j.date::date < s.fiscal_year_start::date
                          AND j.created_at >= now() - interval '90 days') AS antes_inicio_creados_ult_90d,
       count(*) FILTER (WHERE j.date::date < s.fiscal_year_start::date
                          AND j.date >= now() - interval '90 days') AS antes_inicio_fecha_ult_90d,
       min(j.date::date) FILTER (WHERE j.date::date < s.fiscal_year_start::date) AS fecha_mas_vieja,
       count(*) FILTER (WHERE j.date > now() + interval '1 year') AS mas_alla_tope,
       max(j.date::date) FILTER (WHERE j.date > now() + interval '1 year') AS fecha_mas_lejana
FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
JOIN companies c ON c.id = j.company_id
GROUP BY 1
HAVING count(*) FILTER (WHERE j.date::date < s.fiscal_year_start::date OR j.date > now() + interval '1 year') > 0
ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '14) Huella (comparar antes/después del deploy y entre corridas de la migración)'
\echo '=============================================================================='
SELECT 'fy' AS t, md5(string_agg(concat_ws('|', company_id, number, start_date, end_date, is_closed,
        closing_entry_id, opening_entry_id), ',' ORDER BY company_id, number)) AS huella FROM fiscal_years
UNION ALL SELECT 'periodos', md5(string_agg(concat_ws('|', fiscal_year_id, year, month, type, is_closed),
        ',' ORDER BY fiscal_year_id, type, year, month)) FROM accounting_periods
UNION ALL SELECT 'asientos', md5(string_agg(concat_ws('|', id, fiscal_year_id, period_id, status, number),
        ',' ORDER BY id)) FROM journal_entries
UNION ALL SELECT 'ajustes', md5(string_agg(concat_ws('|', company_id, fiscal_year_start, fiscal_year_end,
        locked_until_date, last_entry_number), ',' ORDER BY company_id)) FROM accounting_settings;

\echo ''
\echo '=============================================================================='
\echo '15) Resultados que afectan la refundición (C4, H5)'
\echo '    Saldos POSTED de cuentas REVENUE/EXPENSE. inactivas_con_saldo > 0: hoy el'
\echo '    cierre las ignora (resultado mal calculado). resultado_previo_al_ejercicio'
\echo '    distinto de 0: resultados viejos sin refundir (C4 los incluye en el cierre).'
\echo '=============================================================================='
WITH saldos AS (
  SELECT j.company_id, a.id AS account_id, a.is_active,
         sum(l.debit - l.credit) AS saldo,
         sum(l.debit - l.credit) FILTER (WHERE j.date::date < s.fiscal_year_start::date) AS saldo_previo
  FROM journal_entry_lines l
  JOIN journal_entries j ON j.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  JOIN accounting_settings s ON s.company_id = j.company_id
  WHERE j.status = 'POSTED' AND a.type IN ('REVENUE', 'EXPENSE')
  GROUP BY 1, 2, 3
)
SELECT c.name AS empresa,
       count(*) FILTER (WHERE x.saldo <> 0) AS cuentas_resultado_con_saldo,
       count(*) FILTER (WHERE x.saldo <> 0 AND NOT x.is_active) AS inactivas_con_saldo,
       coalesce(sum(x.saldo) FILTER (WHERE NOT x.is_active), 0) AS saldo_inactivas,
       coalesce(sum(x.saldo_previo), 0) AS resultado_previo_al_ejercicio,
       coalesce(sum(x.saldo), 0) AS resultado_acumulado_debe_menos_haber
FROM saldos x JOIN companies c ON c.id = x.company_id
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '16) Borradores que trabarían el cierre de su mes (D2, C5, C6)'
\echo '    trabados = DRAFT desbalanceado o con alguna cuenta inactiva / no imputable.'
\echo '    sin_documento = borradores manuales que la nueva acción "Eliminar borrador"'
\echo '    podrá borrar (C6). trabados_con_documento: se corrigen desde el comprobante.'
\echo '=============================================================================='
WITH d AS (
  SELECT j.id, j.company_id,
         (abs(sum(l.debit) - sum(l.credit)) >= 0.01
          OR bool_or(NOT a.is_active OR NOT a.is_leaf)) AS trabado
  FROM journal_entries j
  JOIN journal_entry_lines l ON l.entry_id = j.id
  JOIN accounts a ON a.id = l.account_id
  WHERE j.status = 'DRAFT'
  GROUP BY 1, 2
), dl AS (
  SELECT d.*, EXISTS (
           SELECT 1 FROM sales_invoices x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM purchase_invoices x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM receipts x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM payment_orders x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM expenses x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM fund_movements x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM depreciation_schedule_entries x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM asset_value_adjustments x WHERE x.journal_entry_id = d.id
           UNION ALL SELECT 1 FROM fiscal_years x WHERE x.closing_entry_id = d.id OR x.opening_entry_id = d.id
         ) AS con_documento
  FROM d
)
SELECT c.name AS empresa, count(*) AS borradores,
       count(*) FILTER (WHERE NOT dl.con_documento) AS sin_documento,
       count(*) FILTER (WHERE dl.trabado) AS trabados,
       count(*) FILTER (WHERE dl.trabado AND NOT dl.con_documento) AS trabados_sin_documento,
       count(*) FILTER (WHERE dl.trabado AND dl.con_documento) AS trabados_con_documento
FROM dl JOIN companies c ON c.id = dl.company_id
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=============================================================================='
\echo '17) Facturas/NC/ND de venta y compra cuyo asiento no cuadra (R-1)'
\echo '    no_cuadra_total = el Debe o el Haber del asiento difiere del total guardado'
\echo '    del comprobante. desbalanceado = Debe <> Haber. Hasta la R-1 el asiento sumaba'
\echo '    el IVA redondeado por línea y el comprobante el IVA sobre la suma: diferencias'
\echo '    de 1-2 centavos (dif_max). de_ellos_draft: el asiento quedó en borrador y, si'
\echo '    está desbalanceado, no se podrá registrar (traba el cierre de su mes).'
\echo '=============================================================================='
WITH doc AS (
  SELECT 'VENTA' AS tipo, d.company_id, d.total, d.journal_entry_id FROM sales_invoices d
   WHERE d.status <> 'DRAFT' AND d.journal_entry_id IS NOT NULL
  UNION ALL
  SELECT 'COMPRA', d.company_id, d.total, d.journal_entry_id FROM purchase_invoices d
   WHERE d.status <> 'DRAFT' AND d.journal_entry_id IS NOT NULL
), cmp AS (
  SELECT doc.tipo, doc.company_id, j.status::text AS estado_asiento,
         sum(l.debit) AS debe, sum(l.credit) AS haber, doc.total
  FROM doc JOIN journal_entries j ON j.id = doc.journal_entry_id
  JOIN journal_entry_lines l ON l.entry_id = j.id
  GROUP BY doc.tipo, doc.company_id, doc.journal_entry_id, j.status, doc.total
)
SELECT c.name AS empresa, cmp.tipo, count(*) AS comprobantes,
       count(*) FILTER (WHERE cmp.debe <> cmp.total OR cmp.haber <> cmp.total) AS no_cuadra_total,
       count(*) FILTER (WHERE cmp.debe <> cmp.haber) AS desbalanceado,
       count(*) FILTER (WHERE (cmp.debe <> cmp.total OR cmp.haber <> cmp.total)
                          AND cmp.estado_asiento = 'POSTED') AS de_ellos_posted,
       count(*) FILTER (WHERE (cmp.debe <> cmp.total OR cmp.haber <> cmp.total)
                          AND cmp.estado_asiento = 'DRAFT') AS de_ellos_draft,
       max(greatest(abs(cmp.debe - cmp.total), abs(cmp.haber - cmp.total))) AS dif_max
FROM cmp JOIN companies c ON c.id = cmp.company_id
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE cmp.debe <> cmp.total OR cmp.haber <> cmp.total OR cmp.debe <> cmp.haber) > 0
ORDER BY 1, 2;

\echo ''
\echo '=============================================================================='
\echo 'RESUMEN — números para decidir (detalle en las secciones de arriba)'
\echo '=============================================================================='
WITH own AS (
  SELECT bool_and(r.rolsuper OR pg_has_role(current_user, t.tableowner, 'MEMBER')) AS ok
  FROM pg_tables t JOIN pg_roles r ON r.rolname = current_user
  WHERE t.schemaname = 'public' AND t.tablename = 'journal_entries'
), dsum AS (
  SELECT count(*) AS n FROM journal_entries j
  JOIN accounting_settings s ON s.company_id = j.company_id
  LEFT JOIN accounting_periods p ON p.id = j.period_id
  WHERE j.status = 'DRAFT'
    AND ((s.locked_until_date IS NOT NULL AND j.date::date <= s.locked_until_date::date) OR p.is_closed)
), unb AS (
  SELECT count(*) FILTER (WHERE status = 'POSTED') AS posted, count(*) FILTER (WHERE status = 'DRAFT') AS draft
  FROM (SELECT j.id, j.status FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id
        GROUP BY 1, 2 HAVING abs(sum(l.debit) - sum(l.credit)) >= 0.01) z
), num AS (
  SELECT count(*) FILTER (WHERE x.number - x.contador = x.rn) AS racha,
         count(*) FILTER (WHERE x.number - x.contador <> x.rn) AS aislados
  FROM (SELECT j.number, s.last_entry_number AS contador,
               row_number() OVER (PARTITION BY j.company_id ORDER BY j.number) AS rn
        FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
        WHERE j.number > s.last_entry_number) x
)
SELECT * FROM (VALUES
  ('A. usuario puede alterar journal_entries', (SELECT ok::text FROM own),
   'false = NO DEPLOYAR (la migración falla, P3009)'),
  ('B. triggers de inmutabilidad habilitados (de 2)',
   (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('trg_journal_entry_immutable','trg_journal_entry_line_immutable') AND tgenabled = 'O'),
   'distinto de 2 = revisar antes de deployar'),
  ('C. migraciones fallidas',
   (SELECT count(*)::text FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL),
   '> 0 = resolver antes de deployar'),
  ('D. empresas con Ajustes', (SELECT count(*)::text FROM accounting_settings), 'universo del backfill'),
  ('E. empresas con Ajustes sin ejercicio (B2)',
   (SELECT count(*)::text FROM accounting_settings s WHERE NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)),
   'reciben FY 1 (y siguientes) en la migración'),
  ('F. empresas con ejercicio vencido sin cerrar',
   (SELECT count(*)::text FROM accounting_settings WHERE fiscal_year_end < now()),
   '> 0 = el backfill crea más de un FY (D1/C8)'),
  ('G. ejercicios ya cerrados', (SELECT count(*)::text FROM fiscal_years WHERE is_closed),
   '> 0 = ya hubo cierre anual: revisar 5, 9 y 12 a mano'),
  ('H. empresas con bloqueo (locked_until_date)',
   (SELECT count(*)::text FROM accounting_settings WHERE locked_until_date IS NOT NULL), 'ver 1'),
  ('I. bloqueos guardados a las 02:59:59.999 (UI local)',
   (SELECT count(*)::text FROM accounting_settings WHERE to_char(locked_until_date, 'HH24:MI:SS.MS') = '02:59:59.999'),
   'I = 0 y app en UTC => B22 confirmada'),
  ('J. borradores en meses que quedarían cerrados (4)', (SELECT n::text FROM dsum),
   '> 0 = avisar a la clienta antes del deploy'),
  ('K. meses desincronizados is_closed vs bloqueo (6)',
   (SELECT count(*)::text FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
      JOIN accounting_settings s ON s.company_id = f.company_id
     WHERE p.type = 'MONTHLY'
       AND p.is_closed <> (s.locked_until_date IS NOT NULL
            AND (make_date(p.year, p.month, 1) + interval '1 month - 1 day')::date <= s.locked_until_date::date)),
   '> 0 = cambio de comportamiento (escenario 2): avisar'),
  ('L. comprobantes en borrador con fecha bloqueada (8)',
   (SELECT count(*)::text FROM (
      SELECT d.company_id, d.issue_date AS fecha FROM sales_invoices d WHERE d.status = 'DRAFT'
      UNION ALL SELECT d.company_id, d.issue_date FROM purchase_invoices d WHERE d.status = 'DRAFT'
      UNION ALL SELECT d.company_id, d.date FROM receipts d WHERE d.status = 'DRAFT'
      UNION ALL SELECT d.company_id, d.date FROM payment_orders d WHERE d.status = 'DRAFT'
      UNION ALL SELECT d.company_id, d.date FROM expenses d WHERE d.status = 'DRAFT'
      UNION ALL SELECT d.company_id, d.date FROM fund_movements d WHERE d.status = 'DRAFT') x
    JOIN accounting_settings s ON s.company_id = x.company_id
    WHERE s.locked_until_date IS NOT NULL AND x.fecha::date <= s.locked_until_date::date),
   '> 0 = fallarán al confirmar: avisar'),
  ('M. asientos POSTED desbalanceados (9)', (SELECT posted::text FROM unb), '> 0 = corregir a mano'),
  ('N. asientos DRAFT desbalanceados (9)', (SELECT draft::text FROM unb), '> 0 = trabarán el cierre de su mes'),
  ('O. numeración: racha contigua sobre el contador (7)', (SELECT racha::text FROM num), 'el backfill sube el contador'),
  ('P. numeración: números aislados (7)', (SELECT aislados::text FROM num), 'no mueven el contador (C1)'),
  ('Q. asientos antes del inicio de Ajustes (13)',
   (SELECT count(*)::text FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
     WHERE j.date::date < s.fiscal_year_start::date), '> 0 = quedan sin FY: informar'),
  ('R. asientos con fecha > hoy + 1 año (13, C8)',
   (SELECT count(*)::text FROM journal_entries WHERE date > now() + interval '1 year'), '> 0 = quedan sin FY: informar'),
  ('S. documentos vigentes con asiento REVERSED (11)',
   (SELECT count(*)::text FROM (
      SELECT d.journal_entry_id FROM sales_invoices d WHERE d.status <> 'CANCELLED'
      UNION ALL SELECT d.journal_entry_id FROM purchase_invoices d WHERE d.status <> 'CANCELLED'
      UNION ALL SELECT d.journal_entry_id FROM receipts d WHERE d.status = 'CONFIRMED'
      UNION ALL SELECT d.journal_entry_id FROM payment_orders d WHERE d.status = 'CONFIRMED'
      UNION ALL SELECT d.journal_entry_id FROM expenses d WHERE d.status <> 'CANCELLED'
      UNION ALL SELECT d.journal_entry_id FROM fund_movements d WHERE d.status = 'CONFIRMED'
      UNION ALL SELECT d.journal_entry_id FROM depreciation_schedule_entries d
      UNION ALL SELECT d.journal_entry_id FROM asset_value_adjustments d) x
    JOIN journal_entries j ON j.id = x.journal_entry_id WHERE j.status = 'REVERSED'),
   '> 0 = datos inconsistentes (B10): revisar'),
  ('T. cuentas de resultado inactivas con saldo (15)',
   (SELECT count(*)::text FROM (
      SELECT l.account_id FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.status = 'POSTED' AND a.type IN ('REVENUE','EXPENSE') AND NOT a.is_active
      GROUP BY 1 HAVING sum(l.debit - l.credit) <> 0) z),
   '> 0 = confirma H5/C4'),
  ('U. facturas/NC/ND con asiento que no cuadra con el total o desbalanceado (17, R-1)',
   (SELECT count(*)::text FROM (
      SELECT d.total, d.journal_entry_id FROM sales_invoices d
       WHERE d.status <> 'DRAFT' AND d.journal_entry_id IS NOT NULL
      UNION ALL SELECT d.total, d.journal_entry_id FROM purchase_invoices d
       WHERE d.status <> 'DRAFT' AND d.journal_entry_id IS NOT NULL) x
    JOIN LATERAL (SELECT sum(l.debit) AS debe, sum(l.credit) AS haber
                  FROM journal_entry_lines l WHERE l.entry_id = x.journal_entry_id) e ON true
    WHERE e.debe <> x.total OR e.haber <> x.total OR e.debe <> e.haber),
   '> 0 = asientos de comprobantes de antes de la R-1: corregir a mano (ver 17)')
) AS v(indicador, valor, como_leerlo);

\set QUIET on
ROLLBACK;
\echo ''
\echo '(fin del SQL: transacción de solo lectura descartada con ROLLBACK)'
SQL

cat <<'TXT'

==============================================================================
CÓMO DECIDIR (TSK-760, ver plan §1.6.3 y §3.7.6)
------------------------------------------------------------------------------
BLOQUEAN EL DEPLOY:
  A = false (el usuario de la base no es dueño de journal_entries)
  B != 2 (triggers de inmutabilidad deshabilitados)
  C > 0  (migración fallida pendiente)
CAMBIAN EL PLAN / LA MIGRACIÓN (Fase 3):
  E, F   cuántos ejercicios crea el backfill por empresa (y si alguna necesita varios)
  G > 0  ya hubo un cierre anual en prod: revisar secciones 5, 9 y 12 antes de migrar
  O, P   contador: racha contigua (se absorbe) vs. números aislados (se saltean, C1)
  Q, R   asientos que quedan sin ejercicio (informar a la clienta)
  T      cuentas de resultado inactivas con saldo (justifica C4/H5)
  12     ejercicios existentes con meses 0/13 o rango distinto de Ajustes
REQUIEREN AVISO A LA CLIENTA ANTES DEL DEPLOY (cambio de comportamiento):
  J, K, L  borradores/comprobantes que quedan en meses cerrados
  N y 16   borradores que trabarán el cierre de su mes (C6: "Eliminar borrador")
ZONA HORARIA (B22):
  I = 0 y la app en UTC (TZ vacío) => B22 confirmada: hoy nadie puede bloquear
  meses por la UI (H suele dar 0). I > 0 => se bloqueó con el servidor en hora
  local: la hipótesis cae para esa empresa y el backfill lo interpreta por día
  (fin de mes local = día 1 siguiente 02:59:59.999 UTC). H > 0 con otra hora:
  bloqueo cargado por otra vía (script o test); mirar la sección 1.
IVA DE FACTURAS DE VARIAS LÍNEAS (R-1):
  U > 0  comprobantes ya confirmados cuyo asiento difiere del total en centavos
         (el asiento sumaba el IVA redondeado por línea; el comprobante, el IVA
         sobre la suma). La R-1 corrige los que se confirmen desde el deploy; los
         existentes NO se tocan: si están en POSTED y desbalanceados, ajuste manual
         del contador; si su asiento está en DRAFT y desbalanceado, no se podrá
         registrar y trabará el cierre de su mes (ver 17: de_ellos_draft).
HUELLA (14): guardar la de antes y comparar con la de después del deploy.
==============================================================================
TXT
