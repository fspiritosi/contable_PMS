'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Download, Upload, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { _CreateBankMovementDialog } from './_CreateBankMovementDialog';
import { _BankMovementImportDialog } from '@/modules/commercial/features/treasury/features/bank-movements/components/_BankMovementImportDialog';
import { downloadBankMovementsTemplate } from '@/modules/commercial/features/treasury/features/bank-movements/lib/import-export.server';

interface Props {
  bankAccountId: string;
}

export function _BankAccountDetailActions({ bankAccountId }: Props) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const router = useRouter();

  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try {
      const result = await downloadBankMovementsTemplate();

      const buffer = new Uint8Array(result.buffer);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Plantilla descargada correctamente');
    } catch {
      toast.error('Error al descargar la plantilla');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={handleDownloadTemplate} disabled={isDownloading}>
          {isDownloading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Plantilla Excel
        </Button>

        <Button variant="outline" onClick={() => setIsImportOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Importar Excel
        </Button>

        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Movimiento
        </Button>
      </div>

      <_CreateBankMovementDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        bankAccountId={bankAccountId}
        onSuccess={() => {
          setIsDialogOpen(false);
          router.refresh();
        }}
      />

      <_BankMovementImportDialog
        bankAccountId={bankAccountId}
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </>
  );
}
