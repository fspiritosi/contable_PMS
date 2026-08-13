'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidatePath } from 'next/cache';
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryFormData,
  type UpdateCategoryFormData,
} from '../../shared/validators';
import type { ProductCategory } from '../../shared/types';

/**
 * Obtiene todas las categorías de ítems
 */
export async function getCategories(): Promise<ProductCategory[]> {
  await checkPermission('commercial.categories', 'view', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const categories = await prisma.productCategory.findMany({
      where: { companyId },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, products: true } },
      },
      orderBy: { name: 'asc' },
    });

    return categories as unknown as ProductCategory[];
  } catch (error) {
    logger.error('Error al obtener categorías', { data: { error } });
    throw new Error('Error al obtener categorías');
  }
}

/**
 * Obtiene una categoría por ID
 */
export async function getCategoryById(id: string): Promise<ProductCategory | null> {
  await checkPermission('commercial.categories', 'view', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const category = await prisma.productCategory.findFirst({
      where: { id, companyId },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
      },
    });

    return category as unknown as ProductCategory | null;
  } catch (error) {
    logger.error('Error al obtener categoría', { data: { error, id } });
    throw new Error('Error al obtener categoría');
  }
}

/**
 * Crea una nueva categoría
 */
export async function createCategory(data: CreateCategoryFormData): Promise<ProductCategory> {
  await checkPermission('commercial.categories', 'create', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = createCategorySchema.parse(data);

    // Validar que el nombre no exista en la misma empresa
    const existing = await prisma.productCategory.findFirst({
      where: {
        companyId,
        name: validatedData.name,
      },
    });

    if (existing) {
      throw new Error('Ya existe una categoría con ese nombre');
    }

    // Si tiene padre, validar que exista
    if (validatedData.parentId) {
      const parent = await prisma.productCategory.findFirst({
        where: {
          id: validatedData.parentId,
          companyId,
        },
      });

      if (!parent) {
        throw new Error('La categoría padre no existe');
      }
    }

    const category = await prisma.productCategory.create({
      data: {
        companyId,
        name: validatedData.name,
        description: validatedData.description,
        parentId: validatedData.parentId,
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });

    logger.info('Categoría creada', {
      data: { categoryId: category.id, name: category.name, companyId },
    });

    revalidatePath('/dashboard/commercial/products');
    revalidatePath('/dashboard/commercial/products/categories');

    return category as unknown as ProductCategory;
  } catch (error) {
    logger.error('Error al crear categoría', { data: { error, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear categoría');
  }
}

/**
 * Actualiza una categoría
 */
export async function updateCategory(
  id: string,
  data: UpdateCategoryFormData
): Promise<ProductCategory> {
  await checkPermission('commercial.categories', 'update', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = updateCategorySchema.parse(data);

    // Verificar que existe
    const existing = await prisma.productCategory.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Categoría no encontrada');
    }

    // Validar que el nombre no esté duplicado (si se está cambiando)
    if (validatedData.name && validatedData.name !== existing.name) {
      const duplicate = await prisma.productCategory.findFirst({
        where: {
          companyId,
          name: validatedData.name,
          id: { not: id },
        },
      });

      if (duplicate) {
        throw new Error('Ya existe una categoría con ese nombre');
      }
    }

    // Validar que no se establezca como su propio padre (ciclo)
    if (validatedData.parentId === id) {
      throw new Error('Una categoría no puede ser su propio padre');
    }

    // Validar que el nuevo padre no sea un hijo de esta categoría (evitar ciclos)
    if (validatedData.parentId) {
      const wouldCreateCycle = await checkCategoryHierarchyCycle(
        id,
        validatedData.parentId,
        companyId
      );
      if (wouldCreateCycle) {
        throw new Error('No se puede crear una jerarquía circular');
      }
    }

    const category = await prisma.productCategory.update({
      where: { id },
      data: {
        name: validatedData.name,
        description: validatedData.description,
        parentId: validatedData.parentId,
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });

    logger.info('Categoría actualizada', {
      data: { categoryId: id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/products');
    revalidatePath('/dashboard/commercial/products/categories');

    return category as unknown as ProductCategory;
  } catch (error) {
    logger.error('Error al actualizar categoría', { data: { error, id, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar categoría');
  }
}

/**
 * Elimina una categoría
 */
export async function deleteCategory(id: string): Promise<void> {
  await checkPermission('commercial.categories', 'delete', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const category = await prisma.productCategory.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: { products: true, children: true },
        },
      },
    });

    if (!category) {
      throw new Error('Categoría no encontrada');
    }

    // Validar que no tenga ítems asociados
    if (category._count.products > 0) {
      throw new Error(
        `No se puede eliminar la categoría porque tiene ${category._count.products} ítem(s) asociado(s)`
      );
    }

    // Validar que no tenga subcategorías
    if (category._count.children > 0) {
      throw new Error(
        `No se puede eliminar la categoría porque tiene ${category._count.children} subcategoría(s)`
      );
    }

    await prisma.productCategory.delete({
      where: { id },
    });

    logger.info('Categoría eliminada', {
      data: { categoryId: id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/products');
    revalidatePath('/dashboard/commercial/products/categories');
  } catch (error) {
    logger.error('Error al eliminar categoría', { data: { error, id } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar categoría');
  }
}

/**
 * Verifica si crear una relación padre-hijo crearía un ciclo
 */
async function checkCategoryHierarchyCycle(
  categoryId: string,
  newParentId: string,
  companyId: string
): Promise<boolean> {
  let currentId: string | null = newParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === categoryId) {
      return true; // Encontramos un ciclo
    }

    if (visited.has(currentId)) {
      // Ya visitamos este nodo, no hay ciclo en esta rama
      return false;
    }

    visited.add(currentId);

    // Buscar el padre del nodo actual
    const parent: { parentId: string | null } | null = await prisma.productCategory.findFirst({
      where: { id: currentId, companyId },
      select: { parentId: true },
    });

    currentId = parent?.parentId || null;
  }

  return false;
}
