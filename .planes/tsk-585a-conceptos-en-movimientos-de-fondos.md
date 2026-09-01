# TSK-585 (parte A) — Conceptos discriminados en el movimiento de fondos

**Fecha:** 2026-08-30
**Ticket:** [585] "[Otro] no tengo cómo cargar los impuestos bancarios"
**Reportante:** Elizabeth Perez (eperez@perezmarzo.com.ar)
**Estado:** diseño aprobado, pendiente de plan de implementación

---

## 1. Qué se pide

> Te paso el print de Bejerman que lo cargamos como un movimiento de fondo, sumando todo el mes
> en 1 solo movimiento. Es importante discriminar los conceptos y que estén atados a la
> contabilidad.

La captura muestra un movimiento de fondos de Bejerman: un origen —Cta Cte Santander Río por
$1.736.728,44— desglosado en dos conceptos que suman exactamente ese total:

| Concepto | Importe |
|---|---|
| Sircreb IIBB Bcrio | 302.574,16 |
| Impuesto a los débitos | 1.434.154,28 |

## 2. Por qué es la parte A

El ticket 585 traía **dos pedidos independientes**, y se acordó separarlos:

- **Parte B (entregada):** poder cargar el resumen bancario como comprobante de compra, con el
  banco como proveedor y el tipo "Gastos Bancarios", para computar el IVA. Resuelta en la rama
  `feat/tsk-585-gastos-bancarios` con un valor nuevo en el enum de tipos de comprobante.
- **Parte A (este spec):** el débito bancario del mes desglosado en conceptos, **sin IVA**, con
  cada concepto imputado a su cuenta contable.

Los gastos bancarios **con** IVA van por la parte B; los que no llevan IVA (impuestos,
retenciones, sellados) van por acá.

## 3. Qué existe hoy, y por qué no alcanza

- **`FundMovement`** tiene un solo `amount` y una `description`: no hay dónde discriminar nada.
- **`FundMovementType`** solo tiene tres valores —aporte de socio, retiro de socio y
  transferencia entre cuentas—, todos movimientos entre cuentas propias o contra capital.
  **Ninguno sirve para un gasto**, que va contra una cuenta de resultado.
- **El módulo de gastos (`Expense`) tampoco sirve**, y por un motivo que conviene dejar
  registrado: `createJournalEntryForExpense` imputa **siempre** a `settings.expensesAccountId`
  contra `payablesAccountId`. Es decir, **hoy todos los gastos van a la misma cuenta contable**,
  sin importar su categoría, y se registran como deuda en vez de como pago directo. Cuando la
  clienta pide que los conceptos "estén atados a la contabilidad", pide algo que el módulo de
  gastos no puede hacer para ningún gasto.

Se evaluó resolverlo en el módulo de gastos —agregándole líneas con cuenta propia y pago
directo— y se descartó: arreglaría esa limitación de fondo, pero toca un flujo que ya funciona
y excede lo que el ticket pide. Queda anotado como deuda conocida.

## 4. Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| Dónde vive | **Movimiento de fondos, con un tipo nuevo** | Es lo que la clienta ya hace en su sistema anterior, y no toca ningún flujo existente |
| Cuentas por línea | **Egresos y activo** | Sircreb es una retención a computar, no un gasto: mandarla a resultado sería incorrecto |
| El importe total | **Suma de las líneas, calculado** | Si se pudiera tipear aparte, se desincroniza del desglose |
| IVA | **Fuera**: va por la parte B | Un movimiento de fondos no discrimina IVA |

## 5. Modelo de datos

```
FundMovementType     + BANK_CHARGES        →  "Gastos e impuestos bancarios"

FundMovementLine     id
                     movementId  FK → fund_movements, borrado en cascada
                     accountId   FK → accounts
                     description String
                     amount      Decimal(15,2)
                     position    Int          orden de carga
```

`FundMovement.amount` sigue existiendo y guarda **el total**, que para este tipo es la suma de
las líneas. No se agrega un campo nuevo: el total es el mismo concepto de siempre, solo cambia
de dónde sale.

## 6. Reglas de negocio

- El tipo `BANK_CHARGES` **exige al menos una línea**. Los otros tres tipos siguen **sin**
  líneas y no cambian en nada.
- Cada línea necesita **cuenta, descripción e importe mayor a cero**.
- La cuenta debe ser **imputable (hoja, activa) y de tipo egreso o activo**. Pasivo y patrimonio
  quedan fuera: no son contrapartida de un débito bancario. Es el mismo criterio que usan los
  ítems desde el TSK-579.
- El movimiento **sale** de un banco o una caja (`fundOut`) y **no tiene destino** (`fundIn`):
  la plata se va, no pasa a otra cuenta propia.
- `amount` del movimiento = **suma de los importes de las líneas**, calculada en el servidor. No
  se confía en el total que mande el formulario.
