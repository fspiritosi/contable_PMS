# Comparacion Funcional: Boxer Gestion vs Baxer-N

## Contexto

**Boxer Gestion**: ERP web orientado a negocios de repuestos y servicios automotrices. Tenant analizado: "Nahuel Servicios".
**Baxer-N**: ERP general multi-industria con foco contable, comercial y RRHH.

---

## 1. DASHBOARD / ESTADISTICAS

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Dashboard principal con KPIs | Deuda clientes, cheques, vencimientos | Existe `/dashboard` | **Ambas** |
| Medios de pago de ventas | Widget con totales por medio | - | **Solo Boxer** |
| Top 10 deudas clientes | Tabla con fecha, nombre, deuda | - | **Solo Boxer** |
| Ventas semanales (grafico) | Comparativo semana anterior vs actual | - | **Solo Boxer** |
| Horarios populares | Grafico distribucion por hora | - | **Solo Boxer** |
| Top 10 vencimientos | Tabs: compras/presupuestos/cheques | - | **Solo Boxer** |
| Ingresos y egresos | Resumen semanal | Cashflow en tesoreria | **Similar** |
| Top 10 productos | Ranking mas vendidos con stock | - | **Solo Boxer** |
| Reporte responsables | Ventas por vendedor | - | **Solo Boxer** |
| Top 10 deudas proveedores | Ranking deudas | - | **Solo Boxer** |
| Clasificacion de compras | Centros de costos / rubros | - | **Solo Boxer** |

---

## 2. VENTAS / PUNTO DE VENTA

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Formulario de venta (POS) | Formulario completo con carrito | Facturas de venta (`invoices`) | **Ambas** (diferente enfoque) |
| Buscador de articulos | Combobox autocompletable | Productos con busqueda | **Ambas** |
| Carrito persistente en header | Icono + monto acumulado | - | **Solo Boxer** |
| Facturacion electronica AFIP | Integracion directa | - | **Solo Boxer** |
| FCEM (Factura Credito Electronica) | Soporte completo con monto minimo | - | **Solo Boxer** |
| Pagos multiples (split) | Si, boton + para agregar medios | - | **Solo Boxer** |
| Descuentos (3 tipos: %, $, compuesto) | Si | - | **Verificar en Baxer** |
| Seleccion de cliente en venta | Buscador por nombre/DNI/Nro | Clientes vinculados a facturas | **Ambas** |
| Puntos de venta | Integrado en formulario | Modulo dedicado (`points-of-sale`) | **Ambas** |
| Remitos de entrega | Modulo separado (`/remito`) | `delivery-notes` | **Ambas** |
| Reportes de ventas | En modulo Informes | `commercial/reports` | **Ambas** |

---

## 3. PRESUPUESTOS / COTIZACIONES

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Presupuestos/Cotizaciones | Formulario similar a ventas | `quotes` (deshabilitado) | **Solo Boxer** (Baxer tiene estructura pero deshabilitada) |

---

## 4. COMPRAS

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Registro de compras | Compra rapida + compra normal | Facturas de compra (`purchases`) | **Ambas** |
| Ordenes de compra | - | `purchase-orders` (CRUD completo) | **Solo Baxer** |
| Remitos de recepcion | - | `receiving-notes` (CRUD completo) | **Solo Baxer** |
| Carga masiva por Excel | Descargar plantilla + subir Excel | - | **Solo Boxer** |
| Percepciones en compras | Seccion expandible | - | **Verificar en Baxer** |
| CAE | Campo en formulario | - | **Solo Boxer** |
| Fechas multiples (facturacion, vto, imputacion) | Si | - | **Verificar en Baxer** |
| Reportes de compras | En modulo Informes | Parte de `reports` | **Ambas** |
| Gastos | - | `expenses` (modulo dedicado) | **Solo Baxer** |

---

