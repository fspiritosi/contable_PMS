# TSK-621 — Actualización de listas de precios por índice

**Fecha:** 2026-08-29
**Ticket:** [621] "[Almacenes] Actualización de lista de precios"
**Reportante:** Elizabeth Perez (eperez@perezmarzo.com.ar)
**Estado:** diseño aprobado, pendiente de plan de implementación

---

## 1. Qué se pide

> Se necesitaría un apartado de la posibilidad de actualizar por un parámetro, que pudiera ser
> elegible (por ejemplo IPC, Polinómica, etc, armadas previamente) y que se reajuste los precios
> a ese porcentaje.

La captura adjunta al ticket la muestra parada en **Almacenes → Listas de Precios → Editar Lista
de Precios**, sobre la lista "Sistema RH". Ahí es donde espera encontrar el apartado.

## 2. Qué existe hoy

- **Listas de precios** (`PriceList` + `PriceListItem`) con alta, edición y borrado ítem por
  ítem, más un diálogo para agregar varios ítems de una. **No hay ninguna forma de actualizar
  precios en masa dentro de una lista.**
- **Ajuste masivo de precios de ítems** (`_BulkPriceAdjustModal`), que aplica un porcentaje o un
  monto fijo al precio de costo y de venta de los **ítems seleccionados**. Es otra cosa: opera
  sobre el ítem, no sobre las listas, y el porcentaje se escribe a mano cada vez.
- No existe ningún concepto de índice, coeficiente ni parámetro guardado.

## 3. Decisiones tomadas

| Decisión                 | Elección                            | Por qué                                                                                                            |
|--------------------------|-------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| Qué es un "parámetro"    | **Índice con un valor por período** | Cubre el caso IPC, que es el que ella nombra primero, y deja registro de qué valor se aplicó en cada actualización |
| Alcance de la aplicación | **Toda la lista, con vista previa** | Es el caso real: sale el índice del mes y se actualiza la lista entera                                             |
| Redondeo                 | **2 decimales**                     | Fiel al índice, sin introducir un criterio comercial que nadie pidió                                               |
| Deshacer                 | **Fuera de alcance**                | Ver abajo                                                                                                          |
| Fórmula polinómica       | **Fuera de alcance**                | Ver abajo                                                                                                          |

### Por qué no hay "deshacer"

Revertir una actualización parece simple —restar el porcentaje— y no lo es. Entre que se aplica
un índice y que alguien quiere deshacerlo, los precios pueden haberse editado a mano, pueden
haberse agregado ítems nuevos a la lista, o puede haberse aplicado un segundo índice encima.
Restar el porcentaje sobre ese estado no devuelve los precios anteriores: los rompe.

Un "deshacer" correcto exige guardar el precio anterior de cada ítem en cada aplicación y
resolver qué hacer cuando el precio actual ya no es el que se dejó. Eso es una feature propia,
más grande que esta, y nadie la pidió todavía.

**Lo que sí queda:** el historial registra qué índice, qué período, qué porcentaje, cuándo y
sobre cuántos ítems, así que siempre se puede reconstruir qué pasó y corregir a mano con esa
información a la vista.

### Por qué no hay fórmula polinómica

El ticket la nombra ("IPC, Polinómica, etc"), y en Argentina una fórmula polinómica de
redeterminación pondera varios índices con pesos (40% mano de obra + 30% materiales + 30% IPC).
Se consultó y **el caso a resolver hoy es el IPC**: un índice, un porcentaje por mes. El modelo
que se elige no cierra la puerta —una fórmula sería un tipo de índice cuyo valor se calcula
desde otros— pero construirla ahora sería resolver un problema que la usuaria no tiene.

## 4. Modelo de datos

Tres modelos nuevos:

```
PriceIndex              id, companyId, name, description?, isActive
                        UNIQUE (companyId, name)

PriceIndexValue         id, indexId, period (fecha, día 1 del mes), percentage Decimal(6,3)
                        UNIQUE (indexId, period)

PriceListAdjustment     id, priceListId, indexId, indexValueId,
                        percentage (el aplicado), itemsAffected,
                        appliedAt, appliedBy
```

- `percentage` es `Decimal(6,3)`: el IPC se publica con un decimal, tres dan margen. **Admite
  negativos**: un índice puede dar baja, y bloquearlo sería inventar una restricción que la
  realidad no tiene.
- `period` es una fecha con el día 1 del mes, no un string `YYYY-MM`: ordena y filtra sin
  parsear texto.
- Los índices son **por empresa**, como el resto de los catálogos.
- `PriceListAdjustment` guarda el `percentage` aplicado además del `indexValueId`. Es
  redundante a propósito: si alguien corrige el valor del índice después, el historial tiene
  que seguir diciendo qué se aplicó realmente ese día.

## 5. Reglas de negocio

- El precio nuevo es `precio × (1 + porcentaje / 100)`, redondeado a 2 decimales.
- Se actualizan **`price` y `priceWithTax` juntos**: el segundo se recalcula desde el primero
  con el IVA del ítem, **no** se le aplica el índice por separado. Aplicarlo dos veces por
  separado los desincroniza por redondeo.
