'use client';

import { useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { logger } from '@/shared/lib/logger';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { AccountCombobox, type AccountOption } from '@/shared/components/common/AccountCombobox';
import { Switch } from '@/shared/components/ui/switch';
import { usePermissions } from '@/shared/hooks/usePermissions';

import {
  commercialIntegrationSchema,
  type CommercialIntegrationInput,
  type CommercialIntegrationValues,
} from '../validators';
import { saveAccountingSettings, getAccountingSettings } from '../actions.server';

type FormInput = CommercialIntegrationInput;
type FormValues = CommercialIntegrationValues;
/** Solo los campos de cuenta contable: `requireCostCenter` es un booleano aparte. */
type FieldName = Exclude<keyof FormInput, 'requireCostCenter'>;

/**
 * Tipos de cuenta del plan, tal como los expone Prisma (`AccountType` en
 * `schema.prisma`). No incluye `INCOME`: ese valor no existe en el enum real
 * (es `REVENUE`); usarlo dejaba el combobox de Cuenta de Ventas vacío
 * (TSK-583, hallazgo de revisión final).
 */
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

interface FieldDef {
  name: FieldName;
  label: string;
  /** Tipos de cuenta admitidos para este campo. */
  types: AccountType[];
  help?: string;
}

interface SectionDef {
  title: string;
  description?: string;
  fields: FieldDef[];
}

/**
 * Las cuentas por defecto, declaradas una sola vez. Antes cada campo era un
 * bloque de ~22 líneas repetido 23 veces, lo que hacía fácil olvidar uno
 * (así se coló TSK-492).
 */
const SECTIONS: SectionDef[] = [
  {
    title: 'Cuentas de Resultado',
    fields: [
      {
        name: 'salesAccountId',
        label: 'Cuenta de Ventas',
        types: ['REVENUE'],
        help: 'Se usa al confirmar facturas de venta (Haber)',
      },
      {
        name: 'purchasesAccountId',
        label: 'Cuenta de Compras',
        types: ['EXPENSE'],
        help: 'Se usa al confirmar facturas de compra (Debe)',
      },
      {
        name: 'expensesAccountId',
        label: 'Cuenta de Gastos Operativos',
        types: ['EXPENSE'],
        help: 'Se usa al confirmar gastos operativos (Debe)',
      },
    ],
  },
  {
    title: 'Cuentas de Crédito y Deuda',
    fields: [
      {
        name: 'receivablesAccountId',
        label: 'Cuentas por Cobrar',
        types: ['ASSET'],
        help: 'Se usa en facturas de venta (Debe) y recibos (Haber)',
      },
      {
        name: 'payablesAccountId',
        label: 'Cuentas por Pagar',
        types: ['LIABILITY'],
        help: 'Se usa en facturas de compra (Haber) y órdenes de pago (Debe)',
      },
    ],
  },
  {
    title: 'Cuentas de IVA',
    fields: [
      {
        name: 'vatDebitAccountId',
        label: 'IVA Débito Fiscal',
        types: ['LIABILITY'],
        help: 'IVA de ventas (Haber)',
      },
      {
        name: 'vatCreditAccountId',
        label: 'IVA Crédito Fiscal',
        types: ['ASSET'],
        help: 'IVA de compras (Debe)',
      },
    ],
  },
  {
    title: 'Cuentas de Tesorería (Opcional)',
    fields: [
      {
        name: 'defaultCashAccountId',
        label: 'Caja por Defecto',
        types: ['ASSET'],
        help: 'Se usa si la caja no tiene cuenta específica asignada',
      },
      {
        name: 'defaultBankAccountId',
        label: 'Banco por Defecto',
        types: ['ASSET'],
        help: 'Se usa si la cuenta bancaria no tiene cuenta específica asignada',
      },
    ],
  },
  {
    title: 'Cierre de Ejercicio',
    fields: [
      {
        name: 'resultAccountId',
        label: 'Cuenta de Resultado del Ejercicio',
        types: ['EQUITY'],
        help: 'Cuenta de Patrimonio Neto donde se registra el resultado al cerrar el ejercicio fiscal',
      },
      {
        name: 'partnerContributionsAccountId',
        label: 'Cuenta de Aportes de Socios',
        types: ['EQUITY'],
        help: 'Cuenta de Patrimonio Neto usada como contrapartida de los aportes y retiros de socios (Movimientos de fondos)',
      },
    ],
  },
  {
    title: 'Retenciones Emitidas (por Pagar a AFIP)',
    description:
      'Cuentas de Pasivo donde se registran las retenciones que la empresa emite al pagar a proveedores',
    fields: [
      { name: 'withholdingIvaEmittedAccountId', label: 'Ret. IVA Emitida', types: ['LIABILITY'] },
      {
        name: 'withholdingGananciasEmittedAccountId',
        label: 'Ret. Ganancias Emitida',
        types: ['LIABILITY'],
      },
      { name: 'withholdingIibbEmittedAccountId', label: 'Ret. IIBB Emitida', types: ['LIABILITY'] },
      { name: 'withholdingSussEmittedAccountId', label: 'Ret. SUSS Emitida', types: ['LIABILITY'] },
    ],
  },
  {
    title: 'Retenciones Sufridas (Crédito Fiscal)',
    description:
      'Cuentas de Activo donde se registran las retenciones que los clientes aplican a la empresa',
    fields: [
      { name: 'withholdingIvaSufferedAccountId', label: 'Ret. IVA Sufrida', types: ['ASSET'] },
      {
        name: 'withholdingGananciasSufferedAccountId',
        label: 'Ret. Ganancias Sufrida',
        types: ['ASSET'],
      },
      { name: 'withholdingIibbSufferedAccountId', label: 'Ret. IIBB Sufrida', types: ['ASSET'] },
      { name: 'withholdingSussSufferedAccountId', label: 'Ret. SUSS Sufrida', types: ['ASSET'] },
    ],
  },
  {
    title: 'Percepciones Cobradas (por Depositar)',
    description:
      'Cuentas de Pasivo donde se registran las percepciones que la empresa cobra a sus clientes',
    fields: [
      { name: 'perceptionIvaCollectedAccountId', label: 'Perc. IVA Cobrada', types: ['LIABILITY'] },
      { name: 'perceptionIibbCollectedAccountId', label: 'Perc. IIBB Cobrada', types: ['LIABILITY'] },
      {
        name: 'perceptionMunicipalCollectedAccountId',
        label: 'Perc. Municipal Cobrada',
        types: ['LIABILITY'],
      },
    ],
  },
  {
    title: 'Percepciones Sufridas (Crédito Fiscal)',
    description:
      'Cuentas de Activo donde se registran las percepciones que los proveedores aplican a la empresa',
    fields: [
      { name: 'perceptionIvaSufferedAccountId', label: 'Perc. IVA Sufrida', types: ['ASSET'] },
      { name: 'perceptionIibbSufferedAccountId', label: 'Perc. IIBB Sufrida', types: ['ASSET'] },
      {
        name: 'perceptionMunicipalSufferedAccountId',
        label: 'Perc. Municipal Sufrida',
        types: ['ASSET'],
      },
    ],
  },
  {
    title: 'Impuestos Internos',
    description:
      'Cuenta donde se imputan los impuestos internos que discrimina el comprobante',
    fields: [
      {
        name: 'internalTaxesAccountId',
        label: 'Impuestos Internos',
        types: ['EXPENSE', 'LIABILITY'],
        help: 'En compras suele ser una cuenta de resultado (mayor costo); en ventas, un pasivo a depositar',
      },
    ],
  },
  {
    title: 'Cuentas de Activos Fijos',
    fields: [
      { name: 'fixedAssetAccountId', label: 'Bienes de Uso', types: ['ASSET'] },
      {
        name: 'accumulatedDepreciationAccountId',
        label: 'Depreciación Acumulada',
        types: ['ASSET'],
      },
      { name: 'depreciationExpenseAccountId', label: 'Gasto de Depreciación', types: ['EXPENSE'] },
      {
        name: 'assetDisposalGainLossAccountId',
        label: 'Resultado Venta/Baja de B.U.',
        types: ['REVENUE', 'EXPENSE'],
      },
    ],
  },
];

interface CommercialIntegrationFormProps {
  companyId: string;
  accounts: Array<AccountOption & { type: string; nature: string }>;
  /**
   * Tipado con la forma de salida a propósito: obliga a que quien renderice el
   * formulario pase TODOS los campos. Es la garantía en tiempo de compilación
   * que faltaba cuando se agregaron las cuentas de activos fijos (TSK-492).
   */
  defaultValues: FormValues;
}

export function _CommercialIntegrationForm({
  companyId,
  accounts,
  defaultValues,
}: CommercialIntegrationFormProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(commercialIntegrationSchema),
    defaultValues,
  });

  const handleSubmit = async (data: FormValues) => {
    setIsLoading(true);
    try {
      // Obtener configuración actual para preservar las fechas del ejercicio
      const currentSettings = await getAccountingSettings(companyId);

      if (!currentSettings) {
        toast.error('Debes configurar primero el ejercicio fiscal');
        return;
      }

      await saveAccountingSettings(companyId, {
        fiscalYearStart: currentSettings.fiscalYearStart,
        fiscalYearEnd: currentSettings.fiscalYearEnd,
        ...data,
      });

      toast.success('Configuración de integración guardada correctamente');
      router.refresh();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al guardar la configuración');
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * El formulario usa Label plano en vez de FormField/FormMessage, así que un
   * error de validación no se vería en pantalla. Sin esto, "Guardar" quedaba
   * sin efecto y sin explicación (TSK-492).
   */
  const handleInvalid = (errors: FieldErrors<FormInput>) => {
    const campos = Object.keys(errors);
    logger.error('Validación fallida en configuración de integración comercial', {
      data: { campos, errors },
    });
    toast.error(
      campos.length > 0
        ? `No se pudo guardar: revisá los campos ${campos.join(', ')}`
        : 'No se pudo guardar: hay campos inválidos'
    );
  };

  const accountsFor = (types: AccountType[]) =>
    accounts.filter((account) => types.includes(account.type as AccountType));

  return (
    <form onSubmit={form.handleSubmit(handleSubmit, handleInvalid)} className="space-y-6">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="requireCostCenter">Exigir centro de costo</Label>
          <p className="text-xs text-muted-foreground">
            Al confirmar una factura de compra o venta, cada línea imputada a una cuenta de
            ingresos o egresos deberá tener su reparto por centro de costo.
          </p>
        </div>
        <Switch
          id="requireCostCenter"
          checked={form.watch('requireCostCenter') ?? false}
          onCheckedChange={(checked) =>
            form.setValue('requireCostCenter', checked, { shouldDirty: true })
          }
          disabled={isLoading}
        />
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">{section.title}</h3>
            {section.description && (
              <p className="text-xs text-muted-foreground">{section.description}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {section.fields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                <AccountCombobox
                  id={field.name}
                  accounts={accountsFor(field.types)}
                  value={form.watch(field.name)}
                  onChange={(accountId) =>
                    form.setValue(field.name, accountId, { shouldDirty: true })
                  }
                  disabled={isLoading}
                />
                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex justify-end border-t pt-4">
        <Button
          type="submit"
          disabled={isLoading || !hasPermission('accounting.settings', 'update')}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar Configuración
        </Button>
      </div>
    </form>
  );
}
