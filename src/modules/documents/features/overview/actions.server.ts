'use server';

import type { DocumentState } from '@/generated/prisma/enums';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';

// ============================================
// TIPOS
// ============================================

export interface DocumentsOverviewFilters {
  state?: DocumentState;
  documentTypeId?: string;
  isMandatory?: boolean;
  isMonthly?: boolean;
  search?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export type DocumentsSubTab = 'permanent' | 'monthly' | 'general';

// ============================================
// QUERIES - EMPLEADOS (PAGINACIÓN SERVER-SIDE)
// ============================================

/**
 * Obtiene documentos de empleados con paginación server-side para DataTable
 */
export async function getEmployeeDocumentsPaginated(
  searchParams: DataTableSearchParams,
  isMonthly: boolean = false
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Excluir 'subtab' de los filtros
    const { subtab: _subtab, ...cleanFilters } = state.filters;

    // Construir filtro de estado
    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    // Construir filtro de tipo de documento
    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      employee: { companyId, isActive: true },
      documentType: { isMonthly },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        OR: [
          { employee: { firstName: { contains: state.search, mode: 'insensitive' as const } } },
          { employee: { lastName: { contains: state.search, mode: 'insensitive' as const } } },
          {
            employee: { employeeNumber: { contains: state.search, mode: 'insensitive' as const } },
          },
          {
            employee: { documentNumber: { contains: state.search, mode: 'insensitive' as const } },
          },
          { documentType: { name: { contains: state.search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.employeeDocument.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ employee: { lastName: 'asc' } }, { documentType: { name: 'asc' } }],
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              documentNumber: true,
              employeeNumber: true,
            },
          },
          documentType: {
            select: {
              id: true,
              name: true,
              slug: true,
              isMandatory: true,
              hasExpiration: true,
              isMonthly: true,
            },
          },
        },
      }),
      prisma.employeeDocument.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error getting employee documents paginated', { data: { error } });
    throw new Error('Error al obtener documentos de empleados');
  }
}

/**
 * Obtiene tipos de documento de empleados para filtros
 */
export async function getEmployeeDocumentTypesForFilter(isMonthly?: boolean) {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EMPLOYEE',
        isActive: true,
        ...(isMonthly !== undefined && { isMonthly }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting employee document types for filter', { data: { error } });
    return [];
  }
}

/**
 * Obtiene estadísticas generales de documentos de empleados
 */
export async function getEmployeeDocumentsStats(isMonthly?: boolean) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const baseWhere = {
      employee: { companyId, isActive: true },
      ...(isMonthly !== undefined && {
        documentType: { isMonthly },
      }),
    };

    // Para docs permanentes, calcular empleados con docs obligatorios faltantes
    let employeesWithMissingMandatory = 0;
    if (isMonthly === false) {
      // Obtener tipos obligatorios permanentes
      const mandatoryTypes = await prisma.documentType.findMany({
        where: {
          companyId,
          appliesTo: 'EMPLOYEE',
          isMandatory: true,
          isMonthly: false,
          isActive: true,
        },
        select: { id: true },
      });

      if (mandatoryTypes.length > 0) {
        const mandatoryTypeIds = mandatoryTypes.map((t) => t.id);

        // Obtener empleados activos con sus documentos aprobados
        const employees = await prisma.employee.findMany({
          where: { companyId, isActive: true },
          select: {
            id: true,
            documents: {
              where: {
                documentTypeId: { in: mandatoryTypeIds },
                state: 'APPROVED',
              },
              select: { documentTypeId: true },
            },
          },
        });

        // Contar empleados que no tienen todos los docs obligatorios
        for (const emp of employees) {
          const approvedTypeIds = new Set(emp.documents.map((d) => d.documentTypeId));
          if (approvedTypeIds.size < mandatoryTypes.length) {
            employeesWithMissingMandatory++;
          }
        }
      }
    }

    const [total, pending, approved, expired] = await Promise.all([
      prisma.employeeDocument.count({ where: baseWhere }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'PENDING' } }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'APPROVED' } }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'EXPIRED' } }),
    ]);

    return { total, pending, approved, expired, employeesWithMissingMandatory };
  } catch (error) {
    logger.error('Error getting employee documents stats', { data: { error } });
    throw error;
  }
}

// ============================================
// QUERIES - EMPLEADOS MULTIRRECURSO
// ============================================

/**
 * Obtiene documentos multirrecurso de empleados (employeeId = NULL)
 * Estos son documentos que cubren a todos los empleados
 */
