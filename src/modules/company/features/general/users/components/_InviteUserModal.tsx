'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Check, ChevronsUpDown, User } from 'lucide-react';

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
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/lib/utils';

import { inviteUser, type AvailableRole, type AvailableEmployee } from '../actions.server';

const inviteSchema = z.object({
  email: z.string().email('Email inválido'),
  roleId: z.string().min(1, 'Selecciona un rol'),
  employeeId: z.string().optional(),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableRoles: AvailableRole[];
  availableEmployees: AvailableEmployee[];
  onSuccess: () => void;
}

export function _InviteUserModal({
  open,
  onOpenChange,
  availableRoles,
  availableEmployees,
  onSuccess,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employeeSearchOpen, setEmployeeSearchOpen] = useState(false);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      roleId: availableRoles.find((r) => r.isDefault)?.id ?? '',
      employeeId: '',
    },
  });

  // Get selected employee for display
  const selectedEmployeeId = form.watch('employeeId');
  const selectedEmployee = availableEmployees.find((e) => e.id === selectedEmployeeId);

  const handleSubmit = async (data: InviteFormData) => {
    setIsSubmitting(true);
    try {
      const result = await inviteUser({
        email: data.email,
        roleId: data.roleId,
        employeeId: data.employeeId || undefined,
      });
      if (result.emailSent) {
        toast.success('Invitación enviada');
      } else {
        toast.warning(
          'Invitación creada, pero no se pudo enviar el email. Usá "Reenviar" desde la lista de invitaciones.'
        );
      }
      form.reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar invitación');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Invitar Usuario</DialogTitle>
          <DialogDescription>
            Envía una invitación por email para que se una a la empresa.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="usuario@ejemplo.com"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Se enviará un email de invitación a esta dirección
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rol</FormLabel>
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
                            {role.isDefault && (
                              <Badge variant="outline" className="text-xs">
                                Por defecto
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    El rol determina los permisos del usuario en la empresa
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Employee selector */}
            <FormField
              control={form.control}
              name="employeeId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Vincular a Empleado (Opcional)</FormLabel>
                  <Popover open={employeeSearchOpen} onOpenChange={setEmployeeSearchOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={employeeSearchOpen}
                          className={cn(
                            'w-full justify-between',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {selectedEmployee ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                {selectedEmployee.pictureUrl ? (
                                  <AvatarImage src={selectedEmployee.pictureUrl} />
                                ) : null}
                                <AvatarFallback>
                                  <User className="h-3 w-3" />
                                </AvatarFallback>
                              </Avatar>
                              <span>
                                {selectedEmployee.firstName} {selectedEmployee.lastName}
                              </span>
                              <span className="text-muted-foreground">
                                - Leg. {selectedEmployee.employeeNumber}
                              </span>
                            </div>
                          ) : (
                            'Sin vincular'
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[450px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar empleado..." />
                        <CommandList>
                          <CommandEmpty>No se encontraron empleados disponibles</CommandEmpty>
                          <CommandGroup>
                            {/* Option to clear selection */}
                            <CommandItem
                              value="sin-vincular"
                              onSelect={() => {
                                form.setValue('employeeId', '');
                                setEmployeeSearchOpen(false);
                              }}
                            >
                              <span className="text-muted-foreground">Sin vincular</span>
                              {!field.value && <Check className="ml-auto h-4 w-4" />}
                            </CommandItem>
                            {availableEmployees.map((employee) => (
                              <CommandItem
                                key={employee.id}
                                value={`${employee.firstName} ${employee.lastName} ${employee.employeeNumber} ${employee.documentNumber}`}
                                onSelect={() => {
                                  form.setValue('employeeId', employee.id);
                                  setEmployeeSearchOpen(false);
                                }}
                              >
                                <div className="flex items-center gap-3 w-full">
                                  <Avatar className="h-8 w-8">
                                    {employee.pictureUrl ? (
                                      <AvatarImage src={employee.pictureUrl} />
                                    ) : null}
                                    <AvatarFallback>
                                      <User className="h-4 w-4" />
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {employee.firstName} {employee.lastName}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      Leg. {employee.employeeNumber} · DNI {employee.documentNumber}
                                    </p>
                                  </div>
                                  {field.value === employee.id && (
                                    <Check className="h-4 w-4 text-primary" />
                                  )}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormDescription>
                    Si vinculas un empleado, el usuario tendrá acceso a su información
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
                Enviar Invitación
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
