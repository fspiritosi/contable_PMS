'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryFormData,
  type UpdateCategoryFormData,
} from '../shared/validators';
import type { ProductCategory } from '../shared/types';

// ============================================
// Categories CRUD
// ============================================

export async function getCategories(): Promise<ProductCategory[]> {
  await checkPermission('commercial.categories', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const categories = await prisma.productCategory.findMany({
      where: { companyId },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            products: true,
            children: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    return categories as ProductCategory[];
  } catch (error) {
    logger.error('Error al obtener categorías', { data: { error } });
    throw new Error('Error al obtener categorías');
  }
}

export async function getCategoryById(id: string): Promise<ProductCategory> {
  await checkPermission('commercial.categories', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const category = await prisma.productCategory.findFirst({
      where: { id, companyId },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        children: {
          select: {
            id: true,
            name: true,
            description: true,
            _count: {
              select: {
                products: true,
              },
            },
          },
        },
        _count: {
          select: {
            products: true,
            children: true,
          },
        },
      },
    });

    if (!category) {
      throw new Error('Categoría no encontrada');
    }

    return category as ProductCategory;
  } catch (error) {
    logger.error('Error al obtener categoría', { data: { error } });
    throw error instanceof Error ? error : new Error('Error al obtener categoría');
  }
}

export async function createCategory(data: CreateCategoryFormData): Promise<ProductCategory> {
  await checkPermission('commercial.categories', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = createCategorySchema.parse(data);

  try {
    // Verificar que la categoría padre existe si se proporciona
    if (validatedData.parentId) {
      const parent = await prisma.productCategory.findFirst({
        where: { id: validatedData.parentId, companyId },
      });

      if (!parent) {
        throw new Error('Categoría padre no encontrada');
      }
    }

    const category = await prisma.productCategory.create({
      data: {
        companyId,
        name: validatedData.name,
        description: validatedData.description || null,
        parentId: validatedData.parentId || null,
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            products: true,
            children: true,
          },
        },
      },
    });

    revalidatePath('/dashboard/commercial/categories');
    logger.info('Categoría creada', { data: { categoryId: category.id } });

    return category as ProductCategory;
  } catch (error) {
    logger.error('Error al crear categoría', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear categoría');
  }
}

export async function updateCategory(
  id: string,
  data: UpdateCategoryFormData
): Promise<ProductCategory> {
  await checkPermission('commercial.categories', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = updateCategorySchema.parse(data);

  try {
    // Verificar que la categoría existe
    const existing = await prisma.productCategory.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Categoría no encontrada');
    }

    // Prevenir ciclos: no se puede asignar como padre a sí misma o a sus descendientes
    if (validatedData.parentId) {
      if (validatedData.parentId === id) {
        throw new Error('Una categoría no puede ser su propia categoría padre');
      }

      // Verificar que el padre existe
      const parent = await prisma.productCategory.findFirst({
        where: { id: validatedData.parentId, companyId },
      });

      if (!parent) {
        throw new Error('Categoría padre no encontrada');
      }

      // Verificar que no se crea un ciclo (el padre no debe ser un descendiente)
      const descendants = await getDescendantIds(id);
      if (descendants.includes(validatedData.parentId)) {
        throw new Error('No se puede crear una jerarquía circular');
      }
    }

    const category = await prisma.productCategory.update({
      where: { id },
      data: {
        name: validatedData.name,
        description: validatedData.description !== undefined ? validatedData.description || null : undefined,
        parentId: validatedData.parentId !== undefined ? validatedData.parentId || null : undefined,
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            products: true,
            children: true,
          },
        },
      },
    });

    revalidatePath('/dashboard/commercial/categories');
    revalidatePath(`/dashboard/commercial/categories/${id}`);
    logger.info('Categoría actualizada', { data: { categoryId: id } });

    return category as ProductCategory;
  } catch (error) {
    logger.error('Error al actualizar categoría', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar categoría');
  }
}

export async function deleteCategory(id: string): Promise<void> {
  await checkPermission('commercial.categories', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const category = await prisma.productCategory.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: {
            products: true,
            children: true,
          },
        },
      },
    });

    if (!category) {
      throw new Error('Categoría no encontrada');
    }

    if (category._count.products > 0) {
      throw new Error(
        `No se puede eliminar la categoría porque tiene ${category._count.products} producto(s) asignado(s)`
      );
    }

    if (category._count.children > 0) {
      throw new Error(
        `No se puede eliminar la categoría porque tiene ${category._count.children} subcategoría(s)`
      );
    }

    await prisma.productCategory.delete({
      where: { id },
    });

    revalidatePath('/dashboard/commercial/categories');
    logger.info('Categoría eliminada', { data: { categoryId: id } });
  } catch (error) {
    logger.error('Error al eliminar categoría', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar categoría');
  }
}

// ============================================
// Helpers
// ============================================

async function getDescendantIds(categoryId: string): Promise<string[]> {
  const descendants: string[] = [];

  async function collectDescendants(id: string) {
    const children = await prisma.productCategory.findMany({
      where: { parentId: id },
      select: { id: true },
    });

    for (const child of children) {
      descendants.push(child.id);
      await collectDescendants(child.id);
    }
  }

  await collectDescendants(categoryId);
  return descendants;
}

export async function getParentCategories(): Promise<ProductCategory[]> {
  await checkPermission('commercial.categories', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const categories = await prisma.productCategory.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        description: true,
        parentId: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });

    return categories as ProductCategory[];
  } catch (error) {
    logger.error('Error al obtener categorías padre', { data: { error } });
    return [];
  }
}
