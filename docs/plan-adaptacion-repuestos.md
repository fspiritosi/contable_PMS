# Plan de Adaptacion de Baxer para Casa de Repuestos

## Contexto

Baxer-N es un ERP general multi-industria. Para adaptarlo al rubro de repuestos automotrices, se identificaron funcionalidades presentes en Boxer Gestion (ERP especializado en repuestos) que no existen en Baxer. Este documento prioriza cuales implementar y cuales descartar.

Documento de referencia: `docs/comparacion-boxer-vs-baxer.md`

---

## PRIORIDAD ALTA - Imprescindibles para operar

| Funcionalidad | Justificacion |
|---|---|
| **Dashboard con widgets comerciales** (Top deudas clientes/proveedores, Top productos, Ventas semanales, Medios de pago) | Es la pantalla que el dueno/gerente mira todos los dias. Sin esto, no tienen visibilidad del negocio. Baxer ya tiene dashboard pero vacio de KPIs comerciales. |
| **Presupuestos/Cotizaciones** (habilitar `quotes`) | En repuestos se presupuesta constantemente antes de vender. Ya existe la estructura en Baxer, solo hay que habilitarla y completarla. Mejor relacion costo/beneficio. |
| **Carga masiva de productos por Excel** | Con +10.000 articulos, nadie carga uno por uno. Los proveedores de repuestos envian listas en Excel. Sin esto, la migracion inicial y las actualizaciones de catalogo son inviables. |
| **Ajuste masivo de precios** | Cuando un proveedor actualiza su lista (pasa seguido con inflacion), necesitan remarcar cientos de productos a la vez. Sin esto, el operador pierde horas. |
| **Descuentos flexibles en ventas** (%, $, compuesto) | El mostrador de repuestos negocia descuentos constantemente. Es parte del flujo diario de venta. |

---

## PRIORIDAD MEDIA - Muy utiles, segundo sprint

| Funcionalidad | Justificacion |
|---|---|
| **Triple codificacion** (codigo proveedor, OEM, auxiliar) | Un mismo repuesto tiene codigo del proveedor, codigo original del fabricante (OEM) y a veces un codigo interno. Importante para busqueda y equivalencias, pero se puede arrancar solo con codigo proveedor. |
| **Repuesto Agrupado** (equivalencias) | Permite saber que el filtro de aceite de 3 proveedores es el mismo repuesto. Muy valioso para comparar precios y recomendar al cliente, pero no es bloqueante para operar. |
| **Stock deseado/minimo** | Alertas de reposicion. Util para no quedarse sin stock de productos de alta rotacion. |
| **Pagos multiples (split)** | El cliente paga parte en efectivo, parte con tarjeta. Pasa seguido pero se puede registrar como dos operaciones separadas al inicio. |
| **Informes impositivos** (IVA, percepciones, retenciones) | Importantes para el contador, pero inicialmente pueden exportar datos y resolverlo fuera del sistema. |
| **Edicion masiva de productos** (cambiar rubro, descripcion, etc.) | Ahorra tiempo de mantenimiento del catalogo, pero no es bloqueante. |

---

## PRIORIDAD BAJA - Nice to have, no necesarios inicialmente

| Funcionalidad | Por que puede esperar |
|---|---|
| **Facturacion AFIP directa / FCEM** | Requiere integracion con webservices de AFIP, certificados digitales, homologacion. Es un proyecto en si mismo. Las casas de repuestos suelen tener un facturador externo o facturan desde AFIP web. |
| **Carrito persistente en header** | Mejora de UX para el POS, pero el flujo de facturacion de Baxer ya funciona. Es cosmetico. |
| **Impresion de etiquetas** | Util pero no critico. Muchas casas de repuestos no etiquetan todo. |
| **Comparar precios (doble click en OEM)** | Depende de que exista la triple codificacion y el repuesto agrupado primero. |
| **Horarios populares / Reporte responsables** | Widgets analiticos interesantes pero no operativos. |
| **Rendimientos/Rentabilidad** | Informe avanzado que requiere buena base de datos de costos. Mejor cuando el sistema ya este maduro. |
| **Integraciones MercadoLibre** | Solo relevante si el cliente vende por ML. Se puede evaluar despues. |

