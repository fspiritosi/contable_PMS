'use client';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Play, Trash2, Plus, Zap } from 'lucide-react';
import moment from 'moment';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { generateRecurringEntry } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { _CreateRecurringEntryDialog } from './_CreateRecurringEntryDialog';
import { _DeleteRecurringEntryDialog } from './_DeleteRecurringEntryDialog';
import { _GeneratePendingDialog } from './_GeneratePendingDialog';

type RecurringEntryItem = {
  id: string;
  name: string;
  description: string;
  frequency: string;
  frequencyLabel: string;
  startDate: Date;
  endDate: Date | null;
  lastGenerated: Date | null;
  nextDueDate: Date;
  isPending: boolean;
  lines: {
    id: string;
    accountId: string;
    description: string | null;
    debit: number;
    credit: number;
    account: { code: string; name: string };
  }[];
};

interface RecurringEntriesTableProps {
  companyId: string;
  entries: RecurringEntryItem[];
  accounts: { id: string; code: string; name: string; type: string; nature: string }[];
}

const FREQUENCY_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  MONTHLY: 'default',
  BIMONTHLY: 'secondary',
  QUARTERLY: 'outline',
  SEMIANNUAL: 'secondary',
  ANNUAL: 'default',
};

export function _RecurringEntriesTable({ companyId, entries, accounts }: RecurringEntriesTableProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('accounting.recurring-entries', 'create');
  const canDelete = hasPermission('accounting.recurring-entries', 'delete');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showGeneratePending, setShowGeneratePending] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<RecurringEntryItem | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const pendingCount = entries.filter((e) => e.isPending).length;

  const handleGenerate = async (entry: RecurringEntryItem) => {
    setGeneratingId(entry.id);
    try {
      const result = await generateRecurringEntry(entry.id);
      if (!result.success) return void toast.error(result.error);
      toast.success(`Asiento N° ${result.number} generado desde "${entry.name}"`);
      router.refresh();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al generar asiento');
      }
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Asiento Recurrente
            </Button>
          )}
          {canCreate && pendingCount > 0 && (
            <Button variant="outline" onClick={() => setShowGeneratePending(true)}>
              <Zap className="mr-2 h-4 w-4" />
              Generar Pendientes ({pendingCount})
            </Button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No hay asientos recurrentes configurados.
        </div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="py-3 pl-4 text-left">Nombre</th>
                <th className="py-3 text-left">Frecuencia</th>
                <th className="py-3 text-right">Importe</th>
                <th className="py-3 text-left">Próxima Generación</th>
                <th className="py-3 text-left">Última Generación</th>
                <th className="py-3 text-left">Estado</th>
                <th className="py-3 pr-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const totalDebit = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
                return (
                  <tr key={entry.id} className="border-b">
                    <td className="py-2 pl-4">
                      <div>
                        <p className="font-medium text-sm">{entry.name}</p>
                        <p className="text-xs text-muted-foreground">{entry.description}</p>
                      </div>
                    </td>
                    <td className="py-2">
                      <Badge variant={FREQUENCY_VARIANTS[entry.frequency] ?? 'outline'}>
                        {entry.frequencyLabel}
                      </Badge>
                    </td>
                    <td className="py-2 text-right font-mono text-sm">
                      {formatAmount(totalDebit)}
                    </td>
                    <td className="py-2 text-sm">
                      {moment(entry.nextDueDate).format('DD/MM/YYYY')}
                    </td>
                    <td className="py-2 text-sm text-muted-foreground">
                      {entry.lastGenerated
                        ? moment(entry.lastGenerated).format('DD/MM/YYYY')
                        : 'Nunca'}
                    </td>
                    <td className="py-2">
                      {entry.isPending ? (
                        <Badge variant="destructive">Pendiente</Badge>
                      ) : (
                        <Badge variant="outline">Al día</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canCreate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleGenerate(entry)}
                            disabled={generatingId === entry.id}
                            title="Generar asiento"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteEntry(entry)}
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreateDialog && (
        <_CreateRecurringEntryDialog
          companyId={companyId}
          accounts={accounts}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {deleteEntry && (
        <_DeleteRecurringEntryDialog
          companyId={companyId}
          entry={deleteEntry}
          onClose={() => setDeleteEntry(null)}
        />
      )}

      {showGeneratePending && (
        <_GeneratePendingDialog
          pendingCount={pendingCount}
          onClose={() => setShowGeneratePending(false)}
        />
      )}
    </>
  );
}