export async function getMultiResourceEmployeeDocumentsPaginated(
  searchParams: DataTableSearchParams
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Excluir 'subtab' de los filtros
    const { subtab: _subtab, ...cleanFilters } = state.filters;

    // Construir filtro de estado
    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    // Construir filtro de tipo de documento
    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      employee: null, // Documentos sin empleado específico (multirrecurso)
      documentType: {
        companyId,
        appliesTo: 'EMPLOYEE' as const,
        isMultiResource: true,
      },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        documentType: {
          name: { contains: state.search, mode: 'insensitive' as const },
          companyId,
          appliesTo: 'EMPLOYEE' as const,
          isMultiResource: true,
        },
      }),
    };

    const [data, total] = await Promise.all([
      prisma.employeeDocument.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ documentType: { name: 'asc' } }, { createdAt: 'desc' }],
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              documentNumber: true,
              employeeNumber: true,
            },
          },
          documentType: {
            select: {
              id: true,
              name: true,
              slug: true,
              isMandatory: true,
              hasExpiration: true,
              isMonthly: true,
              isMultiResource: true,
            },
          },
        },
      }),
      prisma.employeeDocument.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error getting multi-resource employee documents paginated', { data: { error } });
    throw new Error('Error al obtener documentos multirrecurso de empleados');
  }
}

/**
 * Obtiene estadísticas de documentos multirrecurso de empleados
 */
export async function getMultiResourceEmployeeDocumentsStats() {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const baseWhere = {
      employee: null,
      documentType: {
        companyId,
        appliesTo: 'EMPLOYEE' as const,
        isMultiResource: true,
      },
    };

    const [total, pending, approved, expired] = await Promise.all([
      prisma.employeeDocument.count({ where: baseWhere }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'PENDING' } }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'APPROVED' } }),
      prisma.employeeDocument.count({ where: { ...baseWhere, state: 'EXPIRED' } }),
    ]);

    return { total, pending, approved, expired, employeesWithMissingMandatory: 0 };
  } catch (error) {
    logger.error('Error getting multi-resource employee documents stats', { data: { error } });
    throw error;
  }
}

/**
 * Obtiene tipos de documento multirrecurso de empleados para filtros
 */
export async function getMultiResourceEmployeeDocumentTypesForFilter() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EMPLOYEE',
        isActive: true,
        isMultiResource: true,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting multi-resource employee document types for filter', { data: { error } });
    return [];
  }
}

// ============================================
// QUERIES - EQUIPOS (PAGINACIÓN SERVER-SIDE)
// ============================================

/**
 * Obtiene documentos de equipos con paginación server-side para DataTable
 */
export async function getEquipmentDocumentsPaginated(
  searchParams: DataTableSearchParams,
  isMonthly: boolean = false
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Excluir 'subtab' de los filtros
    const { subtab: _subtab, ...cleanFilters } = state.filters;

    // Construir filtro de estado
    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    // Construir filtro de tipo de documento
    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      vehicle: { companyId, isActive: true },
      documentType: { isMonthly },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        OR: [
          { vehicle: { domain: { contains: state.search, mode: 'insensitive' as const } } },
          { vehicle: { internNumber: { contains: state.search, mode: 'insensitive' as const } } },
          { documentType: { name: { contains: state.search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.equipmentDocument.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [
          { vehicle: { internNumber: 'asc' } },
          { documentType: { name: 'asc' } },
        ],
        include: {
          vehicle: {
            select: {
              id: true,
              domain: true,
              internNumber: true,
            },
          },
          documentType: {
            select: {
              id: true,
              name: true,
              slug: true,
              isMandatory: true,
              hasExpiration: true,
              isMonthly: true,
            },
          },
        },
      }),
      prisma.equipmentDocument.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error getting equipment documents paginated', { data: { error } });
    throw new Error('Error al obtener documentos de equipos');
  }
}

/**
 * Obtiene tipos de documento de equipos para filtros
 */
export async function getEquipmentDocumentTypesForFilter(isMonthly?: boolean) {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EQUIPMENT',
        isActive: true,
        ...(isMonthly !== undefined && { isMonthly }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting equipment document types for filter', { data: { error } });
    return [];
  }
}

/**
 * Obtiene estadísticas generales de documentos de equipos
 */
export async function getEquipmentDocumentsStats(isMonthly?: boolean) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const baseWhere = {
      vehicle: { companyId, isActive: true },
      ...(isMonthly !== undefined && {
        documentType: { isMonthly },
      }),
    };

    const [total, pending, approved, expired] = await Promise.all([
      prisma.equipmentDocument.count({ where: baseWhere }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'PENDING' } }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'APPROVED' } }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'EXPIRED' } }),
    ]);

    // No aplica para equipos (por ahora)
    return { total, pending, approved, expired, employeesWithMissingMandatory: 0 };
  } catch (error) {
    logger.error('Error getting equipment documents stats', { data: { error } });
    throw error;
  }
}

