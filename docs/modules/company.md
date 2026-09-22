# Modulo Empresa

**Rutas:** `/dashboard/company/*`
**Archivos:** `src/modules/company/`

Configuracion de la empresa activa: usuarios, roles, auditoria y 15+ catalogos.

---

## Usuarios

**Ruta:** `/company/general/users`
**Archivos:** `features/general/users/`

### Funcionalidades

- Lista paginada de miembros (enriquecida con datos de Clerk: email, nombre, avatar)
- Invitaciones pendientes
- Invitar usuario: email + rol + empleado opcional
- Cambiar rol de miembro
- Desactivar miembro (soft-delete)

### Reglas

- Invitaciones expiran en 7 dias
- No se pueden invitar emails que ya son miembros
- Owners no pueden ser desactivados ni tener su rol cambiado
- Un miembro no puede desactivarse a si mismo
- Opcionalmente se vincula un `employeeId` a la invitacion
- Todas las acciones generan un registro de auditoria

---

## Roles

**Ruta:** `/company/general/roles`
**Archivos:** `features/general/roles/`, `features/general/shared/` (`_MemberIdentity.tsx`,
`member-display.ts`: avatar + nombre + email reutilizados por Usuarios y por el popover de Roles)

### Funcionalidades

- Lista paginada de roles con conteo de miembros. El contador de la columna **Usuarios** es un
  Popover (`components/_RoleMembersPopover.tsx`) que lista los miembros **activos** del rol
  (avatar, nombre, email, badge "Propietario" si `isOwner`), avisa cuantos inactivos conservan el
  rol ("+N inactivos conservan este rol") y ofrece el link "Gestionar en Usuarios" solo si el
  usuario tiene `company.general.users:view` (`RolesList.tsx` lo resuelve con
  `getModulePermissions` y lo pasa como `canViewUsers`). Con 0 miembros el trigger queda
  deshabilitado; con 0 activos y N inactivos abre y muestra "Ningun usuario activo tiene este rol".
- Crear rol con permisos (matriz modulo x accion)
- Editar permisos (reemplaza todos atomicamente)
- Eliminar rol (solo si no tiene miembros asignados)

### Nota tecnica: miembros por rol (TSK-692)

- `getRolesPaginated` selecciona `members` con `where: { isActive: true }` (orden `isOwner desc,
  createdAt asc`) y los enriquece con **un unico** `prisma.user.findMany` en lote para toda la
  pagina (email, nombre, apellido, avatar; fallback `'Sin email'`). Cada rol devuelve `members` e
  `inactiveMembersCount = _count.members - members.length`. Tipos exportados: `RoleListItem`,
  `RoleMember`.
- `_count.members` **no cambio**: sigue contando activos + inactivos. Es el numero que muestra la
  columna y el que usan la regla de "Eliminar" en `columns.tsx` (`_count.members === 0`) y
  `deleteRole`. Un miembro desactivado conserva su `roleId`, por eso el rol no se puede borrar
  aunque el popover no lo liste.
- El popover no hace fetch: todos los datos vienen en la fila (`role`).

### Roles del Sistema

| Slug | Nombre | Editable | Eliminable |
|------|--------|----------|------------|
| `owner` | Propietario | Solo permisos | No |
| `developer` | Desarrollador | Solo permisos | No |
| `admin` | Administrador | Solo permisos | No |

### Permisos

La matriz de permisos tiene 50+ modulos y 4 acciones (view, create, update, delete).

Los permisos se agrupan en la UI por:
- Principal (dashboard, empleados, equipos, documentos, contabilidad)
- Comercial (20+ sub-modulos)
- Config General (usuarios, roles, auditoria)
- Config RRHH (catalogos laborales)
- Config Equipos (catalogos de vehiculos)
- Config Documentos
- Config Contable

---

## Auditoria

**Ruta:** `/company/general/audit`
**Archivos:** `features/general/audit/`

Log de solo lectura que registra:
- Creacion/edicion/eliminacion de roles
- Cambios de permisos
- Invitaciones enviadas/aceptadas/canceladas
- Cambios de rol de miembros
- Activacion/desactivacion de miembros

Cada entrada incluye: quien lo hizo, que accion, sobre que, valores anterior/nuevo.

---

## Catalogos

Todos los catalogos siguen el mismo patron:

```
features/{catalogo}/list/
├── actions.server.ts    # CRUD + paginado
├── {Catalogo}List.tsx   # Server Component
├── components/
│   └── _Table.tsx       # Client Component
└── index.ts
```

### Acciones Estandar por Catalogo

| Accion | Descripcion |
|--------|-------------|
| `get{Entity}Paginated` | Lista paginada con busqueda |
| `get{Entities}ForSelect` | Lista ligera para dropdowns |
| `get{Entity}ById` | Detalle |
| `create{Entity}` | Crear (aislado por empresa) |
| `update{Entity}` | Actualizar (verifica propiedad) |
| `delete{Entity}` | Soft-delete (isActive = false) |

### Catalogos Disponibles

**RRHH:**
| Catalogo | Ruta | Relaciones |
|----------|------|------------|
| Tipos de Contrato | `/company/contract-types` | → Employee |
| Puestos de Trabajo | `/company/job-positions` | → Employee, DocumentType |
| Sindicatos | `/company/unions` | → CollectiveAgreement |
| Convenios Colectivos | `/company/collective-agreements` | → JobCategory |
| Categorias Laborales | `/company/job-categories` | → Employee |
| Centros de Costo | `/company/cost-centers` | → Employee, Vehicle, JournalEntryLine |

**Equipos:**
| Catalogo | Ruta | Relaciones |
|----------|------|------------|
| Marcas | `/company/vehicle-brands` | → VehicleModel |
| Tipos de Equipo | `/company/vehicle-types` | → Vehicle |
| Titulares | `/company/equipment-owners` | → Vehicle |
| Sectores | `/company/sectors` | → Vehicle |
| Tipos Operativos | `/company/type-operatives` | → Vehicle |
| Contratistas | `/company/contractors` | → ContractorVehicle, ContractorEmployee |

**Documentos:**
| Catalogo | Ruta |
|----------|------|
| Tipos de Documento | `/company/document-types` (gestionado por modulo Documents) |

**Centros de Costo — acceso al informe contable (TSK-719):** el menu de cada centro incluye
**"Ver movimientos"**, que navega por URL a
`/dashboard/company/accounting/reports?report=cost-center-movements&costCenterId=<uuid>` (el modulo
`company` no importa nada de `accounting`). El item se muestra solo si el usuario tiene
`accounting.reports.view` (`getModulePermissions` en `CostCentersList.tsx`) **y** el modulo
Contabilidad esta activo para la empresa (`isModuleActiveForCompany`, porque `getModulePermissions`
resuelve RBAC pero no mira `activeModules`). Ver
[Modulo Contabilidad](accounting.md#movimientos-por-centro-de-costo-tsk-719).
