# Análisis Funcional Completo: Boxer Gestión - Nahuel Servicios

## Descripción General

**Boxer Gestión** es un sistema ERP web (SPA en React) orientado a negocios de repuestos y servicios automotrices. El tenant analizado es **"Nahuel Servicios"**, operado por el usuario **Fabricio Spiritosi**. El sistema es multi-sucursal, modular y con integración fiscal argentina (AFIP/FCEM).

**URL**: `https://nahuel.boxergestion.com/`

---

## 1. ESTADÍSTICAS (`/estadisticas`) - Dashboard Principal

Panel de control con resumen del negocio, filtrable por período ("Esta semana" por defecto).

### Indicadores principales (KPIs)

| Indicador | Valor actual |
|-----------|-------------|
| Deuda de Clientes | $20.954.903,33 |
| Cheques a Cobrar | $0 |
| Deudas Vencidas | $0 |
| Deudas a Vencer | $366.575,82 |

### Widgets del dashboard

- **Medios de pago de Ventas**: Tabla con totales por medio (Efectivo, Tarjeta Débito/Crédito, Mercado Pago, Cuenta Corriente, Cheque, Transferencia Bancaria, QR, DEBIN, MODO, Link de Pago, Retenciones)
- **Top 10 deudas clientes**: Tabla con fecha, nombre y deuda, con selector "Por antigüedad"
- **Ventas semanales**: Gráfico comparativo semana anterior vs actual, con toggle Montos/Cantidades
- **Horarios populares**: Gráfico de distribución de ventas por hora del día
- **Top 10 vencimientos**: 3 tabs (COMPRAS / PRESUPUESTOS / CHEQUES), muestra nro. compra, proveedor y fecha vto.
- **Ingresos y Egresos**: Resumen semanal con totales
- **Top 10 productos**: Ranking de artículos más vendidos con stock
- **Reporte responsables**: Ventas por vendedor y medio de pago, con toggle Montos/Cantidades
- **Top 10 deudas proveedores**: Ranking de deudas por proveedor (total: -$127.093.369,76)
- **Clasificación de Compras**: 2 tabs (CENTROS DE COSTOS / RUBROS) con porcentajes

---

## 2. VENTAS (`/ventas`) - Punto de Venta

Formulario completo de registro de ventas, dividido en 4 secciones:

### Sección Artículos (panel superior)

- **Buscador de artículos**: Combobox autocompletable ("Buscar o agregar nueva descripción")
- **Toggle Descripción**: Alterna entre búsqueda en catálogo y descripción libre
- **Cantidad**: Campo numérico (default: 1)
- **Precio**: Campo monetario con prefijo $
- **Botón REGISTRAR**: Agrega artículo a la tabla

### Tabla de artículos cargados

Columnas: Imagen, Descripción, Unidad, Precio U., IVA, IVA Monto, Subtotal, Rubro, Subrubro, L. de Precios, Eliminar

### Sección CLIENTE (panel inferior izquierdo)

- **Buscador de cliente**: Por nombre, DNI o Nro de cliente (default: "Consumidor Final")
- **Botón +**: Crear nuevo cliente inline
- **Selector Provincia**
- **Info del cliente seleccionado**: CUIT/DNI, Nombre, Deuda máxima, Saldo

### Sección FACTURACIÓN (panel inferior central)

- **Comprobante**: Selector del tipo de comprobante fiscal
- **Medio de pago**: Combobox autocompletable
- **Botón +**: Pagos múltiples (split de pago entre medios)
- **Descuento**: 3 modalidades (%, $, porcentaje compuesto) + combobox de descuentos predefinidos
- **Info FCEM**: Monto mínimo Factura de Crédito Electrónica ($3.958.316,00)

### Sección IMPORTES (panel inferior derecho)

- Importe (subtotal)
- **TOTAL** (monto final)
- Botones: **LIMPIAR** (rojo) / **REGISTRAR** (verde)

### Funcionalidades destacadas