// ============================================
// QUERIES - EQUIPOS MULTIRRECURSO
// ============================================

/**
 * Obtiene documentos multirrecurso de equipos (vehicleId = NULL)
 * Estos son documentos que cubren a todos los equipos
 */
export async function getMultiResourceEquipmentDocumentsPaginated(
  searchParams: DataTableSearchParams
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Excluir 'subtab' de los filtros
    const { subtab: _subtab, ...cleanFilters } = state.filters;

    // Construir filtro de estado
    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    // Construir filtro de tipo de documento
    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      vehicle: null, // Documentos sin equipo específico (multirrecurso)
      documentType: {
        companyId,
        appliesTo: 'EQUIPMENT' as const,
        isMultiResource: true,
      },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        documentType: {
          name: { contains: state.search, mode: 'insensitive' as const },
          companyId,
          appliesTo: 'EQUIPMENT' as const,
          isMultiResource: true,
        },
      }),
    };

    const [data, total] = await Promise.all([
      prisma.equipmentDocument.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ documentType: { name: 'asc' } }, { createdAt: 'desc' }],
        include: {
          vehicle: {
            select: {
              id: true,
              domain: true,
              internNumber: true,
            },
          },
          documentType: {
            select: {
              id: true,
              name: true,
              slug: true,
              isMandatory: true,
              hasExpiration: true,
              isMonthly: true,
              isMultiResource: true,
            },
          },
        },
      }),
      prisma.equipmentDocument.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error getting multi-resource equipment documents paginated', { data: { error } });
    throw new Error('Error al obtener documentos multirrecurso de equipos');
  }
}

/**
 * Obtiene estadísticas de documentos multirrecurso de equipos
 */
export async function getMultiResourceEquipmentDocumentsStats() {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const baseWhere = {
      vehicle: null,
      documentType: {
        companyId,
        appliesTo: 'EQUIPMENT' as const,
        isMultiResource: true,
      },
    };

    const [total, pending, approved, expired] = await Promise.all([
      prisma.equipmentDocument.count({ where: baseWhere }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'PENDING' } }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'APPROVED' } }),
      prisma.equipmentDocument.count({ where: { ...baseWhere, state: 'EXPIRED' } }),
    ]);

    return { total, pending, approved, expired, employeesWithMissingMandatory: 0 };
  } catch (error) {
    logger.error('Error getting multi-resource equipment documents stats', { data: { error } });
    throw error;
  }
}

/**
 * Obtiene tipos de documento multirrecurso de equipos para filtros
 */
export async function getMultiResourceEquipmentDocumentTypesForFilter() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EQUIPMENT',
        isActive: true,
        isMultiResource: true,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting multi-resource equipment document types for filter', { data: { error } });
    return [];
  }
}

// ============================================
// QUERIES - EMPRESA (PAGINACIÓN SERVER-SIDE)
// ============================================

/**
 * Obtiene documentos de empresa con paginación server-side para DataTable
 */
export async function getCompanyDocumentsPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('company.documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    // Construir filtro de estado
    const stateFilter = state.filters.state?.length
      ? { state: { in: state.filters.state as DocumentState[] } }
      : {};

    // Construir filtro de tipo de documento
    const docTypeFilter = state.filters.documentType?.length
      ? {
          documentTypeId:
            state.filters.documentType.length === 1
              ? state.filters.documentType[0]
              : { in: state.filters.documentType },
        }
      : {};

    const where = {
      companyId,
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        documentType: { name: { contains: state.search, mode: 'insensitive' as const } },
      }),
    };

    const [data, total] = await Promise.all([
      prisma.companyDocument.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ documentType: { name: 'asc' } }, { period: 'desc' }],
        include: {
          documentType: {
            select: {
              id: true,
              name: true,
              slug: true,
              isMandatory: true,
              hasExpiration: true,
              isMonthly: true,
            },
          },
        },
      }),
      prisma.companyDocument.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error getting company documents paginated', { data: { error } });
    throw new Error('Error al obtener documentos de empresa');
  }
}

