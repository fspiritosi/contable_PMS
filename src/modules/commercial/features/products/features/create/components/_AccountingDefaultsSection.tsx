'use client';

import type { UseFormReturn } from 'react-hook-form';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import type { UpdateProductFormData } from '../../../shared/validators';

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  nature: string;
}

interface CostCenterOption {
  id: string;
  name: string;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface SupplierOption {
  id: string;
  code: string;
  businessName: string;
  tradeName: string | null;
}

interface AccountingDefaultsSectionProps {
  form: UseFormReturn<UpdateProductFormData>;
  accounts: AccountOption[];
  costCenters: CostCenterOption[];
  warehouses: WarehouseOption[];
  suppliers: SupplierOption[];
}

const CLEAR_VALUE = '__CLEAR__';

export function _AccountingDefaultsSection({
  form,
  accounts,
  costCenters,
  warehouses,
  suppliers,
}: AccountingDefaultsSectionProps) {
  const expenseAccounts = accounts.filter((a) => a.nature === 'DEBIT');
  const incomeAccounts = accounts.filter((a) => a.nature === 'CREDIT');

  const handleSelectChange = (
    onChange: (value: string) => void,
    value: string,
  ) => {
    onChange(value === CLEAR_VALUE ? '' : value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración Contable y Logística</CardTitle>
        <CardDescription>
          Valores predeterminados para asientos contables y operaciones
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="defaultExpenseAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cuenta de Gastos</FormLabel>
                <Select
                  onValueChange={(v) => handleSelectChange(field.onChange, v)}
                  value={field.value || ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                    {expenseAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Cuenta contable para registrar compras/gastos
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultIncomeAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cuenta de Ingresos</FormLabel>
                <Select
                  onValueChange={(v) => handleSelectChange(field.onChange, v)}
                  value={field.value || ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                    {incomeAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Cuenta contable para registrar ventas/ingresos
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultCostCenterId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Centro de Costos</FormLabel>
                <Select
                  onValueChange={(v) => handleSelectChange(field.onChange, v)}
                  value={field.value || ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                    {costCenters.map((cc) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultWarehouseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Almacén Predeterminado</FormLabel>
                <Select
                  onValueChange={(v) => handleSelectChange(field.onChange, v)}
                  value={field.value || ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.code} - {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultSupplierId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Proveedor Predeterminado</FormLabel>
                <Select
                  onValueChange={(v) => handleSelectChange(field.onChange, v)}
                  value={field.value || ''}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.tradeName
                          ? `${supplier.tradeName} (${supplier.businessName})`
                          : supplier.businessName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
