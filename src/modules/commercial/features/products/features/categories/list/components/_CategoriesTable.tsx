'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import {
  ChevronDown,
  ChevronRight,
  Edit,
  FolderTree,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { ProductCategory } from '../../shared/types';
import { buildCategoryTree, type CategoryTreeNode } from '../../shared/tree';
import { deleteCategory } from '../actions.server';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface CategoriesTableProps {
  categories: ProductCategory[];
}

export function CategoriesTable({ categories }: CategoriesTableProps) {
  const { hasPermission } = usePermissions();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);

    try {
      await deleteCategory(id);
      toast.success('Categoría eliminada correctamente');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    }
  };

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-md">
        <FolderTree className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">No hay categorías</p>
        <p className="text-sm text-muted-foreground">
          Crea tu primera categoría para organizar tus artículos
        </p>
      </div>
    );
  }

  const renderRow = (node: CategoryTreeNode, level: number): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedRows.has(node.id);

    return (
      <TableRow key={node.id}>
        <TableCell className="font-medium">
          <div className="flex items-center" style={{ paddingLeft: `${level * 1.5}rem` }}>
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mr-1 shrink-0"
                onClick={() => toggleRow(node.id)}
                aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <span className="inline-block w-6 mr-1 shrink-0" />
            )}
            <FolderTree className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
            {node.name}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{node.description || '-'}</TableCell>
        <TableCell>
          <Badge variant="secondary">{node._count?.products || 0}</Badge>
        </TableCell>
        <TableCell>
          <Badge variant="secondary">{node._count?.children || 0}</Badge>
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hasPermission('commercial.categories', 'update') && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/commercial/categories/${node.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Link>
                </DropdownMenuItem>
              )}
              {hasPermission('commercial.categories', 'delete') && (
                <DropdownMenuItem
                  onClick={() => setDeleteTarget({ id: node.id, name: node.name })}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  const renderNodes = (nodes: CategoryTreeNode[], level: number): ReactNode[] =>
    nodes.flatMap((node) => {
      const rows: ReactNode[] = [renderRow(node, level)];
      if (expandedRows.has(node.id) && node.children.length > 0) {
        rows.push(...renderNodes(node.children, level + 1));
      }
      return rows;
    });

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead>Artículos</TableHead>
              <TableHead>Subcategorías</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{renderNodes(tree, 0)}</TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar la categoría &quot;{deleteTarget?.name}&quot;. Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