/**
 * Obtiene tipos de documento de empresa para filtros
 */
export async function getCompanyDocumentTypesForFilter() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'COMPANY',
        isActive: true,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting company document types for filter', { data: { error } });
    return [];
  }
}

/**
 * Obtiene estadísticas de documentos de empresa
 */
export async function getCompanyDocumentsStats() {
  await checkPermission('company.documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const baseWhere = { companyId };

    const [total, pending, approved, expired] = await Promise.all([
      prisma.companyDocument.count({ where: baseWhere }),
      prisma.companyDocument.count({ where: { ...baseWhere, state: 'PENDING' } }),
      prisma.companyDocument.count({ where: { ...baseWhere, state: 'APPROVED' } }),
      prisma.companyDocument.count({ where: { ...baseWhere, state: 'EXPIRED' } }),
    ]);

    // No aplica para empresa
    return { total, pending, approved, expired, employeesWithMissingMandatory: 0 };
  } catch (error) {
    logger.error('Error getting company documents stats', { data: { error } });
    throw error;
  }
}

// ============================================
// DOCUMENT DOWNLOAD
// ============================================

import { getPresignedDownloadUrl } from '@/shared/lib/storage';

/**
 * Obtiene una URL de descarga presignada para un documento de empleado
 * Soporta documentos normales (con employeeId) y multirrecurso (sin employeeId)
 */
export async function getEmployeeDocumentDownloadUrl(documentId: string) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return { success: false as const, error: 'No hay empresa activa' };

  try {
    // Buscar documento por ID, verificando que pertenece a la empresa
    // ya sea a través del empleado o del tipo de documento (multirrecurso)
    const document = await prisma.employeeDocument.findFirst({
      where: {
        id: documentId,
        OR: [
          // Documento normal: empleado pertenece a la empresa
          { employee: { companyId } },
          // Documento multirrecurso: sin empleado, tipo de documento pertenece a la empresa
          {
            employee: null,
            documentType: { companyId },
          },
        ],
      },
      select: { documentKey: true, fileName: true },
    });

    if (!document || !document.documentKey) {
      return { success: false as const, error: 'Documento no encontrado' };
    }

    const url = await getPresignedDownloadUrl(document.documentKey, { expiresIn: 3600 });
    return { success: true as const, url, fileName: document.fileName };
  } catch (error) {
    logger.error('Error getting employee document download URL', { data: { error, documentId } });
    return { success: false as const, error: 'Error al obtener URL de descarga' };
  }
}

/**
 * Obtiene una URL de descarga presignada para un documento de equipo
 * Soporta documentos normales (con vehicleId) y multirrecurso (sin vehicleId)
 */
export async function getEquipmentDocumentDownloadUrl(documentId: string) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return { success: false as const, error: 'No hay empresa activa' };

  try {
    // Buscar documento por ID, verificando que pertenece a la empresa
    // ya sea a través del vehículo o del tipo de documento (multirrecurso)
    const document = await prisma.equipmentDocument.findFirst({
      where: {
        id: documentId,
        OR: [
          // Documento normal: vehículo pertenece a la empresa
          { vehicle: { companyId } },
          // Documento multirrecurso: sin vehículo, tipo de documento pertenece a la empresa
          {
            vehicle: null,
            documentType: { companyId },
          },
        ],
      },
      select: { documentKey: true, fileName: true },
    });

    if (!document || !document.documentKey) {
      return { success: false as const, error: 'Documento no encontrado' };
    }

    const url = await getPresignedDownloadUrl(document.documentKey, { expiresIn: 3600 });
    return { success: true as const, url, fileName: document.fileName };
  } catch (error) {
    logger.error('Error getting equipment document download URL', { data: { error, documentId } });
    return { success: false as const, error: 'Error al obtener URL de descarga' };
  }
}

/**
 * Obtiene una URL de descarga presignada para un documento de empresa
 */
