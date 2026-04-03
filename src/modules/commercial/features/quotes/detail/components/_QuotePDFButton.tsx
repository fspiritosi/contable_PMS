'use client';

import { Button } from '@/shared/components/ui/button';
import { Download } from 'lucide-react';

interface QuotePDFButtonProps {
  quoteId: string;
}

export function _QuotePDFButton({ quoteId }: QuotePDFButtonProps) {
  const handleDownload = () => {
    const url = `/api/quotes/${quoteId}/pdf`;
    window.open(url, '_blank');
  };

  return (
    <Button variant="outline" onClick={handleDownload}>
      <Download className="mr-2 h-4 w-4" />
      Descargar PDF
    </Button>
  );
}