## 5. CLIENTES / CRM

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Listado de clientes | Tabla con busqueda y filtros | `clients` (list + detail) | **Ambas** |
| Alta de clientes | Formulario completo | Solo list/detail (sin create/edit directo) | **Parcial Baxer** |
| Descargar deudas totales | Exportacion | - | **Solo Boxer** |
| Descargar agenda | Exportacion contactos | - | **Solo Boxer** |
| Saldo pendiente (historico, 30d, 7d) | Widgets laterales | `account-balances` | **Similar** |
| Contactos | Integrado en clientes | Modulo separado (`contacts`) | **Ambas** |
| Leads/Prospectos | - | `leads` (modulo dedicado) | **Solo Baxer** |

---

## 6. PROVEEDORES

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Listado de proveedores | Tabla con IVA%, recargo%, deuda | `suppliers` (CRUD completo) | **Ambas** |
| Pedidos a proveedores | Tab dedicada | `purchase-orders` | **Ambas** (diferente estructura) |
| Ajuste de precios | Tab "Ajuste de precios" masivo/manual | - | **Solo Boxer** |
| Listas manuales | Tab "Listas manuales" | `price-lists` (modulo dedicado) | **Ambas** |
| Articulos por proveedor | Tab "Articulos" | Relacion en productos | **Ambas** |
| Deuda total (mes, semana, historica) | Widgets de resumen | `account-balances` | **Similar** |

---

## 7. ARTICULOS / CATALOGO / PRODUCTOS

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Catalogo de articulos (+10k) | Modulo robusto con 20+ columnas | `products` (CRUD completo) | **Ambas** |
| Triple codificacion (proveedor, OEM, auxiliar) | Si | - | **Solo Boxer** |
| Multiples listas de precios | Si, por articulo | `price-lists` (modulo dedicado) | **Ambas** |
| Precios con/sin IVA | Paralelo (costo, lista, venta) | - | **Verificar en Baxer** |
| Comparar precios (doble click) | Si | - | **Solo Boxer** |
| Carga masiva stock (Excel) | Si | - | **Solo Boxer** |
| Impresion etiquetas | Si | - | **Solo Boxer** |
| Stock deseado (minimo) | Si | - | **Solo Boxer** |
| Edicion masiva (rubro, subrubro, etc.) | Si, barra secundaria | - | **Solo Boxer** |
| Categorias de productos | Rubros/subrubros | `categories` (modulo dedicado) | **Ambas** |
| Almacenes/Depositos | - | `warehouses` (CRUD completo) | **Solo Baxer** |
| Stock por almacen | - | `stock` (modulo dedicado) | **Solo Baxer** |
| Movimientos de inventario | - | `movements` (modulo dedicado) | **Solo Baxer** |

---

## 8. TESORERIA / FINANZAS

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Cheques | En informes | `checks` (modulo dedicado) | **Ambas** (Baxer mas completo) |
| Cajas de dinero | - | `cash-registers` | **Solo Baxer** |
| Cuentas bancarias | - | `bank-accounts` (CRUD + detail) | **Solo Baxer** |
| Movimientos bancarios | - | `bank-movements` | **Solo Baxer** |
| Recibos de cobro | - | `receipts` | **Solo Baxer** |
| Ordenes de pago | - | `payment-orders` | **Solo Baxer** |
| Flujo de caja | Ingresos/egresos semanal | `cashflow` (modulo dedicado) | **Ambas** (Baxer mas completo) |
| Proyecciones de flujo | - | `cashflow-projections` | **Solo Baxer** |
| Sesiones de tesoreria | - | `sessions` | **Solo Baxer** |
| Saldos pendientes | - | `account-balances` | **Solo Baxer** |

---

