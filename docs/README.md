# Documentacion Interna - Guia del Desarrollador

Documentacion tecnica del proyecto para desarrolladores. Cubre arquitectura, modulos de negocio, infraestructura y convenciones.

---

## Arquitectura

- [Overview del Sistema](architecture/overview.md) - Tech stack, capas, flujo de datos, multi-tenancy
- [Estructura del Proyecto](architecture/project-structure.md) - Carpetas, convenciones de nombres, estructura de modulos
- [Modelo de Datos](architecture/data-model.md) - Modelos Prisma, relaciones, enums
- [Autenticacion y Permisos](architecture/auth-and-permissions.md) - Clerk, RBAC, roles, guardas

## Infraestructura

- [Setup de Desarrollo](infrastructure/setup.md) - Docker, variables de entorno, Prisma, scripts
- [Almacenamiento](infrastructure/storage.md) - MinIO/R2, presigned URLs, paths de documentos
- [Deploy y Multi-instancia](infrastructure/deployment.md) - Build, instance.config.ts, deploy

## Modulos de Negocio

- [Dashboard](modules/dashboard.md) - KPIs, graficos, filtro de periodo
- [Empleados](modules/employees.md) - CRUD, estados, documentos
- [Equipamiento](modules/equipment.md) - Vehiculos/equipos, documentos, QR publico
- [Documentos](modules/documents.md) - Tipos, estados, flujo de revision
- [Comercial](modules/commercial.md) - CRM, productos, ventas, compras, tesoreria, almacenes, gastos
- [Ordenes de Compra](modules/purchase-orders.md) - OC a proveedores, flujo de aprobacion, recepcion, cashflow
- [Remitos de Recepcion](modules/receiving-notes.md) - Recepcion de materiales, integracion con stock, OC y FC
- [Tesorería - Cheques](modules/treasury-checks.md) - Cartera de cheques propios y terceros, ciclo de vida
- [Tesorería - Inversiones](modules/treasury-investments.md) - Brokers, tenencias, compra/venta de inversiones y valuación al cierre (TSK-793)
- [Tesorería - Flujo de Caja](modules/treasury-cashflow.md) - Dashboard cashflow, proyecciones manuales
- [Contabilidad](modules/accounting.md) - Plan de cuentas, asientos, integracion, reportes
- [Empresa](modules/company.md) - Catalogos, usuarios, roles, auditoria

## Convenciones

- [Estandares de Codigo](conventions/coding-standards.md) - TypeScript, componentes, server actions, logger
- [Patrones de UI](conventions/ui-patterns.md) - shadcn/ui, DataTable, formularios, modales
- [Testing](conventions/testing.md) - Cypress E2E, estructura, patrones, ejecucion

## Guias Practicas

- [Crear un Modulo Nuevo](guides/new-module.md) - Paso a paso desde cero
- [Agregar una Feature](guides/new-feature.md) - Agregar funcionalidad a modulo existente

---

## Documentacion Adicional

- [README.md](../README.md) - Setup rapido del proyecto
- [INSTANCE-SETUP.md](../INSTANCE-SETUP.md) - Configuracion multi-instancia
- [CLAUDE.md](../CLAUDE.md) - Guia para asistente AI
- [DataTable DOCS](../src/shared/components/common/DataTable/DOCS.md) - Guia de uso del componente DataTable