export async function getCompanyDocumentDownloadUrl(documentId: string) {
  await checkPermission('company.documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return { success: false as const, error: 'No hay empresa activa' };

  try {
    const document = await prisma.companyDocument.findFirst({
      where: {
        id: documentId,
        companyId,
      },
      select: { documentKey: true, fileName: true },
    });

    if (!document || !document.documentKey) {
      return { success: false as const, error: 'Documento no encontrado' };
    }

    const url = await getPresignedDownloadUrl(document.documentKey, { expiresIn: 3600 });
    return { success: true as const, url, fileName: document.fileName };
  } catch (error) {
    logger.error('Error getting company document download URL', { data: { error, documentId } });
    return { success: false as const, error: 'Error al obtener URL de descarga' };
  }
}

// ============================================
// UNIVERSAL UPLOAD - SEARCH ACTIONS
// ============================================

/**
 * Busca empleados para el selector de upload universal
 */
export async function searchEmployeesForUpload(query: string, limit = 10) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.employee.findMany({
      where: {
        companyId,
        isActive: true,
        ...(query && {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { employeeNumber: { contains: query, mode: 'insensitive' } },
            { documentNumber: { contains: query, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        documentNumber: true,
        pictureUrl: true,
      },
      take: limit,
      orderBy: { lastName: 'asc' },
    });
  } catch (error) {
    logger.error('Error searching employees for upload', { data: { error, query } });
    return [];
  }
}

/**
 * Busca equipos para el selector de upload universal
 */
export async function searchEquipmentForUpload(query: string, limit = 10) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.vehicle.findMany({
      where: {
        companyId,
        isActive: true,
        ...(query && {
          OR: [
            { domain: { contains: query, mode: 'insensitive' } },
            { internNumber: { contains: query, mode: 'insensitive' } },
            { chassis: { contains: query, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        domain: true,
        internNumber: true,
        pictureUrl: true,
        brand: { select: { name: true } },
        model: { select: { name: true } },
        type: { select: { name: true } },
      },
      take: limit,
      orderBy: [{ domain: 'asc' }, { internNumber: 'asc' }],
    });
  } catch (error) {
    logger.error('Error searching equipment for upload', { data: { error, query } });
    return [];
  }
}

/**
 * Obtiene tipos de documento disponibles para una entidad
 * Incluye información de si ya tiene un documento subido
 */
export async function getDocumentTypesForUpload(
  entityType: 'EMPLOYEE' | 'EQUIPMENT' | 'COMPANY',
  entityId: string
) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener tipos de documento que aplican a esta entidad
    const documentTypes = await prisma.documentType.findMany({
      where: {
        companyId,
        isActive: true,
        appliesTo: entityType,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isMandatory: true,
        hasExpiration: true,
        isMonthly: true,
        isConditional: true,
      },
      orderBy: [{ isMandatory: 'desc' }, { name: 'asc' }],
    });

    // Obtener documentos ya subidos según el tipo de entidad
    let uploadedDocTypeIds: string[] = [];

    if (entityType === 'EMPLOYEE') {
      const docs = await prisma.employeeDocument.findMany({
        where: { employeeId: entityId },
        select: { documentTypeId: true },
      });
      uploadedDocTypeIds = docs.map((d) => d.documentTypeId);
    } else if (entityType === 'EQUIPMENT') {
      const docs = await prisma.equipmentDocument.findMany({
        where: { vehicleId: entityId },
        select: { documentTypeId: true },
      });
      uploadedDocTypeIds = docs.map((d) => d.documentTypeId);
    } else {
      const docs = await prisma.companyDocument.findMany({
        where: { companyId: entityId },
        select: { documentTypeId: true },
      });
      uploadedDocTypeIds = docs.map((d) => d.documentTypeId);
    }

    // Marcar cuáles ya están subidos
    return documentTypes.map((dt) => ({
      ...dt,
      isAlreadyUploaded: uploadedDocTypeIds.includes(dt.id),
    }));
  } catch (error) {
    logger.error('Error getting document types for upload', {
      data: { error, entityType, entityId },
    });
    return [];
  }
}

// ============================================
// MULTI-RESOURCE DOCUMENT TYPES WITH STATUS
// ============================================

/**
 * Obtiene todos los tipos de documento multirrecurso de empleados con su estado
 * Retorna cada tipo y si tiene documento subido o no
 */
export async function getMultiResourceEmployeeDocumentTypesWithStatus() {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // 1. Obtener todos los tipos de documento multirrecurso de empleados
    const types = await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EMPLOYEE',
        isMultiResource: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isMandatory: true,
        hasExpiration: true,
        isMonthly: true,
      },
      orderBy: [{ isMandatory: 'desc' }, { name: 'asc' }],
    });

    // 2. Obtener documentos existentes (employee: null)
    const documents = await prisma.employeeDocument.findMany({
      where: {
        employee: null,
        documentType: {
          companyId,
          appliesTo: 'EMPLOYEE',
          isMultiResource: true,
        },
      },
      select: {
        id: true,
        state: true,
        expirationDate: true,
        period: true,
        documentKey: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        createdAt: true,
        documentTypeId: true,
      },
    });

    // 3. Mapear tipos con su documento si existe
    const documentsByTypeId = new Map(documents.map((d) => [d.documentTypeId, d]));

    return types.map((type) => ({
      documentType: type,
      document: documentsByTypeId.get(type.id) || null,
      status: (documentsByTypeId.has(type.id) ? 'uploaded' : 'pending') as 'uploaded' | 'pending',
    }));
  } catch (error) {
    logger.error('Error getting multi-resource employee document types with status', {
      data: { error },
    });
    throw error;
  }
}

