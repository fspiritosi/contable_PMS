'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';

import { _PermissionsMatrix } from './_PermissionsMatrix';
import {
  createRole,
  updateRole,
  type SystemAction,
  type PermissionsConfig,
} from '../actions.server';

const roleSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  color: z.string().optional(),
  isDefault: z.boolean(),
});

type RoleFormData = z.infer<typeof roleSchema>;

interface RoleData {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  isDefault: boolean;
  permissions: Array<{
    module: string;
    action: { id: string; slug: string; name: string };
  }>;
}

interface Props {
  role?: RoleData;
  systemActions: SystemAction[];
  permissionsConfig: PermissionsConfig;
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
];

const ROLES_PATH = '/dashboard/company/general/roles';

export function _RoleForm({ role, systemActions, permissionsConfig }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<
    Array<{ module: string; actionId: string }>
  >([]);

  const isEditing = !!role;
  const isSystemRole = role?.isSystem ?? false;

  const form = useForm<RoleFormData>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      color: role?.color ?? '#6366f1',
      isDefault: role?.isDefault ?? false,
    },
  });

  useEffect(() => {
    if (role) {
      const permissions = role.permissions.map((p) => ({
        module: p.module,
        actionId: p.action.id,
      }));
      setSelectedPermissions(permissions);
    }
  }, [role]);

  const handlePermissionChange = (module: string, actionId: string, checked: boolean) => {
    setSelectedPermissions((prev) => {
      if (checked) {
        // Evitar duplicados: los botones "Todos" pueden re-marcar celdas ya seleccionadas
        const exists = prev.some((p) => p.module === module && p.actionId === actionId);
        if (exists) return prev;
        return [...prev, { module, actionId }];
      }
      return prev.filter((p) => !(p.module === module && p.actionId === actionId));
    });
  };

  const handleSubmit = async (data: RoleFormData) => {
    setIsSubmitting(true);
    try {
      if (isEditing && role) {
        await updateRole(role.id, {
          ...data,
          permissions: selectedPermissions,
        });
        toast.success('Rol actualizado');
      } else {
        await createRole({
          ...data,
          permissions: selectedPermissions,
        });
        toast.success('Rol creado');
      }
      router.push(ROLES_PATH);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar rol');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href={ROLES_PATH}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {isEditing
              ? isSystemRole
                ? `Rol: ${role.name}`
                : `Editar Rol: ${role.name}`
              : 'Nuevo Rol'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSystemRole
              ? 'Los roles de sistema no se pueden modificar, pero puedes ver sus permisos.'
              : 'Configura el nombre y los permisos del rol.'}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Información</CardTitle>
              <CardDescription>Datos generales del rol</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Administrador, Operador, etc."
                          disabled={isSystemRole}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-8 w-8 rounded border shrink-0"
                            style={{ backgroundColor: field.value }}
                          />
                          <div className="flex gap-1 flex-wrap">
                            {PRESET_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                disabled={isSystemRole}
                                className="h-6 w-6 rounded border hover:scale-110 transition-transform disabled:opacity-50"
                                style={{ backgroundColor: color }}
                                onClick={() => field.onChange(color)}
                              />
                            ))}
                          </div>
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción (opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe las responsabilidades de este rol..."
                        disabled={isSystemRole}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Rol por defecto</FormLabel>
                      <FormDescription>
                        Se asignará automáticamente a los nuevos usuarios invitados
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSystemRole}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permisos</CardTitle>
              <CardDescription>
                Define qué acciones puede realizar este rol en cada módulo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <_PermissionsMatrix
                systemActions={systemActions}
                permissionsConfig={permissionsConfig}
                selectedPermissions={selectedPermissions}
                onPermissionChange={handlePermissionChange}
                disabled={isSystemRole}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href={ROLES_PATH}>
                {isSystemRole ? 'Volver' : 'Cancelar'}
              </Link>
            </Button>
            {!isSystemRole && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Guardar' : 'Crear Rol'}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
