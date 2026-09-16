'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Badge } from '@/shared/components/ui/badge';

import { _MemberIdentity } from '../../shared/_MemberIdentity';
import { updateMemberRole, type CompanyMemberListItem, type AvailableRole } from '../actions.server';

const editRoleSchema = z.object({
  roleId: z.string().min(1, 'Selecciona un rol'),
});

type EditRoleFormData = z.infer<typeof editRoleSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: CompanyMemberListItem | null;
  availableRoles: AvailableRole[];
  onSuccess: () => void;
}

export function _EditUserRoleModal({
  open,
  onOpenChange,
  member,
  availableRoles,
  onSuccess,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<EditRoleFormData>({
    resolver: zodResolver(editRoleSchema),
    defaultValues: {
      roleId: member?.role?.id ?? '',
    },
  });

  // Reset form when member changes
  useEffect(() => {
    if (member) {
      form.reset({
        roleId: member.role?.id ?? '',
      });
    }
  }, [member, form]);

  const handleSubmit = async (data: EditRoleFormData) => {
    if (!member) return;

    setIsSubmitting(true);
    try {
      await updateMemberRole({
        memberId: member.id,
        roleId: data.roleId,
      });
      toast.success('Rol actualizado');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar rol');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Cambiar Rol</DialogTitle>
          <DialogDescription>
            Modifica el rol asignado a este usuario.
          </DialogDescription>
        </DialogHeader>

        {/* Info del usuario */}
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <_MemberIdentity
            size="md"
            firstName={member.firstName}
            lastName={member.lastName}
            email={member.email}
            imageUrl={member.imageUrl}
          />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nuevo Rol</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un rol" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          <div className="flex items-center gap-2">
                            {role.color && (
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: role.color }}
                              />
                            )}
                            <span>{role.name}</span>
                            {role.isSystem && (
                              <Badge variant="secondary" className="text-xs">
                                Sistema
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    El rol determina los permisos del usuario
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