/**
 * Obtiene todos los tipos de documento multirrecurso de equipos con su estado
 * Retorna cada tipo y si tiene documento subido o no
 */
export async function getMultiResourceEquipmentDocumentTypesWithStatus() {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // 1. Obtener todos los tipos de documento multirrecurso de equipos
    const types = await prisma.documentType.findMany({
      where: {
        companyId,
        appliesTo: 'EQUIPMENT',
        isMultiResource: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isMandatory: true,
        hasExpiration: true,
        isMonthly: true,
      },
      orderBy: [{ isMandatory: 'desc' }, { name: 'asc' }],
    });

    // 2. Obtener documentos existentes (vehicle: null)
    const documents = await prisma.equipmentDocument.findMany({
      where: {
        vehicle: null,
        documentType: {
          companyId,
          appliesTo: 'EQUIPMENT',
          isMultiResource: true,
        },
      },
      select: {
        id: true,
        state: true,
        expirationDate: true,
        period: true,
        documentKey: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        createdAt: true,
        documentTypeId: true,
      },
    });

    // 3. Mapear tipos con su documento si existe
    const documentsByTypeId = new Map(documents.map((d) => [d.documentTypeId, d]));

    return types.map((type) => ({
      documentType: type,
      document: documentsByTypeId.get(type.id) || null,
      status: (documentsByTypeId.has(type.id) ? 'uploaded' : 'pending') as 'uploaded' | 'pending',
    }));
  } catch (error) {
    logger.error('Error getting multi-resource equipment document types with status', {
      data: { error },
    });
    throw error;
  }
}

// ============================================
// MULTI-RESOURCE DOCUMENT UPLOAD
// ============================================

import { getActiveCompany } from '@/shared/lib/company';
import { generateUniqueFilename, uploadFile } from '@/shared/lib/storage';

