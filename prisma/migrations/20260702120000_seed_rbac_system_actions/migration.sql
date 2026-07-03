-- Ticket #402: acciones globales del sistema RBAC (idempotente).
-- Las acciones son globales (no por empresa). Se garantiza su existencia por migración
-- para no depender del seed; `initializeCompanyRbac` también las asegura defensivamente.
INSERT INTO "actions" ("id", "slug", "name", "description", "created_at")
VALUES
  (gen_random_uuid(), 'view',    'Ver',     'Permite ver/listar recursos',          NOW()),
  (gen_random_uuid(), 'create',  'Crear',   'Permite crear nuevos recursos',        NOW()),
  (gen_random_uuid(), 'update',  'Editar',  'Permite modificar recursos existentes', NOW()),
  (gen_random_uuid(), 'delete',  'Eliminar','Permite eliminar recursos',            NOW()),
  (gen_random_uuid(), 'approve', 'Aprobar', 'Permite aprobar recursos',             NOW())
ON CONFLICT ("slug") DO NOTHING;