---

## NO TRAER - Innecesarios o ya cubiertos

| Funcionalidad | Motivo |
|---|---|
| **Cuentas (modulo premium inactivo)** | Ni siquiera esta activo en Boxer. Baxer ya tiene contabilidad completa. |
| **Programa de Referidos** | Feature de marketing de Boxer como SaaS, no tiene sentido replicarlo. |
| **Config de medios de pago como tab separada** | Baxer puede manejar esto dentro de la configuracion existente o como catalogo. |
| **Etiquetas como tab de configuracion** | Baxer ya tiene categorias de productos que cubren esta necesidad. |

---

## Fases de Implementacion

### Fase 1 - MVP Repuestos (hacer usable el sistema para el rubro)

```
1. Dashboard con KPIs comerciales (widgets)
   - Top 10 deudas clientes
   - Top 10 deudas proveedores
   - Top 10 productos mas vendidos
   - Ventas semanales (grafico comparativo)
   - Medios de pago de ventas
   - Top 10 vencimientos

2. Habilitar y completar Cotizaciones/Presupuestos
   - Activar modulo quotes (ya existe estructura)
   - Formulario similar a ventas pero sin impacto fiscal
   - Conversion de presupuesto a venta

3. Carga masiva de productos por Excel
   - Plantilla descargable
   - Importacion con validacion
   - Reporte de errores

4. Ajuste masivo de precios
   - Por proveedor (% de aumento/descuento)
   - Por categoria/rubro
   - Preview antes de aplicar

5. Descuentos flexibles en ventas
   - Descuento porcentual (%)
   - Descuento fijo ($)
   - Descuento compuesto (% sobre %)
   - Descuentos predefinidos (combobox)
```

### Fase 2 - Operacion Completa (hacer eficiente el sistema)

```
1. Triple codificacion de productos
   - Codigo proveedor (existente)
   - Codigo original (OEM)
   - Codigo auxiliar
   - Busqueda por cualquiera de los tres

2. Repuesto Agrupado (equivalencias)
   - Agrupar articulos equivalentes de distintos proveedores
   - Vista unificada con stock total y mejor precio
   - Busqueda por grupo

3. Stock deseado/minimo con alertas
   - Campo stock minimo por producto
   - Alerta visual en catalogo
   - Informe de productos bajo minimo

4. Pagos multiples (split)
   - Agregar N medios de pago en una venta
   - Distribucion de montos
   - Registro individual por medio

5. Edicion masiva de productos
   - Cambiar categoria/rubro en lote
   - Cambiar descripcion en lote
   - Agregar codigo auxiliar en lote
```

### Fase 3 - Optimizacion (agregar valor sin bloquear operacion)

```
1. Informes impositivos
   - Libro IVA Ventas/Compras
   - Percepciones y retenciones
   - Exportacion para contador

2. Facturacion AFIP (si se decide integrar)
   - Webservices AFIP (WSFE, WSFEX)
   - Certificados digitales
   - FCEM (Factura de Credito Electronica MiPyME)

3. Impresion de etiquetas
   - Generacion de etiquetas con codigo de barras
   - Configuracion de formato/tamano

4. Comparar precios entre proveedores
   - Vista comparativa por codigo OEM
   - Mejor precio automatico
```

---

## Notas

- La Fase 1 es lo que hace que el sistema sea **usable** para una casa de repuestos.
- La Fase 2 es lo que lo hace **eficiente**.
- La Fase 3 son mejoras que agregan valor pero no bloquean la operacion diaria.
- Cada fase deberia tener su propio analisis detallado antes de implementar (usar `/analisis`).