interface UploadMultiResourceDocumentInput {
  appliesTo: 'EMPLOYEE' | 'EQUIPMENT';
  documentTypeId: string;
  expirationDate: Date | null;
  period?: string;
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Sube un documento multirrecurso (sin empleado/equipo específico)
 * El documento quedará con employeeId/vehicleId = NULL
 */
export async function uploadMultiResourceDocument(
  input: UploadMultiResourceDocumentInput
): Promise<{ success: boolean; documentId?: string; error?: string }> {
  await checkPermission('documents', 'create', { redirect: true });
  const company = await getActiveCompany();
  if (!company) {
    return { success: false, error: 'No hay empresa activa' };
  }

  try {
    // 1. Verificar que el tipo de documento existe y es multirrecurso
    const documentType = await prisma.documentType.findFirst({
      where: {
        id: input.documentTypeId,
        companyId: company.id,
        appliesTo: input.appliesTo,
        isMultiResource: true,
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        hasExpiration: true,
        isMonthly: true,
      },
    });

    if (!documentType) {
      return { success: false, error: 'Tipo de documento no válido o no es multirrecurso' };
    }

    // 2. Validar campos requeridos según configuración del tipo
    if (documentType.hasExpiration && !input.expirationDate) {
      return { success: false, error: 'La fecha de vencimiento es requerida' };
    }

    if (documentType.isMonthly && !input.period) {
      return { success: false, error: 'El periodo es requerido para documentos mensuales' };
    }

    // 3. Subir archivo a storage
    const buffer = Buffer.from(await input.file.arrayBuffer());
    const uniqueFilename = generateUniqueFilename(input.fileName);
    // Construir path para documentos multirrecurso: {companySlug}/multirecurso/{entityType}/{docTypeSlug}/
    const folder = `${company.slug}/multirecurso/${input.appliesTo.toLowerCase()}/${documentType.slug}`;

    const uploadResult = await uploadFile(buffer, uniqueFilename, { folder });

    // 4. Crear registro en la base de datos
    let documentId: string;

    if (input.appliesTo === 'EMPLOYEE') {
      // Verificar si ya existe un documento para este tipo (reemplazar)
      const existing = await prisma.employeeDocument.findFirst({
        where: {
          employee: null,
          documentTypeId: input.documentTypeId,
        },
        select: { id: true },
      });

      if (existing) {
        // Actualizar el documento existente
        const updated = await prisma.employeeDocument.update({
          where: { id: existing.id },
          data: {
            documentKey: uploadResult.key,
            fileName: input.fileName,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            expirationDate: input.expirationDate,
            period: input.period,
            state: 'APPROVED',
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        documentId = updated.id;
      } else {
        // Crear nuevo documento
        const created = await prisma.employeeDocument.create({
          data: {
            documentType: { connect: { id: input.documentTypeId } },
            // employeeId = null (no se conecta a ningún empleado)
            documentKey: uploadResult.key,
            fileName: input.fileName,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            expirationDate: input.expirationDate,
            period: input.period,
            state: 'APPROVED',
          },
          select: { id: true },
        });
        documentId = created.id;
      }
    } else {
      // EQUIPMENT
      const existing = await prisma.equipmentDocument.findFirst({
        where: {
          vehicle: null,
          documentTypeId: input.documentTypeId,
        },
        select: { id: true },
      });

      if (existing) {
        // Actualizar el documento existente
        const updated = await prisma.equipmentDocument.update({
          where: { id: existing.id },
          data: {
            documentKey: uploadResult.key,
            fileName: input.fileName,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            expirationDate: input.expirationDate,
            period: input.period,
            state: 'APPROVED',
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        documentId = updated.id;
      } else {
        // Crear nuevo documento
        const created = await prisma.equipmentDocument.create({
          data: {
            documentType: { connect: { id: input.documentTypeId } },
            // vehicleId = null (no se conecta a ningún equipo)
            documentKey: uploadResult.key,
            fileName: input.fileName,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            expirationDate: input.expirationDate,
            period: input.period,
            state: 'APPROVED',
          },
          select: { id: true },
        });
        documentId = created.id;
      }
    }

    logger.info('Multi-resource document uploaded', {
      data: {
        documentId,
        appliesTo: input.appliesTo,
        documentTypeId: input.documentTypeId,
        companyId: company.id,
      },
    });

    return { success: true, documentId };
  } catch (error) {
    logger.error('Error uploading multi-resource document', { data: { error, input } });
    return { success: false, error: 'Error al subir el documento' };
  }
}

// ============================================
// EXPORT - PARA EXCEL
// ============================================

/**
 * Obtiene TODOS los documentos de empleados para exportar a Excel
 * Usa los mismos filtros pero sin paginación
 */
export async function getAllEmployeeDocumentsForExport(
  searchParams: DataTableSearchParams,
  isMonthly: boolean = false
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);

    const { subtab: _subtab, ...cleanFilters } = state.filters;

    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      employee: { companyId, isActive: true },
      documentType: { isMonthly },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        OR: [
          { employee: { firstName: { contains: state.search, mode: 'insensitive' as const } } },
          { employee: { lastName: { contains: state.search, mode: 'insensitive' as const } } },
          {
            employee: { employeeNumber: { contains: state.search, mode: 'insensitive' as const } },
          },
          {
            employee: { documentNumber: { contains: state.search, mode: 'insensitive' as const } },
          },
          { documentType: { name: { contains: state.search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    // SIN skip/take para obtener todos
    return await prisma.employeeDocument.findMany({
      where,
      orderBy: state.sortBy
        ? { [state.sortBy]: state.sortOrder }
        : [{ employee: { lastName: 'asc' } }, { documentType: { name: 'asc' } }],
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            documentNumber: true,
            employeeNumber: true,
          },
        },
        documentType: {
          select: {
            id: true,
            name: true,
            slug: true,
            isMandatory: true,
            hasExpiration: true,
            isMonthly: true,
          },
        },
      },
    });
  } catch (error) {
    logger.error('Error getting employee documents for export', { data: { error } });
    throw new Error('Error al obtener documentos de empleados para exportar');
  }
}

/**
 * Obtiene TODOS los documentos de equipos para exportar a Excel
 * Usa los mismos filtros pero sin paginación
 */
export async function getAllEquipmentDocumentsForExport(
  searchParams: DataTableSearchParams,
  isMonthly: boolean = false
) {
  await checkPermission('documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);

    const { subtab: _subtab, ...cleanFilters } = state.filters;

    const stateFilter = cleanFilters.state?.length
      ? { state: { in: cleanFilters.state as DocumentState[] } }
      : {};

    const docTypeFilter = cleanFilters.documentType?.length
      ? {
          documentTypeId:
            cleanFilters.documentType.length === 1
              ? cleanFilters.documentType[0]
              : { in: cleanFilters.documentType },
        }
      : {};

    const where = {
      vehicle: { companyId, isActive: true },
      documentType: { isMonthly },
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        OR: [
          { vehicle: { domain: { contains: state.search, mode: 'insensitive' as const } } },
          { vehicle: { internNumber: { contains: state.search, mode: 'insensitive' as const } } },
          { documentType: { name: { contains: state.search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    // SIN skip/take para obtener todos
    return await prisma.equipmentDocument.findMany({
      where,
      orderBy: state.sortBy
        ? { [state.sortBy]: state.sortOrder }
        : [{ vehicle: { internNumber: 'asc' } }, { documentType: { name: 'asc' } }],
      include: {
        vehicle: {
          select: {
            id: true,
            domain: true,
            internNumber: true,
          },
        },
        documentType: {
          select: {
            id: true,
            name: true,
            slug: true,
            isMandatory: true,
            hasExpiration: true,
            isMonthly: true,
          },
        },
      },
    });
  } catch (error) {
    logger.error('Error getting equipment documents for export', { data: { error } });
    throw new Error('Error al obtener documentos de equipos para exportar');
  }
}

/**
 * Obtiene TODOS los documentos de empresa para exportar a Excel
 * Usa los mismos filtros pero sin paginación
 */
export async function getAllCompanyDocumentsForExport(searchParams: DataTableSearchParams) {
  await checkPermission('company.documents', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);

    const stateFilter = state.filters.state?.length
      ? { state: { in: state.filters.state as DocumentState[] } }
      : {};

    const docTypeFilter = state.filters.documentType?.length
      ? {
          documentTypeId:
            state.filters.documentType.length === 1
              ? state.filters.documentType[0]
              : { in: state.filters.documentType },
        }
      : {};

    const where = {
      companyId,
      ...stateFilter,
      ...docTypeFilter,
      ...(state.search && {
        documentType: { name: { contains: state.search, mode: 'insensitive' as const } },
      }),
    };

    // SIN skip/take para obtener todos
    return await prisma.companyDocument.findMany({
      where,
      orderBy: state.sortBy
        ? { [state.sortBy]: state.sortOrder }
        : [{ documentType: { name: 'asc' } }, { period: 'desc' }],
      include: {
        documentType: {
          select: {
            id: true,
            name: true,
            slug: true,
            isMandatory: true,
            hasExpiration: true,
            isMonthly: true,
          },
        },
      },
    });
  } catch (error) {
    logger.error('Error getting company documents for export', { data: { error } });
    throw new Error('Error al obtener documentos de empresa para exportar');
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type MultiResourceDocumentTypeWithStatus = Awaited<
  ReturnType<typeof getMultiResourceEmployeeDocumentTypesWithStatus>
>[number];

export type EmployeeDocumentListItem = Awaited<
  ReturnType<typeof getEmployeeDocumentsPaginated>
>['data'][number];

export type EmployeeForUploadSearch = Awaited<ReturnType<typeof searchEmployeesForUpload>>[number];

export type EquipmentForUploadSearch = Awaited<ReturnType<typeof searchEquipmentForUpload>>[number];

export type DocumentTypeForUpload = Awaited<ReturnType<typeof getDocumentTypesForUpload>>[number];

export type EquipmentDocumentListItem = Awaited<
  ReturnType<typeof getEquipmentDocumentsPaginated>
>['data'][number];

export type CompanyDocumentListItem = Awaited<
  ReturnType<typeof getCompanyDocumentsPaginated>
>['data'][number];

export type DocumentsStats = Awaited<ReturnType<typeof getEmployeeDocumentsStats>>;

export type DocumentTypeFilterOption = Awaited<
  ReturnType<typeof getEmployeeDocumentTypesForFilter>
>[number];
