'use client';

import { useState } from 'react';
import { CheckCircle, MoreHorizontal, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { JournalEntryStatus } from '@/generated/prisma/enums';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { type JournalEntryWithLines } from '../../../shared/types';
import { _DeleteDraftEntryDialog } from './_DeleteDraftEntryDialog';
import { _PostEntryDialog } from './_PostEntryDialog';
import { _ReverseEntryDialog } from './_ReverseEntryDialog';
import { _RevertEntryToDraftDialog } from './_RevertEntryToDraftDialog';

type EntryAction = 'post' | 'reverse' | 'revert' | 'delete';

/**
 * Menú de acciones de una fila de Asientos con sus diálogos: Registrar y Eliminar
 * borrador (DRAFT) y Anular (POSTED), además de Volver a borrador (POSTED). Cada acción según su permiso.
 */
export function _EntryActionsMenu({ entry }: { entry: JournalEntryWithLines }) {
  const { hasPermission } = usePermissions();
  const [action, setAction] = useState<EntryAction | null>(null);
  const isDraft = entry.status === JournalEntryStatus.DRAFT;
  const canApprove = hasPermission('accounting.entries', 'approve');
  const canDelete = hasPermission('accounting.entries', 'delete') && isDraft;
  const canPost = canApprove && isDraft;
  const canReverse = canApprove && entry.status === JournalEntryStatus.POSTED;
  const canRevert = canReverse;
  const close = () => setAction(null);

  if (!canPost && !canReverse && !canRevert && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones del asiento ${entry.number}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canPost && (
            <DropdownMenuItem onClick={() => setAction('post')}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Registrar
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem onClick={() => setAction('delete')} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Eliminar borrador
            </DropdownMenuItem>
          )}
          {canRevert && (
            <DropdownMenuItem onClick={() => setAction('revert')}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Volver a borrador
            </DropdownMenuItem>
          )}
          {canReverse && (
            <DropdownMenuItem onClick={() => setAction('reverse')} className="text-destructive">
              <XCircle className="mr-2 h-4 w-4" />
              Anular
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {action === 'post' && <_PostEntryDialog entry={entry} onClose={close} />}
      {action === 'reverse' && <_ReverseEntryDialog entry={entry} onClose={close} />}
      {action === 'revert' && <_RevertEntryToDraftDialog entry={entry} onClose={close} />}
      {action === 'delete' && <_DeleteDraftEntryDialog entry={entry} onClose={close} />}
    </>
  );
}
