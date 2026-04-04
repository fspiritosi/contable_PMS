'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { BookOpen, Receipt, Scale } from 'lucide-react';
import { _LibroIVATable } from './_LibroIVATable';
import { _FiscalPositionSummary } from './_FiscalPositionSummary';
import { getLibroIVAVentas, getLibroIVACompras } from '../actions.server';

export function _TaxReportsTabs() {
  return (
    <Tabs defaultValue="ventas" className="space-y-4">
      <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
        <TabsTrigger value="ventas" className="gap-2">
          <BookOpen className="h-4 w-4 hidden sm:block" />
          Libro IVA Ventas
        </TabsTrigger>
        <TabsTrigger value="compras" className="gap-2">
          <Receipt className="h-4 w-4 hidden sm:block" />
          Libro IVA Compras
        </TabsTrigger>
        <TabsTrigger value="posicion" className="gap-2">
          <Scale className="h-4 w-4 hidden sm:block" />
          Posición Fiscal
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ventas">
        <_LibroIVATable type="ventas" fetchData={getLibroIVAVentas} />
      </TabsContent>

      <TabsContent value="compras">
        <_LibroIVATable type="compras" fetchData={getLibroIVACompras} />
      </TabsContent>

      <TabsContent value="posicion">
        <_FiscalPositionSummary />
      </TabsContent>
    </Tabs>
  );
}