- Carrito persistente en header (icono + monto acumulado)
- Integración con facturación electrónica AFIP
- Soporte FCEM (Factura de Crédito Electrónica MiPyME)
- Pagos múltiples en una misma venta
- Descuentos flexibles (3 tipos)

---

## 3. PRESUPUESTOS (`/presupuesto`)

Estructura casi idéntica a Ventas con estas diferencias:

| Característica | Ventas | Presupuestos |
|---|---|---|
| Tipo de comprobante | Factura/Remito/etc | Comprobante interno |
| Acción final | REGISTRAR | GUARDAR |
| Columna IVA en tabla | Sí | Sí |
| Carácter fiscal | Sí (AFIP) | No (documento interno) |
| Medio de pago default | - | Efectivo |

---

## 4. REMITOS (`/remito`)

Versión simplificada para documentar entregas físicas sin impacto económico directo:

| Característica | Ventas | Remitos |
|---|---|---|
| Campo Precio | Sí | No |
| Columna IVA | Sí | No |
| Sección Facturación | Sí | No |
| Sección Descuentos | Sí | No |
| Sección Importes | Sí | No |
| Campo Provincia | Opcional | Obligatorio (para transporte) |
| Acción final | REGISTRAR | ACEPTAR |

El remito se enfoca en la trazabilidad de la entrega: qué artículos, a quién, en qué provincia.

---

## 5. CUENTAS (`/cuentas`)

**Estado: MÓDULO NO ACTIVO** para este tenant. Al acceder, muestra "Módulo no activo, contacte a soporte" y redirige al dashboard. Es un módulo premium que requiere activación.

---

## 6. COMPRAS (`/compras/rapida`)

Módulo de registro de compras a proveedores con 2 modos:

### Tabs

- **COMPRA RÁPIDA** (default): Formulario simplificado
- **COMPRA NORMAL**: Flujo completo

### Formulario "Registrar Compra" (panel izquierdo)

- **Proveedor**: Autocomplete por Razón Social o CUIT + botón crear nuevo
- **Provincia**: Selector (default: Neuquén)
- **Punto de venta**: Campo texto
- **N° de comprobante**: Campo texto obligatorio
- **Fecha facturación**: Datepicker (default: hoy)
- **Fecha vencimiento**: Datepicker (default: +1 mes)
- **Fecha imputación**: Datepicker (default: hoy)
- **Tipo de comprobante**: Selector (default: "Factura A")
- **Descuento %**: Campo numérico
- **Percepciones**: Sección expandible
- **CAE**: Campo para el código de autorización electrónico
- **Responsable**: Autocomplete (default: usuario logueado)
- **Observación**: Textarea (150 chars max)
- **Checkboxes**: "Pago en plazos" / "Registrar y pagar"

### Tabla de artículos (panel derecho)

- Buscador de artículos (versión "V4")
- Selector "Ordenar por" (Automático)
- **DESCARGAR PLANTILLA**: Template Excel para carga masiva
- **SUBIR EXCEL**: Importación masiva de artículos
- Columnas: Artículo, Descripción, Cantidad, Acciones

### Panel de totales

- SUBTOTAL (editable)
- DESCUENTO (calculado)
- IVA desglosado: 21% (base + monto) / 10.5% (base + monto)
- PERCEPCIONES
- **TOTAL**
- Botones: **CANCELAR** / **FINALIZAR COMPRA**

---

## 7. CLIENTES (`/clientes/ver-clientes`)

### Herramientas

- **FILTROS**: Panel colapsable de filtrado avanzado
- **Buscador**: Por CUIT, Razón Social o Nro de cliente
- **DESCARGAR DEUDAS TOTALES**: Exportación de deudas
- **DESCARGAR AGENDA**: Exportación de datos de contacto
- **NUEVO CLIENTE**: Alta de cliente

### Tabla de clientes

Columnas: Nro., Última compra, Último pago, Cliente, Estado, CUIT/DNI, Saldo, Acciones

### Widgets de resumen (panel lateral)

