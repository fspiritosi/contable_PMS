-- TSK-793: otorga el permiso `commercial.treasury.investments`
-- (view/create/update/delete/approve) al rol de sistema "admin" (slug 'admin') de TODAS
-- las empresas existentes.
--
-- Por qué: las empresas nuevas reciben la matriz completa al inicializarse
-- (initializeCompanyRbac), pero las existentes no tienen filas para el módulo nuevo.
-- Replica el modelo de rbac-init.ts: una fila company_role_permissions por
-- (role_id, module, action_id); el Administrador no tiene restricciones en este módulo.
-- `approve` se usa para la valuación al cierre del ejercicio.
--
-- Idempotente: ON CONFLICT sobre el unique (role_id, module, action_id). Se puede correr
-- varias veces; solo inserta lo que falta.
--
-- Cómo correrlo (en el contenedor de Postgres):
--   docker exec -i contable-pms-db psql -U postgres -d contable_pms \
--     -v ON_ERROR_STOP=1 < prisma/scripts/tsk793-otorgar-permiso-inversiones.sql

BEGIN;

INSERT INTO company_role_permissions (module, role_id, action_id)
SELECT 'commercial.treasury.investments', r.id, a.id
FROM company_roles r
CROSS JOIN actions a
WHERE r.slug = 'admin'
  AND r.is_system = true
  AND a.slug IN ('view', 'create', 'update', 'delete', 'approve')
ON CONFLICT (role_id, module, action_id) DO NOTHING;

COMMIT;

-- Verificación: cada rol admin de sistema debe tener 5 acciones (faltan = 0 filas).
SELECT r.company_id, r.slug, count(p.id) AS acciones
FROM company_roles r
LEFT JOIN company_role_permissions p
  ON p.role_id = r.id AND p.module = 'commercial.treasury.investments'
WHERE r.slug = 'admin' AND r.is_system = true
GROUP BY r.company_id, r.slug
HAVING count(p.id) <> 5;

SELECT count(*) AS roles_admin_con_5_acciones
FROM (
  SELECT r.id
  FROM company_roles r
  JOIN company_role_permissions p
    ON p.role_id = r.id AND p.module = 'commercial.treasury.investments'
  WHERE r.slug = 'admin' AND r.is_system = true
  GROUP BY r.id
  HAVING count(*) = 5
) t;
