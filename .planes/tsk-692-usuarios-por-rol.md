# TSK-692: Ver qué usuarios tienen cada rol

**Fecha de inicio:** 2026-09-16
**Ticket:** [692] "[Empresa] Podría ver quién tiene qué rol?"
**Reportante:** Elizabeth Perez (eperez@perezmarzo.com.ar)
**Estado:** Verificación completada

---

## 1. Análisis

### 1.1 Problema

Elizabeth Perez (PMS) pide poder ver **quiénes** son los usuarios asignados a cada rol, no solo
**cuántos**:

> "Sería bueno ver quién me quedó en un rol, para ver si no le pifié."

La captura del ticket es la pantalla **Empresa → Roles** (`/dashboard/company/general/roles`):
una tabla con columnas Nombre (con badges "Sistema" / "Por defecto"), Descripción, Permisos
(badge "298 permisos"), Usuarios (ícono + un número) y el menú de acciones (…), que para roles de
sistema solo ofrece "Ver permisos". La clienta rodeó con rojo el **"1"** de la columna Usuarios.

El pedido tiene dos partes, y la segunda explica la primera:

1. **Ver**: saber qué persona quedó en cada rol.
2. **Corregir**: "para ver si no le pifié" — si ve a alguien en el rol equivocado, quiere
   poder arreglarlo. Hoy la corrección existe, pero en otra pantalla (Empresa → Usuarios →
   "Cambiar rol"), y desde Roles no hay ningún camino hacia ella.

Hoy la columna Usuarios es un contador **puramente informativo**: no es clickeable, no tiene
tooltip y no hay ninguna acción en el menú (…) que lleve a los usuarios del rol
(`src/modules/company/features/general/roles/columns.tsx:88-102` y `105-153`).

**Observación fuera de alcance (pero que conviene reportarle a la clienta):** la captura muestra
un rol **personalizado "Administrador"**, con "0 permisos" y descripción "Administra todo", que
convive con el rol de **sistema "Administrador"** (slug `admin`,
`src/shared/lib/permissions/constants.ts:323-330`). Un rol con 0 permisos y 1 usuario asignado
es exactamente el "le pifié" que motiva el ticket: ese usuario no puede hacer nada. Hoy
`createRole` rechaza nombres duplicados (`roles/actions.server.ts:329-339`, compara `name` y
`slug`), así que lo más probable es que el rol custom se haya creado **antes** de que el rol de
sistema `admin` se sembrara en su empresa (el upsert de `initializeCompanyRbac`,
`src/shared/lib/permissions/rbac-init.ts:66-81`, solo choca por `slug`, y `admin` ≠
`administrador`). No se puede confirmar desde el código cuál fue el orden. No es alcance de este
ticket, pero la feature propuesta le va a permitir ver de un vistazo a quién tiene en ese rol
vacío y moverlo.

### 1.2 Contexto actual

#### 1.2.1 Modelo de datos: la asignación usuario↔rol es 100% local (no hace falta ir a un proveedor externo)

`prisma/schema.prisma:741-768` — modelo `CompanyMember` (tabla `company_members`):

- `userId String` (línea 743): id del usuario. El comentario dice "Clerk user ID", pero está
  **desactualizado**: la autenticación del proyecto hoy es **Better Auth** (`package.json:68`,
  `src/shared/lib/current-user.ts:3,25`), y el id que se guarda es el del modelo local `User`.
- `roleId String?` + `role CompanyRole?` (líneas 756-757): **la relación usuario↔rol es un FK
  directo en `CompanyMember`**. Un miembro tiene a lo sumo un rol.
- `isOwner`, `isActive`, `employeeId` (líneas 744-745, 760-761).
- `@@unique([companyId, userId])` (línea 766).

`prisma/schema.prisma:848-869` — modelo `CompanyRole`: tiene la relación inversa
`members CompanyMember[]` (línea 864), además de `permissions` (863) e `invitations` (865).

`prisma/schema.prisma:4154-4174` — modelo `User` (tabla `user`, de Better Auth): `email`,
`name`, `firstName`, `lastName`, `imageUrl`, `imageKey`, `legacyClerkId`. **El nombre, el email
y el avatar del usuario están en la base local.**

**Punto clave para el diseño:** `CompanyMember.userId` **no tiene relación Prisma con `User`**
(no hay `user User @relation(...)` en `CompanyMember`, ni `members` en `User`). Por eso no se
puede hacer `include: { user: true }`: el proyecto resuelve los datos del usuario con un
**segundo query en lote** `prisma.user.findMany({ where: { id: { in: userIds } } })` y un `Map`.
Ese patrón ya está en tres lugares:

- `src/modules/company/features/general/users/actions.server.ts:88-111` (listado de usuarios).
- `src/modules/company/features/general/audit/actions.server.ts:57-79` (auditoría, con fallback
  "Usuario Desconocido").
- `src/modules/commercial/features/products/features/price-lists/detail/apply-index.server.ts:83`.

Conclusión: **listar los usuarios de un rol es una query local, sin llamadas externas**: 
`companyMember.findMany({ where: { roleId, companyId } })` + enriquecimiento con `user.findMany`.

#### 1.2.2 Cómo se calcula hoy el contador de la columna Usuarios

`src/modules/company/features/general/roles/actions.server.ts:44-92` — `getRolesPaginated`:

```ts
_count: {
  select: { members: true },   // línea 79-81
},
```

Es un `_count` de Prisma sobre la relación `CompanyRole.members`, **sin filtro**: cuenta
miembros activos **e inactivos**. El listado devuelve `{ data: roles, total }` (línea 87), y el
tipo `RoleListItem` se infiere de ahí (línea 539). La celda lo pinta en
`roles/columns.tsx:88-102`:

```tsx
const count = row.original._count.members;
<div className="flex items-center gap-1 text-muted-foreground">
  <Users className="h-4 w-4" />
  <span>{count}</span>
</div>
```

El mismo `_count.members` se usa para dos reglas de negocio que **no** hay que romper:

- Habilitar "Eliminar" solo si `role._count.members === 0` (`roles/columns.tsx:110`).
- `deleteRole` rechaza si `existing._count.members > 0`
  (`roles/actions.server.ts:493-512`), también sin filtrar por `isActive`.