- **Saldo Pendiente Histórico**
- **Saldo Pendiente Últimos 30 Días**
- **Saldo Pendiente Últimos 7 Días**
- **Detalles cliente**: Panel expandible al seleccionar un cliente

---

## 8. PROVEEDORES (`/proveedores/ver-proveedores`)

### Tabs del módulo (5 pestañas)

1. **PROVEEDORES**: Listado y ABM
2. **PEDIDOS**: Gestión de pedidos a proveedores
3. **AJUSTE DE PRECIOS**: Ajuste masivo/manual por proveedor
4. **LISTAS MANUALES**: Gestión de listas de precios manuales
5. **ARTÍCULOS**: Artículos por proveedor

### Tabla de proveedores

Columnas: Nro., Lista de Precios, Proveedor, CUIT/DNI, Porcentajes (IVA%, Recargo Lista%, Recargo Contado%), Deuda, Teléfono, Estado Tributario, Acciones

### Herramientas

- Buscador por CUIT o Razón Social
- **DESCARGAR DEUDAS TOTALES**
- **NUEVO PROVEEDOR**

### Widgets de resumen financiero

| Indicador | Valor |
|-----------|-------|
| Deuda Total Mes | -$63.986.463,26 |
| Deuda Total Semana | -$366.575,82 |
| Deuda Total Histórica | -$127.093.369,76 |

---

## 9. ARTÍCULOS / CATÁLOGO (`/catalogos`)

Módulo más robusto del sistema con +10.000 artículos.

### Barra de búsqueda y filtros

- Buscador por código o descripción (versión "V4")
- Ordenar por (Automático)
- Filtro "Mostrar": Todos / otros
- Orden secundario
- **FILTROS AVANZADOS**

### Acciones masivas (barra superior)

- **STOCK DESEADO**: Gestión de stock mínimo
- **DESCARGAR ARTÍCULOS**: Exportación
- **IMPRIMIR**: Impresión del catálogo
- **CARGA MASIVA STOCK**: Importación en lote
- **IMPRESIÓN ETIQUETAS**: Generación de etiquetas
- **NUEVO ARTÍCULO**: Alta individual

### Edición masiva (barra secundaria)

- Cambiar Descripción de artículos
- Agregar Código Auxiliar
- Cambiar Rubro
- Cambiar Subrubro
- Agrupar (selección múltiple)

### Tabla de artículos (20+ columnas)

Checkbox, Repuesto Agrupado, Imagen, Artículo, Original, Auxiliar, Descripción, Marca, Rubro, Subrubro, Observaciones, L. de Precios, P. Costo (sin/con IVA), P. Lista (sin/con IVA), P. Venta (con/sin IVA), Stock, Stock Deseado, Proveedor, Ubicación, Fecha Última Actualización, Opciones (editar/duplicar/eliminar)

### Funcionalidades destacadas

- **Triple codificación**: Código proveedor, original (OEM) y auxiliar
- **Múltiples listas de precios** por artículo
- **Precios con/sin IVA** en paralelo (costo, lista, venta)
- **Comparar precios** con doble click en código original
- Paginación de +10.000 artículos (20 por página)
- Carga masiva vía Excel

---

## 10. INTEGRACIONES (`/mis-integraciones`)

**Estado: MÓDULO NO ACTIVO** para este tenant. Requiere activación por soporte. Probablemente incluya integraciones con MercadoLibre, facturación electrónica, etc.

---

## 11. INFORMES (`/informes`)

Panel de administración con 15 tipos de informes:

| Informe | Función estimada |
|---------|-----------------|
| Informes Comerciales | Ventas por período/cliente |
| Movimientos Billetera | Flujo de efectivo y cuentas |
| Ventas por Marca | Análisis de ventas por marca |
| Mis Compras | Historial de compras |
| Informe Ventas | Reportes de ventas detallados |
| Informe Stock | Estado del inventario |
| Informes Impositivos | IVA, percepciones, retenciones |
| Cheques | Gestión de cheques |
| Informes Parciales | Reportes segmentados |
| Mis Pedidos | Estado de pedidos |
| Pago de Compras | Pagos a proveedores |
| Retenciones | Retenciones fiscales |
| Auditorías de Pedidos | Trazabilidad de pedidos |
| Rendimientos | Análisis de rentabilidad |
| Repuesto Agrupado | Informe de equivalencias |