## 9. INFORMES

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Informes comerciales | Si | `commercial/reports` | **Ambas** |
| Ventas por marca | Si | - | **Solo Boxer** |
| Informe stock | Si | Stock en almacenes | **Similar** |
| Informes impositivos | IVA, percepciones, retenciones | - | **Solo Boxer** |
| Informes parciales | Si | - | **Solo Boxer** |
| Pago de compras | Si | `payment-orders` | **Similar** |
| Rendimientos/Rentabilidad | Si | - | **Solo Boxer** |
| Repuesto agrupado | Si | - | **Solo Boxer** |
| Auditorias de pedidos | Si | Auditoria general (`audit`) | **Similar** |
| Informes contables | - | `accounting/reports` | **Solo Baxer** |
| Presupuestos contables | - | `accounting/budgets` | **Solo Baxer** |

---

## 10. CONFIGURACION

| Funcionalidad | Boxer Gestion | Baxer-N | Estado |
|---|---|---|---|
| Config general (27+ opciones) | 10 pestanas | Distribuida en modulos | **Ambas** (diferente estructura) |
| Usuarios y permisos | Tab "Usuarios" | `users` + `roles` (RBAC completo) | **Ambas** (Baxer mas robusto) |
| Medios de pago | Tab dedicada | - | **Solo Boxer** |
| Etiquetas de articulos | Tab dedicada | - | **Solo Boxer** |
| Impuestos/IVA | Tab dedicada | Config contable | **Similar** |
| Centros de costos | Tab dedicada | `cost-centers` (modulo dedicado) | **Ambas** |
| Configuracion contable | - | `accounting/settings` | **Solo Baxer** |

---

## 11. MODULOS EXCLUSIVOS DE BAXER-N

| Modulo | Descripcion |
|---|---|
| **Empleados** | CRUD completo con documentos asociados |
| **Equipamiento** | Gestion de activos fijos con depreciacion |
| **Documentos** | Sistema de gestion documental (empresa, empleados, equipos) |
| **Contabilidad completa** | Plan de cuentas, asientos, cierre fiscal, saldos de apertura, asientos recurrentes |
| **Empresas (multi-empresa)** | Gestion de multiples empresas con selector |
| **Roles y permisos (RBAC)** | Sistema granular de permisos |
| **Auditoria** | Registro de acciones de usuarios |
| **Catalogos de empresa** | Sectores, sindicatos, convenios, puestos, tipos de contrato, etc. |
| **Ayuda integrada** | Guia de usuario dentro de la app |

---

## 12. MODULOS EXCLUSIVOS DE BOXER GESTION

| Modulo | Descripcion |
|---|---|
| **Repuesto Agrupado** | Unificacion de articulos equivalentes de distintos proveedores |
| **Integraciones** | MercadoLibre, facturacion electronica (inactivo) |
| **Cuentas** | Modulo premium (inactivo) |
| **Facturacion AFIP directa** | Emision de comprobantes fiscales electronicos |
| **FCEM** | Factura de Credito Electronica MiPyME |
| **Carrito persistente** | Carrito en header con monto acumulado |
| **Programa de Referidos** | "Ser Embajador!" |
| **Dashboard con 12+ widgets** | KPIs, tops, graficos comparativos |

---

## Resumen Ejecutivo

| Categoria | Boxer Gestion | Baxer-N |
|---|---|---|
| **Enfoque** | ERP automotriz/repuestos con foco fiscal argentino | ERP general multi-industria con foco contable y RRHH |
| **Fortaleza** | Punto de venta, facturacion AFIP, gestion de repuestos | Contabilidad, tesoreria, gestion de RRHH, permisos |
| **Multi-empresa** | Multi-sucursal (tenant) | Multi-empresa con selector |
| **Fiscal** | AFIP integrado (FCEM, CAE, percepciones) | Sin integracion fiscal directa |
| **Inventario** | Robusto (+10k items, triple codigo, carga masiva) | Estructurado (almacenes, stock, movimientos) |
| **Tesoreria** | Basica (solo widgets) | Completa (cajas, bancos, cheques, cobros, pagos, proyecciones) |
| **Contabilidad** | No tiene | Completa (plan de cuentas, asientos, cierre, presupuestos) |
| **RRHH** | No tiene | Empleados, documentos, equipamiento |
| **Permisos** | Basicos | RBAC granular con roles |