- Un índice **sin valor cargado para ese período no se puede aplicar**. La pantalla lo dice y
  ofrece ir a cargarlo.
- La aplicación corre en **una transacción**: se actualizan todos los ítems de la lista o
  ninguno.
- **Doble aplicación:** si la lista ya recibió ese índice y ese período, se **advierte** con la
  fecha y el usuario que lo hizo, y se deja continuar. No se bloquea: puede haber un motivo
  legítimo, pero nadie debería repetirlo sin enterarse. Aplicar dos veces un 4,2% sube 8,6%.
- Una lista **sin ítems** no ofrece la acción.

## 6. Interfaz

**Catálogo de índices** — `company/features/price-indexes/`, siguiendo el patrón de
`discount-presets`: un listado con alta y edición del índice (nombre, descripción, activo).

Los **valores por período** son una tabla propia dentro de una **pantalla de detalle** del
índice (`/dashboard/company/price-indexes/[id]`), no un modal: son una lista que crece un
renglón por mes y se consulta hacia atrás, así que necesita su propio espacio con su ABM.

**Aplicación** — botón *"Actualizar por índice"* en la lista de precios. Abre un diálogo con
todo en una pantalla:

```
Actualizar precios por índice
  Índice:   [ IPC                    ▾ ]
  Período:  [ 2026-08   +4,20 %      ▾ ]

  ⚠ Esta lista ya recibió IPC 2026-08 el 12/09/2026, aplicado por Fabricio.

  Ítem                  Precio actual     Precio nuevo
  Servicio RH             120.000,00        125.040,00
  Soporte                  80.000,00         83.360,00
  ...                                                    (47 ítems)

  [ Cancelar ]                          [ Aplicar a los 47 ítems ]
```

**Historial** — sección en el detalle de la lista con las actualizaciones aplicadas: índice,
período, porcentaje, fecha, usuario y cantidad de ítems.

## 7. Archivos

| Capa       | Archivos                                                                                            |
|------------|-----------------------------------------------------------------------------------------------------|
| Datos      | `prisma/schema.prisma` + migración con los tres modelos                                             |
| Cálculo    | `price-lists/shared/price-index-calc.ts` — aplicar porcentaje, redondear, recalcular `priceWithTax` |
| Catálogo   | `company/features/price-indexes/` — listado, modal de alta, detalle con valores                     |
| Aplicación | `_ApplyPriceIndexDialog.tsx` + action transaccional en `price-lists`                                |
| Historial  | Sección en el detalle de la lista de precios                                                        |
| Navegación | Entrada en el sidebar de configuración                                                              |

**Permisos:** el ABM de índices usa un permiso propio, **`company.price-indexes`**, y la
aplicación del índice a una lista usa `commercial.price-lists` con acción `update`.

> Corrección sobre la decisión inicial: se había resuelto usar `commercial.price-lists` para
> todo, para no crear un permiso más. Al relevar el código se vio que **cada catálogo de empresa
> tiene su propio permiso** (`company.discount-presets`, `company.cost-centers`, etc.) y que el
> sidebar filtra por él. Sin permiso propio, la entrada del menú no se podría ocultar por rol y
> quedaría fuera del patrón del proyecto.

## 8. Pruebas

**Vitest**, sobre el helper de cálculo, que es lo único con lógica real:
- Redondeo a 2 decimales, incluido el caso que cae justo en el medio.
- `priceWithTax` recalculado desde `price` con el IVA del ítem, no ajustado por separado.
- Porcentaje negativo: baja los precios.
- Porcentaje cero: no cambia nada.

**Integración contra la base**, para lo que ningún test unitario cubre:
- La aplicación es atómica: si falla un ítem, ninguno queda actualizado.
- El historial queda registrado con el porcentaje efectivamente aplicado.
- La detección de doble aplicación encuentra una aplicación previa de la misma lista, índice y
  período.

## 9. Documentación

Los tres entregables de siempre: guía de usuario in-app, `docs/` para el modelo de datos, y la
**guía de presentación en PDF** para la clienta, con el flujo completo: cargar el índice del
mes, aplicarlo a una lista y ver el historial.

## 10. Fuera de alcance

- **Deshacer** una actualización aplicada (sección 3).
- **Fórmulas polinómicas** con ponderación de varios índices (sección 3).
- Aplicar índices al precio de costo y de venta de los ítems: eso ya lo hace el ajuste masivo
  existente con un porcentaje escrito a mano, y unificarlo es otro ticket.
- Importar valores de índice desde un archivo o una API del INDEC: se cargan a mano.
- Programar actualizaciones automáticas.

## 11. Riesgos

- **Actualizar precios es una acción que se ve enseguida en la facturación.** La vista previa
  antes de confirmar es la mitigación principal: nadie aplica a ciegas.
- **No hay marcha atrás** (sección 3). El historial permite reconstruir y corregir a mano.
- Una lista con muchos ítems genera una transacción grande. Con los volúmenes actuales (decenas
  de ítems por lista) no es un problema; si alguna lista creciera a miles, habría que revisar.