---

## 12. CONFIGURACIÓN (`/config/general`)

Sistema de configuración extenso con **10 pestañas**:

1. **GENERAL** (27+ opciones expandibles en 3 columnas)
2. **USUARIOS**: Gestión de usuarios y permisos
3. **TARJETAS**: Configuración de tarjetas de crédito/débito
4. **FILTROS**: Filtros personalizados
5. **UBICACIONES**: Ubicaciones de almacén/depósito
6. **MEDIOS DE PAGO**: ABM de medios de pago
7. **ETIQUETAS**: Configuración de etiquetas de artículos
8. **IMPUESTOS**: Configuración fiscal (IVA, percepciones)
9. **CONTABLE**: Configuración contable
10. **CENTROS DE COSTOS**: ABM de centros de costo

### Opciones destacadas en pestaña GENERAL

- Precios (configuración de márgenes y listas)
- Reservar stock
- Versión para imprimir
- Descuentos por plazo
- Percepciones
- Configuración cuenta corriente cliente
- Facturador automático Mercado Libre
- Tipos de cliente
- Información FCEM
- Organizar pantalla ventas
- Provincia de la sucursal
- Whatsapp modo de envío
- Plazos pago de compra
- Logo de sucursal
- Validación de precios

---

## 13. REPUESTO AGRUPADO (`/piezas`)

Módulo para unificar artículos equivalentes/intercambiables de distintos proveedores bajo un único código.

### Funcionalidades

- **CREAR REPUESTO AGRUPADO**: Alta de nuevo grupo
- **Buscador**: Por descripción, código proveedor, original o auxiliar
- Tabla: ID, Código Proveedor, Código Original, Código Auxiliar, Descripción, Proveedores, Precio Costo, Precio Venta, Stock Total, Acciones (editar/eliminar)

**Propósito**: Si un mismo filtro de aceite lo venden 3 proveedores con códigos distintos, se agrupan bajo un único repuesto agrupado para simplificar la gestión.

---

## 14. ELEMENTOS TRANSVERSALES

### Barra superior (header)

- **Logo Boxer** (link al home)
- **Carrito**: Ícono + contador de items + monto acumulado
- **Nombre del tenant**: "Nahuel Servicios"
- **Programa de Referidos**: Botón "¡Ser Embajador!"
- **Usuario**: Avatar + nombre "Fabricio Spiritosi" (menú desplegable)

### Sidebar (menú lateral)

13 módulos accesibles, con íconos Material Icons. Incluye link externo a formulario de **Sugerencias** (Google Forms).

### Gestión de sesiones

- Control de sesión única por usuario
- Diálogo "Sesión abierta" con opción de continuar
- Detección de nueva versión con botón de recarga

---

## Resumen de Cobertura Funcional

| Área | Estado | Complejidad |
|------|--------|-------------|
| Punto de Venta | Activo | Alta |
| Presupuestos | Activo | Media |
| Remitos | Activo | Baja |
| Compras | Activo | Alta |
| Catálogo/Stock | Activo | Muy Alta |
| Clientes (CRM) | Activo | Media |
| Proveedores | Activo | Alta |
| Informes | Activo | Alta (15 tipos) |
| Configuración | Activo | Muy Alta (10 tabs, 27+ opciones) |
| Repuesto Agrupado | Activo | Media |
| Dashboard | Activo | Alta (12+ widgets) |
| Cuentas | **Inactivo** | - |
| Integraciones | **Inactivo** | - |

La aplicación es un ERP completo para el rubro automotriz con fuerte integración fiscal argentina (AFIP, FCEM, percepciones, retenciones), gestión multi-proveedor con triple codificación, y herramientas de análisis comercial.