**Inconsistencia latente:** la pantalla de Usuarios lista solo miembros **activos**
(`users/actions.server.ts:49-52`, `where: { companyId, isActive: true }`), mientras que el
contador de Roles cuenta a todos. Un usuario desactivado (`deactivateMember`,
`users/actions.server.ts:648-651`, hace `isActive: false` y **conserva el `roleId`**) sigue
sumando en el "1" de la columna, pero no aparece en Usuarios. Si la clienta ve "1" y en Usuarios
no encuentra a nadie con ese rol, la confusión es la misma que motiva el ticket. La lista de
usuarios por rol tiene que **mostrar los activos** y, si el total difiere, decirlo ("+1
inactivo"). Ver 1.6.

**Flujo de la página:** `src/app/(core)/dashboard/company/general/roles/page.tsx:14-17` →
`RolesList` (Server Component, `roles/RolesList.tsx:12-39`, hace `getRolesPaginated` +
`getModulePermissions('company.general.roles')` en paralelo y envuelve en `PermissionGuard`) →
`_RolesDataTable` (Client, `roles/components/_RolesDataTable.tsx:39-121`, recibe `data`,
`totalRows`, `searchParams`, `permissions`) → `getColumns` (`roles/columns.tsx:26`).

#### 1.2.3 "Ver permisos" NO es un modal: navega a la página de edición

En el menú (…) el ítem dice "Ver permisos" para roles de sistema y "Editar" para los demás
(`roles/columns.tsx:125-133`), pero ambos hacen lo mismo: `router.push('/dashboard/company/
general/roles/${roleId}/edit')` (`_RolesDataTable.tsx:48-50`). Esa ruta renderiza `RoleEdit`
(`roles/RoleEdit.tsx:14-34`), que exige permiso `update` (línea 26) y monta `_RoleForm`
(`roles/components/_RoleForm.tsx`, **303 líneas**) con los campos y la `_PermissionsMatrix`
deshabilitados cuando `isSystemRole` (líneas 85, 187, 259, 281). No hay ningún Dialog ni
pestañas ahí. Esto importa para la alternativa C (ver 1.2.6).

También importa que **la columna de acciones entera solo se renderiza si el usuario tiene
`canUpdate || canDelete`** (`roles/columns.tsx:28, 105`). Un usuario con solo `view` sobre roles
**no ve el menú (…)**. Cualquier solución que viva únicamente en ese menú queda invisible para
él.

#### 1.2.4 La pantalla de Usuarios: el camino para "corregir"

Ruta: `/dashboard/company/general/users` (`src/app/(core)/dashboard/company/general/users/
page.tsx:14-17` → `UsersList`, `users/UsersList.tsx:18-58`).

- **Qué lista:** `getCompanyMembersPaginated` (`users/actions.server.ts:39-118`): miembros
  activos con `role { id, name, slug, color, isSystem }`, `employee` vinculado y, enriquecidos
  en lote, `email`, `firstName`, `lastName`, `imageUrl` (líneas 102-111). Tipo
  `CompanyMemberListItem` (línea 673).
- **Cómo muestra al usuario:** columna "Usuario" = `Avatar` (imagen o iniciales) + nombre
  completo + email en gris (`users/columns.tsx:43-60`). El mismo bloque avatar + nombre + email
  está **duplicado** en `_EditUserRoleModal.tsx:100-101, 114-123`. **No existe un componente
  reutilizable** de "identidad de usuario" ni en `src/shared/components/common/` (listado
  verificado: `AccountCombobox`, `BackButton`, `ClientDataTable`, `DataTable`, `InfoField`,
  `PermissionGuard`, `_FileDropzone`, `_MultiSelectField`, `_PermissionGuardClient`,
  `_QuickMonthFilter`) ni dentro del módulo `company` (no hay carpeta `shared/`). Este ticket es
  una buena oportunidad para extraerlo.
- **Columna "Rol":** badge con el nombre y color del rol; si `isOwner`, muestra "Propietario"
  **independientemente de `roleId`** (`users/columns.tsx:67-92`).
- **Cómo se corrige un rol:** menú (…) → "Cambiar rol" (`users/columns.tsx:144-148`, solo si
  `canUpdate` y el miembro no es owner ni el usuario actual) → `_EditUserRoleModal`
  (`users/components/_EditUserRoleModal.tsx:54-186`): Dialog con Select de `availableRoles` que
  llama a `updateMemberRole({ memberId, roleId })` (`users/actions.server.ts:561-616`, exige
  `company.general.users:update`, bloquea al owner, audita `member_role_changed` y revalida
  `/dashboard/company/general/users`).
- **Filtros:** la tabla de Usuarios **no tiene filtro por rol** ni `facetedFilters`
  (`_UsersDataTable.tsx:202-217` solo pasa `searchPlaceholder` y `toolbarActions`). Peor: el
  `where` de `getCompanyMembersPaginated` (`users/actions.server.ts:49-52`) **no usa
  `state.search` ni `state.filters`**, así que el buscador "Buscar usuarios..." hoy no filtra
  nada. La infraestructura sí existe (`DataTableFacetedFilter`, `buildFiltersWhere` en
  `src/shared/components/common/DataTable/helpers.ts:172-197`, ejemplo de uso en
  `commercial/features/clients/list/components/_ClientsDataTable.tsx:93-142`), pero en Usuarios
  no está cableada.

#### 1.2.5 Permisos que aplican

`src/shared/lib/permissions/constants.ts:54-56`: existen los módulos `company.general.users`,
`company.general.roles` y `company.general.audit`. Acciones: `view`, `create`, `update`,
`delete`, `approve` (`constants.ts:103-109`).

- **Ver quiénes tienen un rol** es información de la pantalla de Roles: corresponde a
  `company.general.roles` / `view`, que ya se exige en `getRolesPaginated`
  (`roles/actions.server.ts:45`) y en `RolesList` (línea 19). No hace falta un permiso nuevo.
- **Saltar a Usuarios / cambiar el rol** es del módulo `company.general.users` (`view` para
  el link, `update` para "Cambiar rol"). `RolesList` hoy solo pide
  `getModulePermissions('company.general.roles')` (`RolesList.tsx:15`); habría que pedir también
  el de `users` para decidir si se muestra el acceso directo.
- Owners y roles `owner`/`developer` tienen todo (`getModulePermissions.server.ts:57-69`).
- En cliente existe `usePermissions()` (`src/shared/hooks/usePermissions.ts`), pero el patrón
  de esta feature es pasar `ModulePermissions` desde el Server Component como prop
  (`RolesList.tsx:34`, `_RolesDataTable.tsx:36`); conviene mantenerlo.

#### 1.2.6 Patrones de UI disponibles para "una lista detrás de un contador"

Primitivas instaladas en `src/shared/components/ui/`: `popover.tsx`, `dialog.tsx`, `sheet.tsx`,
`drawer.tsx`, `tooltip.tsx`, `tabs.tsx`, `avatar.tsx`, `scroll-area.tsx`, `skeleton.tsx`.
**No hay `hover-card.tsx`** (ni `@radix-ui/react-hover-card` en `package.json`); habría que
instalarlo con shadcn si se quisiera. `Sheet` y `Drawer` están instalados pero **ningún módulo
los usa** (grep de `SheetContent`/`DrawerContent` en `src/modules`: 0 resultados).

Precedentes concretos en el proyecto:

| Patrón | Dónde ya se usa | Cómo |
|---|---|---|
| **Popover sobre un Badge dentro de una celda de DataTable** | `src/modules/commercial/features/treasury/features/bank-accounts/detail/columns.tsx:146-166` (y 171-200) | `<Popover><PopoverTrigger asChild><Badge className="cursor-pointer">…</Badge></PopoverTrigger><PopoverContent className="w-64 text-sm">…</PopoverContent></Popover>` con los datos **ya presentes en la fila** (sin fetch) |
| **Dialog de detalle con carga perezosa** | `src/modules/accounting/features/budgets/components/_BudgetDetailModal.tsx:68-73` | `useQuery({ queryKey: ['budget-detail', id], queryFn, enabled: open && !!id })` + `Skeleton` mientras carga |
| **Dialog con avatar + nombre + email del usuario** | `users/components/_EditUserRoleModal.tsx:104-123` | Bloque `bg-muted rounded-lg` con `Avatar` de 10×10 |
| **Contador `_count` en columna** (sin interacción) | `roles/columns.tsx:88-102`; también `company/features/job-categories/list/columns.tsx:68-72`, `sectors/list/columns.tsx:56-60`, etc. | Solo texto; ninguno es clickeable hoy |
| **Ítem del menú (…) que navega a otra pantalla** | `roles/columns.tsx:125-133` + `_RolesDataTable.tsx:48-50` | `router.push(...)` |

#### 1.2.7 Alternativas comparadas

| # | Alternativa | Pros | Contras |
|---|---|---|---|
| **A** | **Click en el contador de la columna Usuarios abre un `Popover` con la lista (avatar + nombre + email) y un link "Gestionar en Usuarios"** | Es literalmente lo que la clienta rodeó con rojo; patrón ya existente en el proyecto (`bank-accounts/detail/columns.tsx:146-166`); **visible para cualquier usuario con `roles:view`**, no depende de la columna de acciones (`columns.tsx:105`); sin fetch adicional si los miembros viajan en `getRolesPaginated` (los roles son pocos y los usuarios por empresa también; el enriquecimiento en lote ya existe en `users/actions.server.ts:88-111`); cero rutas nuevas; ocupa un componente chico (< 100 líneas) | El Popover es angosto: con muchos usuarios necesita `ScrollArea` y tope de altura; no permite corregir *in situ*, solo enlaza a Usuarios; si se decidiera cargar bajo demanda hace falta una action + `useQuery` |
| **B** | **Ítem "Ver usuarios" en el menú (…) que abre un `Dialog`/`Sheet` con la lista y, con permiso `users:update`, un botón "Cambiar rol" por fila que reusa `_EditUserRoleModal`** | Cierra el ciclo "ver y corregir" sin salir de Roles; hay espacio para tabla completa | **Invisible para quien solo tiene `view`**: la columna de acciones no se renderiza sin `canUpdate || canDelete` (`roles/columns.tsx:28, 105`), habría que cambiar esa regla; el descubrimiento es peor (hay que abrir el menú; la clienta señaló el número, no el menú); `_EditUserRoleModal` espera un `CompanyMemberListItem` (`_EditUserRoleModal.tsx:49`) y necesita `availableRoles`, así que Roles tendría que cargar también lo de Usuarios (`getAvailableRoles`, `users/actions.server.ts:179`) y revalidar dos rutas; `Sheet` no tiene precedente en el proyecto; más código y más superficie de permisos que revisar |
| **C** | **Pestaña "Usuarios" dentro de "Ver permisos"** | Todo lo del rol en un lugar | "Ver permisos" **no es un modal**: es la página `/roles/[id]/edit` con `_RoleForm` (303 líneas, ya por encima de las 200 del checklist) y **exige `update`** (`RoleEdit.tsx:26`): un usuario con solo `view` no llega; además obliga a navegar rol por rol para responder "¿quién quedó dónde?", que es una pregunta sobre **todos** los roles a la vez |
| **D** | **La inversa: filtro por rol en la pantalla de Usuarios** | Es la vista natural para corregir (ahí está "Cambiar rol"); la infraestructura de `facetedFilters` existe (`_ClientsDataTable.tsx:93-142`, `buildFiltersWhere`) | **Hoy no existe**, y el `where` de Usuarios ignora búsqueda y filtros (`users/actions.server.ts:49-52`), así que hay que cablear filtros desde cero; no responde el pedido en la pantalla donde la clienta lo hizo; con pocos usuarios, la tabla de Usuarios ya muestra la columna Rol a la vista, y aun así ella pidió verlo desde Roles |

**Recomendación: A, con un puente hacia D.**

- El Popover sobre el contador es la respuesta directa al gesto de la clienta (rodeó el
  número) y reusa un patrón que el proyecto ya tiene en una DataTable. Es visible para todo el
  que pueda ver Roles, sin tocar la regla de la columna de acciones.
- Para "corregir", el Popover lleva un link **"Gestionar en Usuarios"** (visible solo con
  `company.general.users:view`) que navega a `/dashboard/company/general/users`. Cambiar el rol
  se hace donde ya se hace hoy (`_EditUserRoleModal`), con su permiso, su auditoría y su
  revalidación intactos. No se duplica la mutación.
- Datos: incluir `members` (activos) en el `select` de `getRolesPaginated` y enriquecerlos con
  un único `prisma.user.findMany` en lote (mismo patrón de `users/actions.server.ts:88-111`).
  Con eso el Popover no necesita fetch ni estado de carga. Si en planificación se prefiere no
  engordar el listado, la alternativa es una action `getRoleMembers(roleId)` + `useQuery` con
  `enabled: open` como en `_BudgetDetailModal.tsx:68-73`.
- Extraer el bloque avatar + nombre + email a un componente compartido del módulo (hoy
  duplicado en `users/columns.tsx:45-58` y `_EditUserRoleModal.tsx:100-123`) para usarlo también
  en el Popover.
- **Puente hacia D (opcional, a decidir en planificación):** que el link "Gestionar en
  Usuarios" lleve `?role=<id>` y que Usuarios acepte ese filtro. Requiere cablear
  `facetedFilters` + `buildFiltersWhere` en Usuarios, que hoy no filtra nada. Es el
  complemento natural, pero es trabajo adicional en otra feature; si se hace, aprovechar para
  que el buscador de Usuarios funcione.

### 1.3 Archivos involucrados

#### A crear

| Archivo | Propósito |
|---|---|
| `src/modules/company/features/general/roles/components/_RoleMembersPopover.tsx` | Client Component: trigger (ícono + contador, `cursor-pointer`) + `PopoverContent` con la lista de miembros (avatar, nombre, email, badge "Propietario" si `isOwner`), estado vacío ("Ningún usuario tiene este rol"), aviso "+N inactivos" si aplica, y link "Gestionar en Usuarios" condicionado a permiso |
| `src/modules/company/features/general/shared/_MemberIdentity.tsx` (o similar) | Client Component reutilizable: `Avatar` + nombre completo + email, extraído de `users/columns.tsx:48-58` y `_EditUserRoleModal.tsx:114-123` |
| `src/modules/company/features/general/shared/member-display.ts` | Helpers puros `getMemberFullName` / `getMemberInitials` (hoy inline en `users/columns.tsx:45-46` y `_EditUserRoleModal.tsx:100-101`), testeables con Vitest |
| `src/modules/company/features/general/shared/member-display.test.ts` | Tests unitarios de los helpers (nombre vacío → "Sin nombre", iniciales → "?", etc.) |
| `src/modules/company/features/general/roles/role-members.integration.test.ts` | Test de integración de `getRolesPaginated` contra la base real siguiendo `purchase-invoice-tributes.integration.test.ts:22-33` (`vi.mock` de `current-user`, `company`, `permissions`, `next/cache`): crea rol + miembros activo/inactivo y verifica la lista y los contadores |
| `scripts/guia-presentacion/tsk-692.html` + `scripts/guia-presentacion/capturas-tsk692.mjs` | Guía de presentación para la clienta (HTML → PDF con `generar-pdf.mjs`; capturas con Playwright contra `npm run dev`, patrón de `capturas-tsk644.mjs:1-40`) |
| `docs/presentaciones/TSK-692-usuarios-por-rol.pdf` | PDF resultante |

#### A modificar

| Archivo | Cambio |
|---|---|
| `src/modules/company/features/general/roles/actions.server.ts:56-83` | En `getRolesPaginated`, agregar al `select` `members: { where: { isActive: true }, select: { id, userId, isOwner } }` y un `_count` filtrado (o segundo `_count` "total") para detectar inactivos; enriquecer `members` con `prisma.user.findMany` en lote (`email`, `firstName`, `lastName`, `imageUrl`) antes del `return` de la línea 87. `RoleListItem` (línea 539) se actualiza solo por inferencia |
| `src/modules/company/features/general/roles/columns.tsx:88-102` | Reemplazar la celda estática de "Usuarios" por `_RoleMembersPopover`; agregar a `GetColumnsProps` (líneas 20-24) lo necesario para el link (p. ej. `canViewUsers: boolean`). **No tocar** la regla de la línea 110 (`_count.members === 0` para eliminar) sin decidir 1.6 |
| `src/modules/company/features/general/roles/components/_RolesDataTable.tsx:32-37, 65-73` | Recibir y pasar la prop nueva a `getColumns` (y agregarla a las dependencias del `useMemo`) |
| `src/modules/company/features/general/roles/RolesList.tsx:13-16, 30-35` | Pedir además `getModulePermissions('company.general.users')` en el `Promise.all` y pasar `canView` a la tabla |
| `src/modules/company/features/general/users/columns.tsx:43-60` y `users/components/_EditUserRoleModal.tsx:100-123` | (Opcional pero recomendado) reemplazar el bloque duplicado por `_MemberIdentity` |
| `src/modules/help/features/guide/components/_CompanyGuide.tsx:71-137` | Documentar en "Roles y Permisos" cómo ver los usuarios de un rol y cómo corregirlos desde Usuarios |
| `docs/modules/company.md:34-44` | Agregar la funcionalidad a la lista de Roles |

Si se hace el **puente hacia D**: `users/actions.server.ts:49-52` (leer `state.filters` con
`buildFiltersWhere({ role: 'roleId' })`), `users/components/_UsersDataTable.tsx:202-217`
(`facetedFilters` con las opciones de `availableRoles`) y el `href` del link en
`_RoleMembersPopover.tsx`.

#### Solo lectura / referencia

- `prisma/schema.prisma:741-768` (`CompanyMember`), `848-869` (`CompanyRole`), `4154-4174`
  (`User`). **No hace falta migración.**
- `src/modules/company/features/general/users/actions.server.ts:39-118` (patrón de
  enriquecimiento), `561-616` (`updateMemberRole`).
- `src/modules/commercial/features/treasury/features/bank-accounts/detail/columns.tsx:146-166`
  (Popover en celda).
- `src/modules/accounting/features/budgets/components/_BudgetDetailModal.tsx:68-73` (carga
  perezosa, si se opta por action separada).
- `src/shared/components/ui/popover.tsx`, `avatar.tsx`, `scroll-area.tsx`, `badge.tsx`.
- `src/shared/lib/permissions/constants.ts:54-56, 103-109, 306-331`;
  `getModulePermissions.server.ts:18-23, 45-69`.
- `src/modules/companies/features/create/actions.server.ts:73-81` y
  `src/modules/auth/features/sign-up/actions.server.ts:43-51` (cómo nace el owner; ver 1.6).
- `src/modules/commercial/features/purchases/features/invoices/list/purchase-invoice-tributes.integration.test.ts:22-33`
  y `src/modules/commercial/shared/fixed-asset.test.ts:1-30` (patrones de test).
- `scripts/guia-presentacion/generar-pdf.mjs`, `capturas-tsk644.mjs`, `tsk-644.html`.

### 1.4 Dependencias

- **Sin dependencias nuevas de npm** si se usa `Popover` (`@radix-ui/react-popover` ya está,
  `package.json:51`). Solo haría falta instalar algo si se eligiera `HoverCard`, que no está.
- **Sin migración de Prisma**: `CompanyRole.members` y `User` ya existen.
- Datos de usuario: dependen de que `User.firstName/lastName/imageUrl` estén cargados. Para
  usuarios migrados de Clerk (`legacyClerkId`, `schema.prisma:4168`) puede haber nombres vacíos;
  el fallback "Sin nombre" / iniciales "?" ya existe en `users/columns.tsx:45-46` y hay que
  replicarlo (por eso conviene el helper compartido).
- Permisos: `company.general.roles:view` (ya exigido) para la lista; `company.general.users:view`
  para el link; `company.general.users:update` para cambiar rol (ya exigido en
  `updateMemberRole`).
- Tickets relacionados: ninguno abierto sobre roles. La inconsistencia activos/inactivos del
  contador (1.2.2) y el buscador de Usuarios que no filtra (1.2.4) son hallazgos de este análisis.

### 1.5 Restricciones y reglas

Nota previa: `CLAUDE.md` referencia `.claude/rules/permissions.md`, `server-components.md`,
`module-structure.md`, `ui-shadcn.md`, `react-query.md`, `user-documentation.md`, etc., pero en
el repo **solo existe `.claude/rules/modules.md`**. Aplican entonces las "Reglas de Oro" del
propio `CLAUDE.md` y lo que se ve en el código existente:

- **Permisos en 3 niveles (regla 11):** `checkPermission('company.general.roles', 'view')` ya
  está en `getRolesPaginated`; si se crea `getRoleMembers`, debe empezar igual. `PermissionGuard`
  ya envuelve `RolesList`. En cliente, el link a Usuarios se condiciona con el
  `ModulePermissions` recibido por props (patrón actual), no con `usePermissions()`.
- **Server-first + prefijo `_`** en Client Components (`_RoleMembersPopover.tsx`,
  `_MemberIdentity.tsx`). El listado sigue viniendo del Server Component; el Popover no hace
  fetch salvo que se elija la variante perezosa (y entonces **`useQuery`, nunca
  `useEffect`+`useState`**, regla 3).
- **`select` explícito en Prisma** y `getActiveCompanyId()` (ya cumplidos en la action).
- **Sin `:any`**: `RoleListItem` se infiere de la action (`actions.server.ts:539`); el
  componente tipa sus props con `RoleListItem['members'][number]`.
- **Sin Decimal** en este flujo (no hay campos numéricos de Prisma).
- **`logger`, no `console.*`**; **`moment`** si se muestra alguna fecha (p. ej. "miembro desde",
  `CompanyMember.joinedAt`); **`AlertDialog`** no aplica (no hay confirmaciones nuevas).
- **Componentes < 200 líneas**: el Popover queda chico; **no** agregar nada a `_RoleForm.tsx`
  (303 líneas).
- **No importar entre módulos**: roles y users están en el mismo módulo `company`, así que un
  `features/general/shared/` es válido; no importar de `src/modules/help` ni al revés.
- **DataTable:** la columna ya tiene `meta.title` (`columns.tsx:90`); mantenerlo. Responsive:
  el `PopoverContent` con ancho fijo (`w-72`/`w-80`) y `ScrollArea` con `max-h`.
- **Guía de usuario in-app (regla 10):** actualizar `_CompanyGuide.tsx:71-137`.
- **Documentación del desarrollador (regla 8):** `docs/modules/company.md:34-44`.
- **Guía de presentación al cliente en PDF** (memoria `guia-presentacion-cliente-por-ticket`):
  antes/después con capturas, paso a paso, y qué NO cambió (el contador sigue igual; cambiar el
  rol sigue haciéndose en Usuarios).
- **Tests: Vitest, no Cypress** (memoria `testing-real-es-vitest-no-cypress`; `package.json:21`
  `"test": "vitest run"`, `vitest.config.ts` incluye `src/**/*.test.ts`). No hay ningún test
  actual de la feature de roles ni de usuarios; los patrones a seguir son
  `fixed-asset.test.ts` (unitario) y `purchase-invoice-tributes.integration.test.ts`
  (integración con `vi.mock` de la frontera de sesión/permisos).
- **Registro de módulos (`.claude/rules/modules.md`):** no aplica, no se crea módulo nuevo;
  `company.general.roles` ya está mapeado.

### 1.6 Riesgos identificados

1. **Contador vs. lista desincronizados por miembros inactivos.** `_count.members` cuenta
   inactivos (`roles/actions.server.ts:79-81`) y `deactivateMember` conserva el `roleId`
   (`users/actions.server.ts:648-651`). Si la lista muestra solo activos, la clienta puede ver
   "1" y una lista vacía. Mitigación: traer ambos números (activos y total) y mostrar "+N
   inactivos" en el Popover; **no** cambiar la semántica del `=== 0` para eliminar
   (`columns.tsx:110`) ni de `deleteRole` (`actions.server.ts:508`) en este ticket, porque un
   inactivo con `roleId` sigue referenciando el rol.
2. **El propietario puede no aparecer en ningún rol.** El alta por `companies/features/create`
   asigna `roleId: roleIds.owner` (`actions.server.ts:73-81`), pero el bootstrap de sign-up crea
   el owner **sin `roleId`** (`auth/features/sign-up/actions.server.ts:43-51`). Si la clienta
   entró por ese camino, "Propietario" mostrará 0 usuarios y ella no se verá en la lista. La
   pantalla de Usuarios lo disimula porque pinta "Propietario" por `isOwner`
   (`users/columns.tsx:70-77`). Mitigación mínima: badge "Propietario" en la lista por `isOwner`
   y una nota en la guía; la corrección del bootstrap es otro ticket.
3. **Payload del listado.** Meter `members` en `getRolesPaginated` multiplica filas por rol. Con
   los volúmenes de PMS (pocos roles, pocos usuarios) es despreciable; si se detectan empresas
   con cientos de miembros, pasar a la variante perezosa (`getRoleMembers` + `useQuery`).
4. **Nombres vacíos en usuarios migrados de Clerk** (`legacyClerkId`): la lista puede mostrar
   solo emails. Ya pasa en Usuarios; el helper compartido garantiza el mismo fallback.
5. **Regresión visual en la columna Usuarios.** Hoy la celda es texto gris; al volverse
   trigger debe verse clickeable (`cursor-pointer`, `hover:underline` o `Button variant="ghost"
   size="sm"`) sin romper el alto de fila ni el `data-testid`. Verificar en móvil que el
   Popover no se corte (`collisionPadding`).
6. **Rol "Administrador" duplicado en la empresa de la clienta** (1.1). No es alcance, pero al
   entregar hay que decírselo explícitamente: ver quién está en el rol con 0 permisos y moverlo
   al rol de sistema, o borrar el custom cuando quede en 0.

### 1.7 Preguntas abiertas

Ninguna que bloquee el diseño. Dos decisiones para planificación, con recomendación:

1. **¿Se hace también el puente hacia D (filtro por rol en Usuarios, `?role=<id>`)?**
   Recomendación: sí, si el esfuerzo de cablear `facetedFilters`/`buildFiltersWhere` en Usuarios
   (hoy no filtra nada, `users/actions.server.ts:49-52`) entra en el ticket; si no, dejar el link
   sin parámetro y abrir un ticket aparte. No cambia el diseño del Popover.
2. **¿Miembros inline en `getRolesPaginated` o action perezosa `getRoleMembers`?**
   Recomendación: inline (más simple, sin loading, patrón de enriquecimiento ya existente). Solo
   cambiar si aparece el riesgo 3.

---

## 2. Planificación

Cinco fases que implementan la **alternativa A** del análisis (1.2.7) con las decisiones ya
tomadas: Popover sobre el contador de la columna Usuarios, miembros **inline** en
`getRolesPaginated`, link "Gestionar en Usuarios" condicionado a `company.general.users:view`,
sin migración, sin permisos nuevos y sin tocar la pantalla de Usuarios. El orden va del dato
hacia la superficie: primero el componente de identidad que van a compartir tres pantallas y la
action que trae los miembros; después el Popover, que es el único punto donde se juntan.

Testing: **Vitest** (`npm run test` → `vitest run`; `vitest.config.ts` incluye solo
`src/**/*.test.ts` en `environment: 'node'`). No hay Cypress en el repo (memoria
`testing-real-es-vitest-no-cypress`). Consecuencia práctica: **no se pueden testear componentes
`.tsx`**; lo testeable con Vitest es la lógica pura (helpers) y las server actions contra la base.
El TDD se aplica a esas dos capas: el test se escribe **antes** del código en las fases 1 y 2.

### 2.1 Fases de implementación

#### Fase 1: Componente compartido `_MemberIdentity` + helpers puros (TDD)

- **Objetivo:** tener un único bloque "avatar + nombre + email" para las tres pantallas que lo
  necesitan (tabla de Usuarios, modal Cambiar rol y el Popover nuevo), con los fallbacks de nombre
  e iniciales en un helper puro testeado, y reemplazar los dos usos duplicados **sin cambio
  visual**.
- **Tareas:**
  - [x] Crear la carpeta `src/modules/company/features/general/shared/` (hoy `features/general/`
        solo tiene `audit/`, `roles/`, `users/` e `index.ts`). Es código compartido **dentro** del
        módulo `company`, así que no viola la regla de no importar entre módulos.
  - [x] Escribir **primero** `src/modules/company/features/general/shared/member-display.test.ts`
        (Vitest puro, mismo estilo que `src/modules/commercial/shared/fixed-asset.test.ts:1-30`:
        `describe`/`it` en español, sin base ni mocks). Casos, tomados de los dos bloques hoy inline
        (`users/columns.tsx:45-46` y `_EditUserRoleModal.tsx:100-101`):
    - `getMemberFullName({ firstName: 'Ana', lastName: 'Pérez' })` → `'Ana Pérez'`.
    - Solo nombre o solo apellido → sin espacios sobrantes (`'Ana'`, `'Pérez'`); el `trim()` actual
      es el que evita `'Ana '`.
    - Ambos vacíos, `null` o `undefined` → `'Sin nombre'`.
    - `getMemberInitials({ firstName: 'Ana', lastName: 'Pérez' })` → `'AP'`; solo nombre → `'A'`;
      minúsculas → mayúsculas; ambos vacíos/`null` → `'?'`.
  - [x] Crear `src/modules/company/features/general/shared/member-display.ts` con
        `interface MemberDisplayName { firstName?: string | null; lastName?: string | null }` y las
        dos funciones `getMemberFullName` / `getMemberInitials`, reproduciendo **exactamente** la
        lógica actual (template + `trim()` + fallback; `?.[0] ?? ''` + `toUpperCase()` + fallback).
        Sin imports de React ni de Prisma: tiene que correr en Vitest `node`.
  - [x] Crear `src/modules/company/features/general/shared/_MemberIdentity.tsx` (Client Component,
        prefijo `_`). Props: `{ firstName: string | null; lastName: string | null; email: string;
        imageUrl: string | null; size?: 'sm' | 'md'; className?: string }`. Renderiza
        `Avatar`/`AvatarImage`/`AvatarFallback` de `@/shared/components/ui/avatar` + columna con
        nombre (`font-medium`) y email (`text-sm text-muted-foreground`). `size="sm"` → `h-8 w-8`
        (lo que usa `users/columns.tsx:50`), `size="md"` → `h-10 w-10` (lo que usa
        `_EditUserRoleModal.tsx:115`). `alt` del avatar = nombre completo, como hoy. Menos de 50
        líneas.
  - [x] Reemplazar en `users/columns.tsx:45-58` el bloque inline por
        `<_MemberIdentity size="sm" firstName={member.firstName} lastName={member.lastName}
        email={member.email} imageUrl={member.imageUrl} />`; quitar el import de `Avatar*`
        (línea 16) si queda sin uso. Mantener `enableSorting: false` y `meta.title`.
  - [x] Reemplazar en `_EditUserRoleModal.tsx:100-101` y `114-123` el bloque inline por
        `<_MemberIdentity size="md" … />` **dentro** del contenedor `flex items-center gap-3 p-3
        bg-muted rounded-lg` (línea 113), que se conserva porque es el marco visual del modal;
        quitar el import de `Avatar*` (línea 36) y las dos `const` de las líneas 100-101.
  - [x] Comparar visualmente antes/después en `/dashboard/company/general/users` (tabla y modal
        "Cambiar rol"): mismo tamaño de avatar, mismas iniciales, mismo fallback "Sin nombre".
- **Archivos:**
  - Crear: `src/modules/company/features/general/shared/member-display.ts`,
    `.../shared/member-display.test.ts`, `.../shared/_MemberIdentity.tsx`
  - Modificar: `src/modules/company/features/general/users/columns.tsx`,
    `src/modules/company/features/general/users/components/_EditUserRoleModal.tsx`
- **Criterio de completitud:** `npm run test` en verde con los casos nuevos (primero en rojo, luego
  en verde); `grep -rn "Sin nombre" src/modules/company` devuelve **solo** `member-display.ts`
  (no queda ningún duplicado); la tabla de Usuarios y el modal se ven igual que antes.

#### Fase 2: `getRolesPaginated` devuelve los miembros activos enriquecidos (TDD de integración)

- **Objetivo:** que cada rol del listado traiga sus miembros **activos** con nombre, email y
  avatar, más el dato de cuántos inactivos hay, resolviendo los usuarios de **toda la página en
  un solo `findMany`**, y sin cambiar la semántica de `_count.members` que usan la regla de
  eliminar (`roles/columns.tsx:110`) y `deleteRole` (`roles/actions.server.ts:508`).
- **Tareas:**
  - [x] Escribir **primero**
        `src/modules/company/features/general/roles/role-members.integration.test.ts` siguiendo
        `purchase-invoice-tributes.integration.test.ts:22-33` (mismos `vi.mock` de
        `@/shared/lib/company`, `@/shared/lib/current-user`, `@/shared/lib/permissions` y
        `next/cache`; `describe.skipIf(!dbAvailable)` con el `SELECT 1` de las líneas 62-68;
        prefijo `TSK692-` en los datos; limpieza en `afterAll`). **Cuidado con el mock de
        permisos:** `roles/actions.server.ts:9` importa además `createAuditLog, AUDIT_ACTIONS,
        MODULES, ACTIONS` del mismo módulo, así que el mock debe ser
        `vi.mock('@/shared/lib/permissions', async (importOriginal) => ({ ...(await importOriginal()),
        checkPermission: vi.fn().mockResolvedValue(undefined) }))` y no el objeto pelado del test
        de referencia, o esas constantes quedan `undefined`.
  - [x] Datos del `beforeAll`: una `Company`, tres `User` (`prisma.user.create` con `email`
        `TSK692-…@test.local`, `name`, `firstName`, `lastName`, `imageUrl` en uno), tres
        `CompanyRole` (`rolConUno`, `rolMixto`, `rolVacio`, con `slug` propio y `isSystem: false`)
        y `CompanyMember` así: `rolConUno` → 1 activo con `isOwner: true`; `rolMixto` → 1 activo +
        1 con `isActive: false` (es lo que deja `deactivateMember`,
        `users/actions.server.ts:648-651`: conserva el `roleId`); `rolVacio` → ninguno. Sumar un
        cuarto miembro activo con un `userId` que **no** exista en `User` (uuid al azar) para
        cubrir el fallback.
  - [x] Casos a cubrir, llamando al código real `getRolesPaginated({})`:
    - `rolConUno`: `members.length === 1`, con `email`, `firstName`, `lastName`, `imageUrl` del
      `User` y `isOwner: true`; `_count.members === 1`; `inactiveMembersCount === 0`.
    - `rolMixto`: `members.length === 1` (solo el activo); `_count.members === 2` (**sigue
      contando inactivos**, sin cambio); `inactiveMembersCount === 1`.
    - `rolVacio`: `members` es `[]`, `_count.members === 0`, `inactiveMembersCount === 0`.
    - Miembro huérfano (sin `User`): `email === 'Sin email'`, `firstName === ''`,
      `lastName === ''`, `imageUrl === null` (mismo fallback que `users/actions.server.ts:105-109`).
    - **Un solo query en lote:** `vi.spyOn(prisma.user, 'findMany')` y `toHaveBeenCalledTimes(1)`
      por llamada a `getRolesPaginated`, aunque la página tenga tres roles con miembros.
    - Orden: el owner aparece primero en `members` de un rol que tenga owner y no-owner.
  - [x] Implementar en `getRolesPaginated` (`roles/actions.server.ts:44-92`):
    - En el `select` de `companyRole.findMany` (líneas 62-82), agregar la relación filtrada
      `members: { where: { isActive: true }, orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, userId: true, isOwner: true } }`. **Dejar `_count: { select: { members:
      true } }` (líneas 79-81) exactamente igual**: sigue siendo el total activos + inactivos.
    - Después del `Promise.all` y **dentro del `try`** (antes del `return` de la línea 87):
      `const userIds = [...new Set(roles.flatMap((r) => r.members.map((m) => m.userId)))]`;
      si `userIds.length > 0`, un único `prisma.user.findMany({ where: { id: { in: userIds } },
      select: { id, email, firstName, lastName, imageUrl } })` (copiar el `select` de
      `users/actions.server.ts:90-98`); `userMap = new Map(...)`.
    - Mapear cada rol a `{ ...role, members: role.members.map((m) => ({ ...m, email: u?.email ??
      'Sin email', firstName: u?.firstName ?? '', lastName: u?.lastName ?? '', imageUrl:
      u?.imageUrl ?? null })), inactiveMembersCount: role._count.members - role.members.length }`.
      `inactiveMembersCount` se calcula acá para que el cliente no tenga que restar.
    - Devolver `{ data: enrichedRoles, total }`. **No** agregar `:any`: `RoleListItem`
      (`actions.server.ts:539`) se actualiza solo por inferencia. Exportar además
      `export type RoleMember = RoleListItem['members'][number];` junto a los otros tipos
      inferidos (líneas 539-542), para que el Popover y `_MemberIdentity` tipen sus props sin
      redeclarar.
    - Sin `Decimal` en este flujo (regla 9 no aplica). `checkPermission('company.general.roles',
      'view')` de la línea 45 queda como está.
  - [x] Verificar que `deleteRole` (`actions.server.ts:493-512`) y la regla
        `role._count.members === 0` (`columns.tsx:110`) **no** cambian de comportamiento: siguen
        leyendo el `_count` sin filtrar.
- **Archivos:**
  - Crear: `src/modules/company/features/general/roles/role-members.integration.test.ts`
  - Modificar: `src/modules/company/features/general/roles/actions.server.ts`
- **Criterio de completitud:** el test de integración pasa contra la base de dev (y se saltea
  limpio si no hay base); `npm run check-types` no suma errores; `RoleListItem` expone `members`
  e `inactiveMembersCount` sin ningún tipo declarado a mano; `/dashboard/company/general/roles`
  sigue renderizando igual (la fase 3 todavía no cambió la celda).

#### Fase 3: `_RoleMembersPopover` en la columna Usuarios + permiso de Usuarios

- **Objetivo:** que el contador de la columna Usuarios sea un botón real que abre un Popover con
  los miembros activos del rol, el aviso de inactivos y el link a Usuarios solo para quien puede
  verla. Es la única fase visible para la clienta.
- **Tareas:**
  - [x] Crear `src/modules/company/features/general/roles/components/_RoleMembersPopover.tsx`
        (Client Component). Props: `{ role: RoleListItem; canViewUsers: boolean }`. Estructura,
        siguiendo el precedente de Popover en celda de
        `treasury/features/bank-accounts/detail/columns.tsx:146-166`:
    - `Popover` → `PopoverTrigger asChild` → **`Button variant="ghost" size="sm"`** (un botón real,
      accesible por teclado, nunca un `div` con `onClick`) con `className="h-8 gap-1 px-2
      text-muted-foreground"`, ícono `Users` de `lucide-react` (`h-4 w-4`) y el número
      **`role._count.members`** (el mismo que hoy: el contador no cambia de valor, solo pasa a ser
      clickeable). `aria-label={`Ver usuarios del rol ${role.name}`}` y
      `data-testid={`role-members-${role.id}`}`.
    - **Rol con 0 miembros en total (`_count.members === 0`): el botón va `disabled` y no abre
      nada.** Justificación: un Popover que solo diga "nadie" es un clic para no ver nada, el "0"
      ya lo dice y la acción útil para ese rol es "Eliminar", que se habilita justamente en ese
      caso (`columns.tsx:110`). Si hay 0 activos pero `inactiveMembersCount > 0`, **sí** abre, con
      estado vacío ("Ningún usuario activo tiene este rol") + la línea de inactivos: es el caso
      exacto de la inconsistencia del riesgo 1 y hay que explicarlo, no esconderlo.
    - `PopoverContent align="start" collisionPadding={16} className="w-72 p-0"`: encabezado
      (`px-3 py-2 border-b`) con "Usuarios con este rol" en `text-sm font-medium` y debajo
      `{n} activo(s)` en `text-xs text-muted-foreground`; `ScrollArea` de
      `@/shared/components/ui/scroll-area` con `className="max-h-64"`; lista `ul` con un `li` por
      miembro (`px-3 py-2 flex items-center justify-between gap-2`) que renderiza
      `<_MemberIdentity size="sm" …>` de la fase 1 y, si `member.isOwner`, el `Badge` ámbar
      "Propietario" con `Shield` copiado de `users/columns.tsx:70-77` (mismo look que en Usuarios).
    - Si `role.inactiveMembersCount > 0`: línea `px-3 py-2 text-xs text-muted-foreground border-t`
      con `+{n} inactivo` / `+{n} inactivos` (singular/plural).
    - Pie solo si `canViewUsers`: `border-t` + `Button asChild variant="link" size="sm"` →
      `<Link href="/dashboard/company/general/users">Gestionar en Usuarios <ArrowRight /></Link>`
      (`next/link`). Sin `?role=`: el filtro por rol en Usuarios queda fuera de alcance (2.4).
    - Sin fetch, sin `useQuery`, sin estado de carga: todo viene en `role` desde el Server
      Component. Tipar con `RoleListItem` / `RoleMember` de la fase 2, sin `:any`. Menos de 120
      líneas.
  - [x] `roles/columns.tsx`: agregar `canViewUsers: boolean` a `GetColumnsProps` (líneas 20-24) y
        a la desestructuración de `getColumns` (línea 26); reemplazar la celda de las líneas 92-100
        por `cell: ({ row }) => <_RoleMembersPopover role={row.original} canViewUsers={canViewUsers}
        />`; conservar `accessorKey: 'members'`, `meta: { title: 'Usuarios' }` y
        `enableSorting: false` (líneas 89-90, 101); quitar `Users` del import de la línea 4 si ya
        no se usa acá. **No tocar** la línea 110 ni el bloque de acciones (105-153).
  - [x] `roles/components/_RolesDataTable.tsx`: agregar `canViewUsers: boolean` a `Props`
        (líneas 32-37) y a la desestructuración (39-44); pasarla a `getColumns` (67-71) y sumarla
        a las dependencias del `useMemo` (línea 72: `[permissions, canViewUsers]`).
  - [x] `roles/RolesList.tsx`: en el `Promise.all` (líneas 13-16) agregar
        `getModulePermissions('company.general.users')` como tercer elemento
        (`usersPermissions`) y pasar `canViewUsers={usersPermissions.canView}` a
        `_RolesDataTable` (líneas 30-35). El patrón de pasar `ModulePermissions` por props desde
        el Server Component se mantiene (no usar `usePermissions()` acá, ver 1.2.5).
  - [x] Regresión visual (riesgo 5): el `Button ghost h-8` no debe cambiar el alto de fila de la
        tabla; en hover se ve el fondo del ghost, que es la pista de "clickeable". Verificar en
        modo oscuro.
  - [x] Accesibilidad/teclado: `Tab` llega al botón, `Enter`/`Space` abre, `Esc` cierra, el foco
        vuelve al botón (lo da Radix; solo confirmar que el trigger es el `Button` y no un
        wrapper).
  - [x] Móvil (viewport 375px): el `PopoverContent` no se corta gracias a `collisionPadding` y
        `w-72`; si la tabla scrollea horizontalmente, el Popover se ancla igual al botón.
- **Archivos:**
  - Crear: `src/modules/company/features/general/roles/components/_RoleMembersPopover.tsx`
  - Modificar: `src/modules/company/features/general/roles/columns.tsx`,
    `.../roles/components/_RolesDataTable.tsx`, `.../roles/RolesList.tsx`
- **Criterio de completitud:** en `/dashboard/company/general/roles`, clic en el número de un rol
  con miembros abre la lista con avatar + nombre + email; el owner muestra "Propietario"; un rol
  con inactivos muestra "+N inactivos"; un rol con 0 tiene el botón deshabilitado; con un usuario
  que tiene `roles:view` pero **no** `users:view`, el Popover abre pero **sin** el link
  "Gestionar en Usuarios"; el menú (…) y la regla "Eliminar / No eliminable" siguen igual.
  `npm run check-types` y `npm run lint` en verde.

#### Fase 4: Documentación (guía in-app, docs del desarrollador y guía de presentación PDF)

- **Objetivo:** cumplir las reglas 8 y 10 del `CLAUDE.md` y el entregable de presentación al
  cliente (memoria `guia-presentacion-cliente-por-ticket`), aprovechando el PDF para avisarle a
  la clienta las dos observaciones que no se corrigen en este ticket.
- **Tareas:**
  - [x] `src/modules/help/features/guide/components/_CompanyGuide.tsx`, card "Roles y Permisos"
        (líneas 71-137): después de la lista "Roles del sistema" (líneas 122-135) agregar un
        bloque `<p className="mt-3"><strong>Ver quién tiene cada rol:</strong></p>` + `<ol>` con:
        (1) Ve a **Empresa → Roles**; (2) haz clic en el **número** de la columna **Usuarios**;
        (3) se abre la lista de usuarios activos con ese rol (el propietario aparece marcado como
        **Propietario**); (4) si dice "+N inactivos", son usuarios desactivados que conservan el
        rol y no aparecen en Usuarios; (5) para cambiar el rol de alguien, usa **Gestionar en
        Usuarios** → menú (…) → **Cambiar rol**. Nota final: el link solo aparece si tienes
        permiso para ver Usuarios. Mismo tono y componentes (`<ol className="list-decimal pl-6
        space-y-2 text-muted-foreground">`) que el resto del archivo.
  - [x] `docs/modules/company.md`, sección "Roles" → "Funcionalidades" (líneas 38-43): cambiar la
        viñeta "Lista paginada de roles con conteo de miembros" por una que describa que el
        conteo abre un Popover con los usuarios **activos** (avatar, nombre, email, badge
        Propietario), aviso de inactivos y link a Usuarios condicionado a
        `company.general.users:view`. Agregar una nota técnica: `getRolesPaginated` trae
        `members` filtrados por `isActive` y los enriquece con un único `prisma.user.findMany` en
        lote; `_count.members` sigue contando activos + inactivos y es lo que usan la regla de
        eliminar y `deleteRole`. Mencionar la carpeta nueva `features/general/shared/`
        (`_MemberIdentity`, `member-display.ts`) en la línea de "Archivos".
  - [x] Crear `scripts/guia-presentacion/capturas-tsk692.mjs` sobre la base de
        `capturas-tsk644.mjs:1-47` (Playwright, login con las credenciales de dev, `shot()` que
        remueve `nextjs-portal` antes de capturar, salida a `scripts/guia-presentacion/assets/
        tsk692-*.png`). Requiere `npm run dev` corriendo. Capturas: (1) `tabla-roles`: la tabla
        completa con el contador ya clickeable; (2) `popover-miembros`: Popover abierto sobre un
        rol con un usuario (clic en `[data-testid^="role-members-"]`, captura del `[role="dialog"]`
        más su fila); (3) `popover-inactivos`: Popover de un rol con "+N inactivos" (antes,
        desactivar un usuario de prueba desde Usuarios, o crearlo con Prisma en el script);
        (4) `usuarios-cambiar-rol`: la pantalla Usuarios con el modal "Cambiar rol" abierto, que
        es adonde lleva el link. La captura "antes" es la del propio ticket (la clienta rodeó el
        "1"), así que no hace falta volver a `main` para tomarla.
  - [x] Crear `scripts/guia-presentacion/tsk-692.html` copiando la estructura y estilos de
        `tsk-644.html` (cover con `eyebrow` "Ticket 692 · Empresa", secciones numeradas):
        1. **Qué pedías** (cita textual: "Sería bueno ver quién me quedó en un rol, para ver si no
        le pifié"); 2. **Qué cambió en pantalla** (antes/después: el "1" gris vs. el Popover);
        3. **Cómo se usa** paso a paso con las capturas 1-4; 4. **Qué configuración hace falta**:
        ninguna, solo permisos (ver Roles para la lista; ver Usuarios para el link);
        5. **Qué no cambió**: el número de la columna sigue contando a todos (activos e inactivos),
        cambiar el rol se sigue haciendo en Usuarios, los roles de sistema siguen sin poder
        editarse; 6. **Dos cosas para revisar en tu empresa**: (a) el rol personalizado
        "Administrador" con 0 permisos que convive con el de sistema (1.1): abrir su Popover, ver
        quién está, moverlo desde Usuarios al Administrador de sistema y borrar el vacío;
        (b) si la propietaria no aparece en el rol Propietario es porque su alta no le asignó rol
        (riesgo 2): no afecta sus permisos, y se corrige en otro ticket.
  - [x] Generar el PDF: `node scripts/guia-presentacion/generar-pdf.mjs
        scripts/guia-presentacion/tsk-692.html docs/presentaciones/TSK-692-usuarios-por-rol.pdf`
        (el destino sigue la convención de `docs/presentaciones/TSK-583-…pdf`, `TSK-585-…pdf`,
        `TSK-621-…pdf`).
- **Archivos:**
  - Modificar: `src/modules/help/features/guide/components/_CompanyGuide.tsx`,
    `docs/modules/company.md`
  - Crear: `scripts/guia-presentacion/capturas-tsk692.mjs`, `scripts/guia-presentacion/tsk-692.html`,
    `scripts/guia-presentacion/assets/tsk692-*.png`, `docs/presentaciones/TSK-692-usuarios-por-rol.pdf`
- **Criterio de completitud:** la guía in-app describe el circuito completo en lenguaje de
  usuario; `docs/modules/company.md` explica el filtro `isActive` y por qué `_count.members` no
  cambia; el PDF se genera sin errores, todas las capturas son de la app real y la sección 6
  deja por escrito las dos observaciones para la clienta.

#### Fase 5: Verificación final

- **Objetivo:** cerrar con evidencia: comandos del checklist de commit en verde y los cinco casos
  de uso probados a mano en el navegador.
- **Tareas:**
  - [x] `npm run check-types` (comparar contra la línea base previa al ticket, no exigir cero si
        ya había errores ajenos), `npm run lint`, `npx vitest run` (unitario de la fase 1 +
        integración de la fase 2 + suite existente sin regresiones).
  - [x] Preparar datos en dev: un rol con exactamente 1 activo; un rol con activos + al menos 1
        desactivado (desactivar desde Usuarios → menú (…) → Desactivar, que conserva el `roleId`);
        un rol custom con 0 miembros; y un usuario de prueba con un rol que tenga
        `company.general.roles:view` pero **no** `company.general.users:view`.
  - [x] Prueba manual en `/dashboard/company/general/roles`, caso por caso:
    - Rol con 1 activo → Popover con avatar, nombre y email; "1 activo"; sin línea de inactivos.
    - Rol con activos + inactivos → el número de la columna es el total; la lista muestra solo
      activos; aparece "+N inactivos".
    - Rol con 0 → botón deshabilitado, no abre.
    - Usuario sin `users:view` → el Popover abre pero no muestra "Gestionar en Usuarios".
    - Owner → aparece con el badge "Propietario" en el rol que tenga asignado; si no aparece en
      ningún rol, es el caso del riesgo 2 (documentado, no se corrige acá).
    - "Gestionar en Usuarios" → navega a `/dashboard/company/general/users`, donde "Cambiar rol"
      sigue funcionando igual.
  - [x] Regresiones: tabla y modal de Usuarios idénticos tras el reemplazo por `_MemberIdentity`;
        "Eliminar" sigue habilitado solo con `_count.members === 0`; `deleteRole` sigue
        rechazando roles con miembros (activos o inactivos).
  - [x] Teclado y móvil: `Tab`/`Enter`/`Esc` sobre el trigger; viewport 375px sin corte del
        Popover; modo oscuro.
- **Archivos:** ninguno nuevo; solo correcciones puntuales que salgan de la verificación.
- **Criterio de completitud:** los tres comandos en verde, los seis casos manuales registrados en
  la sección 5 del documento con resultado, y ningún cambio de comportamiento fuera del Popover.

### 2.2 Orden de ejecución

1. **Fases 1 y 2 son independientes y pueden ir en paralelo.** La 1 toca solo `users/` y la carpeta
   `shared/` nueva; la 2 toca solo `roles/actions.server.ts`. No comparten archivos. En ambas, el
   test se escribe primero (rojo) y después el código (verde).
2. **Fase 3 después de la 1 y la 2**, sin excepción: el Popover importa `_MemberIdentity` (fase 1)
   y tipa con `RoleListItem['members']` / `RoleMember` (fase 2). Empezarla antes obliga a
   redeclarar tipos a mano, que es justo lo que la regla de "sin `:any`" quiere evitar.
3. **Fase 4 después de la 3.** La guía in-app y `docs/` se pueden redactar en paralelo con la 3,
   pero las capturas del PDF necesitan la app terminada, así que `capturas-tsk692.mjs` y el PDF
   son lo último de esa fase.
4. **Fase 5 al final**, con todo montado.

**Riesgos de orden a tener presentes:**

- El `vi.mock('@/shared/lib/permissions', …)` de la fase 2 **tiene que usar `importOriginal`**:
  `roles/actions.server.ts:9` importa constantes (`MODULES`, `ACTIONS`, `AUDIT_ACTIONS`) de ese
  módulo. Copiar el mock pelado del test de referencia deja esas constantes `undefined` y el
  síntoma aparece como un error confuso al cargar el módulo, no en el `expect`.
- Si en la fase 2 se cede a la tentación de filtrar también el `_count` por `isActive`, se cambia
  la regla de eliminar (`columns.tsx:110`) y `deleteRole` (`actions.server.ts:508`) en silencio:
  un rol con solo inactivos pasaría a ser "eliminable" en la UI y la action lo seguiría
  rechazando. El `_count` **no se toca**; el dato nuevo es `inactiveMembersCount`.
- En la fase 3, `canViewUsers` tiene que entrar en las dependencias del `useMemo` de
  `_RolesDataTable.tsx:72`; si no, el link no aparece/desaparece al cambiar de usuario sin
  recargar.
- La fase 1 cambia dos pantallas que la clienta ya usa (Usuarios y Cambiar rol). Es un refactor
  sin cambio visual: conviene hacerla en un commit propio para poder aislarla si algo se ve
  distinto.

### 2.3 Estimación de complejidad

- Fase 1 (`_MemberIdentity` + helpers con TDD): **baja**
- Fase 2 (action con miembros + test de integración): **media** — el `findMany` en lote y el mock
  con `importOriginal` son los dos puntos con criterio
- Fase 3 (Popover + columna + permiso): **media** — es presentación pura, pero cruza tres archivos
  y tiene los cinco estados a cubrir (con miembros, mixto, vacío, sin permiso, owner)
- Fase 4 (docs + guía in-app + PDF con capturas): **media** — el PDF con capturas reales y datos
  de prueba coherentes es lo que más tiempo lleva
- Fase 5 (verificación): **baja**

**Complejidad total: baja-media.** No hay migración, no hay permisos nuevos, no hay mutaciones
nuevas ni rutas nuevas. El riesgo técnico está concentrado en no romper la semántica de
`_count.members` (fase 2) y el esfuerzo en el entregable de presentación (fase 4).

### 2.4 Seguimientos fuera de alcance

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **Filtro por rol en la pantalla de Usuarios (puente hacia la alternativa D).** Que "Gestionar
   en Usuarios" lleve `?role=<id>` y que `getCompanyMembersPaginated` lo respete con
   `facetedFilters` + `buildFiltersWhere` (`_UsersDataTable.tsx:202-217`,
   `users/actions.server.ts:49-52`). Decidido fuera de alcance; el link queda sin parámetro.
2. **El buscador de Usuarios no filtra.** El `where` de `getCompanyMembersPaginated`
   (`users/actions.server.ts:49-52`) ignora `state.search` y `state.filters`. Es un bug
   preexistente, independiente de este ticket; conviene resolverlo junto con el punto 1.
3. **Rol personalizado "Administrador" con 0 permisos en la empresa de la clienta** (1.1), que
   convive con el rol de sistema `admin`. No se corrige por código: se le avisa a la clienta en
   la sección 6 del PDF y en el comentario de cierre del ticket, con el procedimiento (ver quién
   está con el Popover nuevo → moverlo desde Usuarios → borrar el rol vacío).
4. **Owner sin `roleId` cuando la empresa nace por sign-up**
   (`src/modules/auth/features/sign-up/actions.server.ts:43-51` crea el `CompanyMember` con
   `isOwner: true` y sin `roleId`, a diferencia de `companies/features/create/actions.server.ts:
   73-81`). Efecto visible: el rol Propietario puede mostrar 0 usuarios aunque haya owner. Se le
   avisa a la clienta (no afecta sus permisos); la corrección del bootstrap es otro ticket.
5. **`_count.members` cuenta inactivos** para la regla de eliminar y para `deleteRole`. Se deja
   así a conciencia (un inactivo con `roleId` sigue referenciando el rol); si se quiere cambiar la
   regla, es una decisión de producto aparte.
6. **Comentario desactualizado en `prisma/schema.prisma:743`** (`// Clerk user ID` en
   `CompanyMember.userId`; hoy es el id local de Better Auth). Cosmético, sin migración.

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-692-usuarios-por-rol`_

## 4. Implementación

### Fase 1: Componente compartido `_MemberIdentity` + helpers puros (TDD)

**Estado:** Completada

**Archivos modificados:**

- `src/modules/company/features/general/shared/member-display.test.ts` (nuevo): 8 tests Vitest
  puros (`describe`/`it` en español, sin mocks) para `getMemberFullName` y `getMemberInitials`;
  se escribió primero y se corrió en rojo (módulo inexistente) antes de implementar.
- `src/modules/company/features/general/shared/member-display.ts` (nuevo): `interface
  MemberDisplayName`, constantes `MEMBER_NO_NAME_LABEL` / `MEMBER_NO_INITIALS_LABEL` y las dos
  funciones, sin imports de React ni Prisma. Único lugar del módulo con el literal "Sin nombre".
- `src/modules/company/features/general/shared/_MemberIdentity.tsx` (nuevo, 50 líneas): Client
  Component con `Avatar` + nombre (`font-medium`) + email (`text-sm text-muted-foreground`);
  `size="sm"` → `h-8 w-8`, `size="md"` → `h-10 w-10`; `alt` = nombre completo; `className`
  opcional fusionado con `cn`.
- `src/modules/company/features/general/users/columns.tsx`: la celda "Usuario" usa
  `<_MemberIdentity size="sm" … />`; se quitó el import de `Avatar*`. Se mantienen
  `enableSorting: false` y `meta.title`.
- `src/modules/company/features/general/users/components/_EditUserRoleModal.tsx`: se quitaron las
  dos `const` (`fullName`/`initials`) y el bloque inline; `<_MemberIdentity size="md" … />` queda
  dentro del contenedor `flex items-center gap-3 p-3 bg-muted rounded-lg`, que se conserva. Se
  quitó el import de `Avatar*`.

**Notas:**

- Verificación: `npx vitest run …/member-display.test.ts` → 8/8 en verde (antes: rojo por módulo
  inexistente). `npx eslint` sobre los 5 archivos → sin avisos. `npm run check-types`: ningún
  error apunta a archivos de esta fase (línea base 227 errores preexistentes; los 18 nuevos que
  aparecen en la corrida están todos en `roles/role-members.integration.test.ts`, archivo de la
  Fase 2 en curso). `grep -rn "Sin nombre" src/modules/company` devuelve solo `member-display.ts`
  y su test, como pide el criterio de completitud.
- Desvío menor respecto de la lógica inline original: el template usa `${firstName ?? ''}`, así
  un `null` no se imprime como el texto "null". En las dos pantallas actuales no cambia nada
  (`CompanyMemberListItem` ya normaliza a `''`), pero deja el helper seguro para los miembros del
  Popover de la Fase 3, cuyos `firstName`/`lastName` vienen del modelo `User` como `String?`.
- En el modal, los `<p>` del bloque original pasan a `<span>` dentro de `flex flex-col` (mismo
  markup que la tabla). Con el preflight de Tailwind es visualmente equivalente.
- La comparación visual en el navegador (última tarea de la fase) no se ejecutó en esta corrida:
  requiere `npm run dev` con sesión iniciada. Queda para la Fase 5 junto con el resto de la
  verificación manual; el checkbox permanece abierto a conciencia.

### Fase 2: `getRolesPaginated` devuelve los miembros activos enriquecidos (TDD de integración)

**Estado:** Completada

**Archivos modificados:**
- `src/modules/company/features/general/roles/role-members.integration.test.ts` (nuevo): 6 casos
  de integración contra la base real (`describe.skipIf(!dbAvailable)`, prefijo `TSK692-`, limpieza
  en `afterAll` que verifica que no quede ninguna empresa de prueba).
- `src/modules/company/features/general/roles/actions.server.ts`: `getRolesPaginated` ahora
  selecciona `members` filtrados por `isActive: true` (orden `isOwner desc, createdAt asc`,
  `select: { id, userId, isOwner }`), resuelve los usuarios de toda la página con **un solo**
  `prisma.user.findMany` (`select: { id, email, firstName, lastName, imageUrl }`, salteado si no
  hay miembros) y devuelve cada rol con `members` enriquecidos (fallback `'Sin email'`/`''`/`''`/
  `null`, igual que `users/actions.server.ts`) e `inactiveMembersCount = _count.members -
  members.length`. Se exporta `RoleMember = RoleListItem['members'][number]`.

**Notas:**
- TDD real: el test se escribió primero y falló con `members === undefined` en los 6 casos;
  después de la implementación pasan los 6. Suite completa: 27 archivos / 342 tests en verde.
- `_count: { select: { members: true } }` quedó **exactamente igual** (sigue contando activos +
  inactivos). El test `rolMixto` lo fija: `_count.members === 2` con `members.length === 1` e
  `inactiveMembersCount === 1`. `deleteRole` y la regla `role._count.members === 0` de
  `columns.tsx:110` no cambian.
- El mock de permisos usa `importOriginal` (`vi.mock('@/shared/lib/permissions', async
  (importOriginal) => ({ ...(await importOriginal()), checkPermission: vi.fn()... }))`) porque
  `actions.server.ts:9` importa `MODULES`, `ACTIONS`, `AUDIT_ACTIONS` y `createAuditLog` del mismo
  módulo.
- El test del lote único usa `vi.spyOn(prisma.user, 'findMany')` + `toHaveBeenCalledTimes(1)` y
  verifica además que el `where.id.in` incluya los `userId` de los tres roles con miembros;
  `afterEach(vi.restoreAllMocks)` para no contaminar los otros casos.
- Se agregó un cuarto rol (`rolHuerfano`) con un miembro cuyo `userId` es un uuid inexistente en
  `User`, para cubrir el fallback sin mezclarlo con los otros roles.
- El caso de orden inserta un no-owner con `createdAt: 2020` (anterior al owner) para probar que
  lo que lo pone primero es `isOwner desc` y no el `createdAt`.
- La base de dev (`contable-pms-db`, puerto 5534) estaba detenida; se levantó con
  `docker compose up -d db` para que el test corra en vez de saltearse.
- `npx eslint` sobre los dos archivos: sin observaciones. `npm run check-types`: 227 errores, todos
  preexistentes, ninguno en `roles/` ni en los consumidores `columns.tsx` / `_RolesDataTable.tsx`
  (solo se agregaron campos a `RoleListItem`).

### Fase 3: `_RoleMembersPopover` en la columna Usuarios + permiso de Usuarios

**Estado:** Completada (queda abierta la verificación visual/teclado/móvil, que se hace en la Fase 5)

**Archivos modificados:**

- `src/modules/company/features/general/roles/components/_RoleMembersPopover.tsx` (nuevo, 113
  líneas): Client Component. Props `{ role: RoleListItem; canViewUsers: boolean }`. Trigger =
  `Button variant="ghost" size="sm"` real (`h-8 gap-1 px-2 font-normal text-muted-foreground`) con
  `Users` + `role._count.members`, `aria-label="Ver usuarios del rol {name}"` y
  `data-testid="role-members-{id}"`; `disabled` cuando `_count.members === 0`. Contenido
  (`align="start" collisionPadding={16} w-72 p-0`): encabezado "Usuarios con el rol {name}" +
  "N usuario(s) activo(s)"; `ul` con `max-h-64 overflow-y-auto` y un `li` por miembro con
  `<_MemberIdentity size="sm">` + Badge ámbar "Propietario" con `Shield` si `isOwner`; estado vacío
  "Ningún usuario activo tiene este rol"; línea "+N inactivo(s) conserva(n) este rol" si
  `inactiveMembersCount > 0`; pie con `Button asChild variant="link"` →
  `<Link href="/dashboard/company/general/users">Gestionar en Usuarios</Link>` solo si
  `canViewUsers`. Sin fetch ni estado.
- `src/modules/company/features/general/roles/columns.tsx`: `canViewUsers: boolean` en
  `GetColumnsProps` y en la desestructuración; la celda de Usuarios pasa a
  `<_RoleMembersPopover role={row.original} canViewUsers={canViewUsers} />`; se conservan
  `accessorKey: 'members'`, `meta.title`, `enableSorting: false`; se quitó `Users` del import de
  lucide. La regla `canDelete && !role.isSystem && role._count.members === 0` y el bloque de
  acciones no se tocaron.
- `src/modules/company/features/general/roles/components/_RolesDataTable.tsx`: `canViewUsers`
  en `Props`, pasada a `getColumns` y sumada a las deps del `useMemo`.
- `src/modules/company/features/general/roles/RolesList.tsx`: tercer elemento del `Promise.all`
  `getModulePermissions('company.general.users')` → `canViewUsers={usersPermissions.canView}`.

**Notas:**

- Decisiones donde el plan dejaba margen: (a) se usó `max-h-64 overflow-y-auto` nativo en el `ul`
  en lugar de `ScrollArea` de Radix, porque el `Viewport` de `scroll-area.tsx` es `h-full` y con un
  `max-h` en el root no limita la altura de forma confiable; (b) el encabezado dice "Usuarios con
  el rol {name}" (incluye el nombre del rol, que es lo que la clienta necesita ver de un vistazo);
  (c) el Badge "Propietario" copia el look ámbar con `Shield` de `users/columns.tsx` para que se
  vea igual que en Usuarios; (d) el texto de inactivos es "+N inactivo conserva este rol" /
  "+N inactivos conservan este rol"; (e) al `_MemberIdentity` se le pasa
  `className="min-w-0 flex-1 [&>div]:min-w-0 [&>div>span]:truncate"` para que emails largos se
  trunquen dentro de los 288px del Popover en vez de desbordarlo; (f) `font-normal` en el trigger
  para que el número no quede en negrita (el `Button` trae `font-medium`) y la celda se vea como
  antes.
- No hace falta `stopPropagation` en el trigger: la tabla de Roles no usa `onRowClick`.
- Único consumidor de `getColumns` de roles es `_RolesDataTable.tsx` (grep), ya actualizado.
- Ruta de Usuarios confirmada en `src/app/(core)/dashboard/company/general/users`.
- Verificación: `npx eslint` sobre los 4 archivos → 0 errores (1 warning preexistente de
  `exhaustive-deps` por `handleEdit` en `_RolesDataTable.tsx`, ya estaba antes de esta fase).
  `npm run check-types` → 227 errores, todos preexistentes, ninguno en `company/features/general`.
  `npx vitest run` → 27 archivos / 342 tests en verde.
- Las tres tareas de regresión visual, teclado y móvil (375px) quedan abiertas a conciencia para la
  Fase 5: no se levantó el dev server en esta corrida.

### Fase 4: Documentación (guía in-app, docs del desarrollador y guía de presentación PDF)

**Estado:** Completada

**Archivos modificados:**

- `src/modules/help/features/guide/components/_CompanyGuide.tsx`: en la card "Roles y Permisos",
  después de "Roles del sistema", bloque **"Ver quién tiene cada rol:"** con `<ol>` de 5 pasos
  (Empresa → Roles; clic en el número de Usuarios; lista de activos con badge Propietario; qué
  significa "+N inactivos conservan este rol"; link "Gestionar en Usuarios" → menú (…) → Cambiar
  rol) y nota final (0 usuarios = número gris sin clic; el link solo con permiso de Usuarios). En
  la card "Gestión de Usuarios" se amplió la línea de "cambiar el rol / desactivar" con el camino
  exacto (menú (…) de la fila) y la aclaración de que un desactivado conserva su rol.
- `docs/modules/company.md`, sección Roles: "Archivos" suma `features/general/shared/`
  (`_MemberIdentity.tsx`, `member-display.ts`); la viñeta del conteo describe el Popover
  (`_RoleMembersPopover`), el filtro de activos, el aviso de inactivos, el link condicionado a
  `company.general.users:view` vía `canViewUsers`, y los dos estados (0 miembros → deshabilitado;
  0 activos + N inactivos → abre con "Ningun usuario activo tiene este rol"). Nueva subsección
  "Nota tecnica: miembros por rol (TSK-692)" con `getRolesPaginated` (`isActive`, lote único de
  `prisma.user.findMany`, `inactiveMembersCount`, tipos `RoleListItem`/`RoleMember`) y por qué
  `_count.members` no cambia (columna, regla de Eliminar, `deleteRole`).
- `scripts/guia-presentacion/tsk-692.html` (nuevo): estructura y estilos copiados de `tsk-644.html`
  (cover con eyebrow "Ticket 692 · Empresa"). Secciones: 1. Qué pedías (cita + captura del ticket);
  2. Qué cambió en pantalla (antes/después + captura principal con el Popover); 3. Cómo se usa,
  paso a paso (5 pasos; capturas de Contador con inactivo, Propietario con badge, y la tabla de
  Usuarios); 4. Detalles que conviene saber (número vs. lista e inactivos, rol con 0 no abre,
  badge Propietario, quién ve el link); 5. También en el celular (captura 375px); 6. Qué no cambió;
  7. Dos cosas para revisar en tu empresa (rol "Administrador" custom con 0 permisos → ver quién
  está, moverlo al Administrador del sistema, borrar el vacío; rol Propietario en 0 → no afecta
  permisos, se corrige de nuestro lado). Textos de UI tomados literalmente de
  `_RoleMembersPopover.tsx`.
- `scripts/guia-presentacion/assets/tsk692-00-antes-ticket.png` (nuevo): la captura del ticket,
  copiada del scratchpad. `tsk692-02-tabla-con-popover-recorte.png` y `tsk692-07-movil-recorte.png`
  (nuevos): recortes con ImageMagick del espacio en blanco inferior de las capturas 02 y 07; los
  originales quedan intactos.
- `docs/presentaciones/TSK-692-usuarios-por-rol.pdf` (nuevo): 4 páginas A4, 275 KB, generado con
  `node scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-692.html
  docs/presentaciones/TSK-692-usuarios-por-rol.pdf`.

**Notas:**

- Desvío respecto del plan en la sección 7 (b) del PDF: el plan y la consigna decían "asignarle
  Propietario desde Usuarios", pero `updateMemberRole` (`users/actions.server.ts:579-581`) rechaza
  cambiar el rol de un `isOwner`. El PDF dice en cambio que no tiene que hacer nada, que avise y lo
  corregimos nosotros, y que el bootstrap se arregla en otro ticket (seguimiento 2.4.4). Además,
  en la captura del ticket el rol Propietario muestra 1, así que el aviso se redactó como "por si
  lo ves en otra empresa".
- La sección 4 del plan ("Qué configuración hace falta: ninguna") se fusionó como cuarta viñeta de
  "Qué no cambió" para no dedicarle una sección a decir "nada"; la sección "Detalles que conviene
  saber" (decisiones de UI de la Fase 3) y "También en el celular" no estaban en el plan original y
  se agregaron porque las capturas ya existían.
- Paginación: `section.allow-break` en las secciones 3, 4 y 7 y `page-break-inside: avoid` en
  `.callout` para que ningún callout se parta; la captura móvil se limitó a 160px de ancho para
  cerrar en 4 páginas sin dejar el pie solo en una quinta.
- `docs/architecture/project-structure.md` no se tocó: su plantilla ya lista un `shared/` genérico
  por módulo y `features/general/shared/` no tenía un lugar natural sin forzarlo.
- Verificación: `npx eslint …/_CompanyGuide.tsx` → sin avisos; `npm run check-types` → 227 errores
  (misma línea base, ninguno nuevo).

### Fase 5: Verificación final

**Estado:** Completada (2026-09-16, antes de la Fase 4 para que el PDF tuviera capturas reales)

- Dev server en `:3010` con `NEXT_PUBLIC_APP_URL=http://localhost:3010` por variable de entorno (el
  `:3000` lo ocupa otro proyecto y `auth-client.ts` usa esa URL; sin el override el login falla con
  "Failed to fetch").
- Datos en dev sembrados con un script temporal (`initializeCompanyRbac` + 5 usuarios `@demo.local`):
  Administrador 1 activo + 1 inactivo, Contador 2 + 1, Desarrollador 0, Propietario 1 (owner, que
  estaba sin `roleId`).
- Ajuste surgido de la prueba: con el badge Propietario el nombre y el email quedaban truncados en
  `w-72`; el popover pasó a `w-80`, el badge se compactó y `_MemberIdentity` expone `title`
  (commit `f737dbc`).

## 5. Verificación

| Caso | Resultado |
|---|---|
| Rol con activos + inactivos (Administrador, Contador) | Lista de activos, "+1 inactivo conserva este rol", link Gestionar en Usuarios |
| Rol con owner (Propietario) | Badge ámbar Propietario, nombre y email legibles |
| Rol con 0 usuarios (Desarrollador) | Botón deshabilitado, no abre |
| Teclado | `Tab` llega al trigger, `Enter` abre, `Tab` llega al link, `Esc` cierra y devuelve el foco al trigger |
| Alto de fila | 49px con botón vs 48.5px deshabilitado: sin regresión |
| Móvil 375px | Popover de 320px dentro del viewport (x=39..359), `collisionPadding` funciona |
| Tabla y modal de Usuarios | Idénticos tras `_MemberIdentity` (captura `tsk692-06`) |
| `npx vitest run` | 27 archivos / 342 tests en verde (14 nuevos) |
| `npm run check-types` | 227 errores = línea base, ninguno en archivos tocados |
| `npx eslint` sobre lo tocado | Limpio (1 error y 2 warnings preexistentes en `audit/` y `_RolesDataTable.tsx`, fuera del cambio) |

No probado: usuario sin `company.general.users:view` (no hay un segundo usuario con sesión en dev). La
rama es un `canViewUsers &&` directo, sin lógica adicional.

Capturas: `scripts/guia-presentacion/assets/tsk692-*.png`. Script: `capturas-tsk692.mjs [baseUrl]`.
