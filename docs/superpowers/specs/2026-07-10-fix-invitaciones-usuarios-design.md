# Fix — No deja invitar a nuevos usuarios (TSK-410)

**Fecha:** 2026-07-10
**Ticket:** #410 "[Empresa] No deja entrar a nuevos usuarios" (reabierto)
**Tipo:** Bugfix

## Problema

El cliente no puede invitar a un usuario nuevo (caso "Vane"), mientras que otro
usuario ("Beti") sí funcionaba. El fix previo de infraestructura (quitar la barra
final de `NEXT_PUBLIC_APP_URL`, que generaba links `//invite` rotos) corrigió el
enlace, pero queda un bug de código.

## Causa raíz

En `src/modules/company/features/general/users/actions.server.ts`:

- `inviteUser` (`:344`) crea la invitación con `prisma.companyInvitation.create`.
- El modelo tiene `@@unique([companyId, email])` (`prisma/schema.prisma:766`).
- La validación de duplicado (`:275-286`) solo detecta invitaciones **pendientes
  y no expiradas** (`acceptedAt: null` + `expiresAt > now`).

Si el email ya tiene una fila en `company_invitations` que está **expirada**
(muy plausible: el link roto `//invite` impidió aceptarla dentro de los 7 días) o
fue **aceptada y el miembro luego removido**, la validación no la encuentra y el
`create` choca contra el índice único → error Prisma **P2002** → "no deja invitar".

Agravante: `getPendingInvitations` (`:130-135`) filtra `expiresAt > now`, así que
esa invitación expirada **no se lista** en la UI y no hay botón Reenviar/Cancelar
disponible → callejón sin salida para el admin.

Secundario: en `inviteUser` el envío del email va en un try/catch que **loguea
pero no propaga** (`:384-398`). Si el SMTP falla, la invitación se crea, la UI
muestra "Invitación enviada" y el email nunca llega, sin que el admin lo note.
(En `resendInvitation` sí se propaga, por eso el botón Reenviar sirve de
diagnóstico.)

No hay límite de seats/plan (descartado).

## Solución

### 1. `inviteUser` a prueba de colisión

Mantener las validaciones actuales:
- rechazar si existe invitación **pendiente vigente** (mismo mensaje);
- rechazar si el email ya es **miembro activo**.

Reemplazar el `create` por un **`upsert` sobre la clave única `(companyId, email)`**:
- `create`: igual que hoy.
- `update` (cuando existe una fila vieja expirada o de un miembro removido):
  renueva `roleId`, `employeeId`, `invitedBy`, `expiresAt` y fuerza
  `acceptedAt: null`. El `token` se conserva (el enlace sigue estable).

Esto elimina el P2002 y **desbloquea a Vane en el próximo intento sin tocar la
base de producción**.

### 2. Avisar cuando el email no sale

`inviteUser` devuelve un flag `emailSent: boolean`. Si el envío falla, la
invitación queda igualmente creada (no se pierde), pero la UI avisa:
*"Invitación creada, pero no se pudo enviar el email. Usá Reenviar."*

### 3. Listar también las invitaciones expiradas

`getPendingInvitations` deja de filtrar por expiración y agrega un flag
`isExpired` por fila. La UI muestra un badge **"Expirada"** y habilita
**Reenviar** (que ya renueva `expiresAt`) y **Cancelar**. Fin del callejón sin
salida.

### 4. UI

En la tabla de invitaciones (`_UsersDataTable.tsx` / componente de invitaciones
pendientes): badge "Expirada" y asegurar que las acciones Reenviar/Cancelar estén
disponibles en ese estado. El toast de alta contempla el caso `emailSent: false`.

## Archivos afectados

- `src/modules/company/features/general/users/actions.server.ts`
  (`inviteUser`, `getPendingInvitations`, tipo `PendingInvitation`).
- Componente(s) de UI de usuarios/invitaciones (badge "Expirada" + toast).

## Verificación

- `npm run check-types` y `npm run lint`.
- Reproducción contra la DB local: crear invitación → forzar `expiresAt` en el
  pasado → reinvitar el mismo email. Antes: falla con P2002. Después: reutiliza la
  fila y funciona; la invitación expirada aparece listada con opción de reenvío.

## Fuera de alcance

- No se toca el modelo de datos (sin migración).
- No se cambia el proveedor de email ni la plantilla.