- Al confirmar, el asiento tiene **N+1 líneas**: un débito por cada concepto a su cuenta, y un
  crédito por el total a la cuenta contable del fondo de origen. Esa cuenta ya se resuelve hoy
  en `actions.server.ts:191-240`: es la del banco o la caja, con las cuentas por defecto de la
  configuración contable como respaldo. No hay que resolver nada nuevo, solo reusarla.
- En borrador se edita libremente, incluidas las líneas. Al confirmar se valida y se genera el
  asiento, como ya hace el módulo hoy.
- Un movimiento confirmado no se edita, igual que los demás.

## 7. El asiento: el punto delicado

`createJournalEntryForFundMovement` hoy recibe `debitAccountId` y `creditAccountId` y arma
**exactamente dos líneas**. Hay que generalizarla para aceptar N débitos contra un crédito.

**El riesgo de esta entrega está acá**: los otros tres tipos de movimiento ya funcionan y usan
esa misma función. La generalización tiene que dejarlos generando su asiento de dos líneas,
idéntico al de hoy. Es lo que el test de integración tiene que cubrir explícitamente, no solo
el caso nuevo.

## 8. Interfaz

El formulario ya condiciona campos por tipo (`isContribution`, `isWithdrawal`, `isTransfer`);
se suma `isBankCharges` siguiendo ese patrón.

Con el tipo nuevo elegido: desaparece el campo de importe, desaparece el fondo de destino, y
aparece la tabla de conceptos.

```
Tipo:      [ Gastos e impuestos bancarios  ▾ ]
Sale de:   [ Cta Cte Santander Río         ▾ ]
Fecha:     [ 31/07/2026 ]

Conceptos                                    [ + Agregar ]
  Cuenta                    Descripción            Importe
  1.1.5/02 Ret. IIBB    Sircreb IIBB Bcrio      302.574,16
  4.2.1/03 Imp. y tasas Impuesto a los débitos 1.434.154,28
  ─────────────────────────────────────────────────────────
  Total                                        1.736.728,44
```

Cada fila usa `AccountCombobox` (el buscador de cuentas del TSK-464) y `MoneyInput` (del
TSK-580). El total se muestra al pie y es lo que se guarda.

## 9. Archivos

| Capa | Archivos |
|---|---|
| Datos | `prisma/schema.prisma` + migración: el valor del enum y el modelo `FundMovementLine` |
| Validación | `fund-movements/shared/validators.ts` y su `.test.ts`, que ya existe |
| Cálculo | `fund-movements/shared/lines-calc.ts` — suma de líneas y validación de cada una |
| Pantalla | `_CreateFundMovementModal.tsx` + `_FundMovementLinesField.tsx` para la tabla de conceptos |
| Persistencia | `fund-movements/list/actions.server.ts` |
| Asiento | `createJournalEntryForFundMovement`, generalizada a N+1 |

**Permisos:** los que ya usa el módulo de movimientos de fondos. No se crean nuevos.

## 10. Pruebas

**Vitest**, sobre las reglas y el cálculo:
- El tipo nuevo exige al menos una línea; los otros tres siguen sin pedirlas.
- Cada línea necesita cuenta, descripción e importe mayor a cero.
- El total es la suma de las líneas, incluido el caso de importes con centavos.

**Integración contra la base**, para lo que ningún test unitario cubre:
- El asiento del tipo nuevo tiene N+1 líneas y **está balanceado**: la suma de los débitos es
  igual al crédito del banco.
- **Regresión**: los tres tipos existentes siguen generando su asiento de dos líneas, con las
  mismas cuentas que antes. Es el riesgo principal de la entrega (sección 7).
- El movimiento en borrador guarda y relee sus líneas.

## 11. Documentación

Los tres entregables de siempre: guía de usuario in-app, `docs/` para el modelo de datos, y la
**guía de presentación en PDF** para la clienta, mostrando cómo cargar el débito del mes
desglosado en sus conceptos.

La guía debe aclarar **cuándo usar cada cosa**, que es la confusión más probable: los gastos
bancarios **con IVA** se cargan como comprobante de compra (parte B), y los impuestos y
retenciones **sin IVA** como movimiento de fondos (esta parte).

## 12. Fuera de alcance

- **Centro de costo por línea.** Sería coherente con el TSK-583, pero nadie lo pidió y los
  impuestos bancarios no suelen repartirse entre centros.
- **Importes negativos** (una devolución del banco). Sería otro tipo de movimiento, no una línea
  negativa acá.
- **IVA en las líneas.** Va por la parte B.
- **Arreglar la imputación de los gastos** (`Expense` siempre a la misma cuenta). Es la deuda
  que quedó documentada en la sección 3, y merece su propio ticket.
- Importar el resumen bancario desde un archivo del banco.

## 13. Riesgos

- **La generalización del asiento toca código que ya funciona** para tres tipos de movimiento en
  uso. Mitigación: el test de regresión de la sección 10.
- El total calculado en el servidor puede diferir de lo que el usuario ve si el formulario
  redondea distinto. Mitigación: los importes son `Decimal(15,2)` y el total es una suma simple,
  sin porcentajes ni prorrateos de por medio.
