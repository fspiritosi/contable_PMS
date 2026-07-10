# Movimientos de fondos, separador de miles y renombre de Gastos (TSK-413)

**Fecha:** 2026-07-10
**Ticket:** #413 "[Otro] No encuentro cómo hacer aporte de socios"
**Tipo:** Feature + mejoras de UX

## Contexto (pedido de la clienta)

1. No encuentra cómo registrar el **aporte de socios** (poner plata en la cuenta
   bancaria según el % de cada socia). No es un gasto: es activo contra activo/
   capital. Intentó forzarlo creando una categoría de Gasto "Aporte de socios".
2. Pregunta qué es el módulo "Gastos" y sugiere reencuadrarlo (en su otro sistema
   lo llaman "movimientos de fondos").
3. Pide **separadores de miles** al escribir importes ("tengo que contar los ceros").

## Decisiones acordadas

- Renombrar el módulo **"Gastos" → "Egresos"** (solo texto de UI) y crear una
  feature **nueva** "Movimientos de fondos" (no se unifican).
- La feature nueva cubre 3 tipos: **aporte de socio**, **transferencia entre
  cuentas** y **retiro de socio**, generando el asiento automático.
- La contrapartida del aporte es una **cuenta configurable en Ajustes contables**
  (nueva `partnerContributionsAccountId`, tipo EQUITY).
- Input de moneda reutilizable con separador de miles.

## Fase 1 — Renombre + separador de miles (implementada)

- **Renombre "Gastos" → "Egresos"**: textos visibles del módulo
  `commercial/features/expenses`, ítem de sidebar (`_AppSidebar.tsx`) y label del
  permiso `commercial.expenses` (`permissions/constants.ts`). No se tocan
  identificadores (el código usa `Expense`/`expense`) ni las "cuentas de gastos"
  contables (otro concepto).
- **`MoneyInput`** (`shared/components/ui/money-input.tsx`): input es-AR (miles
  con punto, decimal con coma) que expone al formulario el valor crudo con punto
  decimal (compatible con las validaciones Zod `^\d+(\.\d{1,2})?$`). Aplicado en
  el form de Nuevo Egreso; queda listo para adoptar en el resto de formularios de
  importes.

## Fase 2 — Feature "Movimientos de fondos"

Aprovecha infraestructura existente:
- **Transferencias entre cuentas** ya existen: `createBankTransfer`
  (`treasury/features/bank-movements/actions.server.ts:1026`) con asiento
  automático. La feature las reutiliza/expone, no las reimplementa.
- **Socios** ya tienen modelo (`Partner`, `PartnerAccountMovement`), pero
  `createPartnerMovement` **no genera asiento**. El aporte/retiro debe generarlo.
- El molde de asiento activo-contra-activo es
  `createJournalEntryForBankMovement(input, tx)`.

### Datos
- Agregar a `AccountingSettings` el campo `partnerContributionsAccountId`
  (EQUITY) + relación, la inversa en `Account`, el input de
  `saveAccountingSettings` y el bloque en `_CommercialIntegrationForm.tsx`
  (filtrando `type === 'EQUITY'`, igual que `resultAccountId`). Requiere
  migración.
- Extender `PartnerMovementType` con `CONTRIBUTION` (aporte) — retiro puede
  mapear a `REPAYMENT` o un tipo nuevo `WITHDRAWAL`.

### Asientos
- **Aporte de socio**: Debe cuenta de banco/caja destino, Haber
  `partnerContributionsAccountId`. Registra además un `PartnerAccountMovement`.
- **Retiro de socio**: Debe cuenta de aportes/capital (o cuenta del socio),
  Haber banco/caja.
- **Transferencia**: delega en `createBankTransfer`.
- Un helper interno `createJournalEntryForFundMovement(input, tx)` genera el
  asiento dentro de la misma transacción, con numeración atómica.

### UI y plataforma
- Feature en `commercial/features/treasury/features/fund-movements/`
  (list + create) siguiendo la plantilla de `accounting/features/entries`.
- Selects de cuentas con `getAccountsForBankMovement`; socios con `getPartners`.
- Importes con `MoneyInput`.
- Permiso `commercial.treasury.fund-movements` (registrar en
  `permissions/constants.ts`: MODULES, MODULE_LABELS, MODULE_GROUPS) e ítem de
  sidebar en Tesorería. checkPermission en todas las actions.
- Convertir Decimals a Number antes de Client Components.
- Guía de usuario + tests E2E.

## Verificación

- Fase 1: `check-types` + `lint` verdes; test de la lógica de `MoneyInput`
  (formato/parseo, truncado a 2 decimales, round-trip) — OK.
- Fase 2: migración aplicada; asiento balanceado por tipo; reflejo en cuenta
  corriente del socio; prueba en vivo del alta.

## Estado

- **Fase 1: implementada** (rama `feat/tsk-413-movimientos-fondos`).
- **Fase 2: diseñada, pendiente de implementación** (feature grande con migración).
