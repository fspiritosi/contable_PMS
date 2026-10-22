-- TSK-791: otorga el permiso `accounting.concepts` (view/create/update/delete) al rol de
-- sistema "admin" (slug 'admin') de TODAS las empresas existentes.
--
-- Por qué: las empresas nuevas reciben la matriz completa al inicializarse
-- (initializeCompanyRbac), pero las existentes no tienen filas para el módulo nuevo.
-- Replica el modelo de rbac-init.ts: una fila company_role_permissions por
-- (role_id, module, action_id); el Administrador no tiene restricciones en este módulo.
-- No se otorga `approve` (el módulo no lo usa).
--
-- Idempotente: ON CONFLICT sobre el unique (role_id, module, action_id). Se puede correr
-- varias veces; solo inserta lo que falta.
--
-- Cómo correrlo (en el contenedor de Postgres):
--   docker exec -i contable-pms-db psql -U postgres -d contable_pms \
--     -v ON_ERROR_STOP=1 < prisma/scripts/tsk791-otorgar-permiso-conceptos.sql

BEGIN;

INSERT INTO company_role_permissions (module, role_id, action_id)
SELECT 'accounting.concepts', r.id, a.id
FROM company_roles r
CROSS JOIN actions a
WHERE r.slug = 'admin'
  AND r.is_system = true
  AND a.slug IN ('view', 'create', 'update', 'delete')
ON CONFLICT (role_id, module, action_id) DO NOTHING;

COMMIT;

-- Verificación: cada rol admin de sistema debe tener 4 acciones (faltan = 0 filas).
SELECT r.company_id, r.slug, count(p.id) AS acciones
FROM company_roles r
LEFT JOIN company_role_permissions p
  ON p.role_id = r.id AND p.module = 'accounting.concepts'
WHERE r.slug = 'admin' AND r.is_system = true
GROUP BY r.company_id, r.slug
HAVING count(p.id) <> 4;

SELECT count(*) AS roles_admin_con_4_acciones
FROM (
  SELECT r.id
  FROM company_roles r
  JOIN company_role_permissions p ON p.role_id = r.id AND p.module = 'accounting.concepts'
  WHERE r.slug = 'admin' AND r.is_system = true
  GROUP BY r.id
  HAVING count(*) = 4
) t;
