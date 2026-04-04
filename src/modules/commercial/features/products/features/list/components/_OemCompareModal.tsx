'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { compareByOemCode } from '../../equivalences/list/actions.server';
import { _PriceComparisonView } from '../../equivalences/list/components/_PriceComparisonView';

interface OemCompareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _OemCompareModal({ open, onOpenChange }: OemCompareModalProps) {
  const [oemCode, setOemCode] = useState('');
  const [searchCode, setSearchCode] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['oem-price-comparison', searchCode],
    queryFn: () => compareByOemCode(searchCode),
    enabled: searchCode.length > 0,
  });

  const handleSearch = () => {
    const trimmed = oemCode.trim();
    if (trimmed) {
      setSearchCode(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setOemCode('');
      setSearchCode('');
    }
    onOpenChange(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Comparar Precios por Código OEM
          </DialogTitle>
          <DialogDescription>
            Ingresá un código OEM para comparar precios entre productos equivalentes de distintos proveedores.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <Label htmlFor="oem-code" className="sr-only">
                Código OEM
              </Label>
              <Input
                id="oem-code"
                placeholder="Ingresá el código OEM..."
                value={oemCode}
                onChange={(e) => setOemCode(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <Button onClick={handleSearch} disabled={!oemCode.trim()}>
              <Search className="h-4 w-4 mr-2" />
              Buscar
            </Button>
          </div>

          {/* Results */}
          {searchCode && (
            <div>
              {!isLoading && data && (
                <p className="text-sm text-muted-foreground mb-2">
                  {data.products.length === 0
                    ? `No se encontraron productos con código OEM "${data.oemCode}"`
                    : `${data.products.length} producto${data.products.length !== 1 ? 's' : ''} encontrado${data.products.length !== 1 ? 's' : ''} para OEM "${data.oemCode}"`}
                </p>
              )}
              <_PriceComparisonView
                products={data?.products ?? []}
                isLoading={isLoading}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
