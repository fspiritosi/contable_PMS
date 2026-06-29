import type { Metadata } from 'next';

import { CommercialOverview } from '@/modules/commercial';

export const metadata: Metadata = {
  title: 'Comercial',
  description: 'Gestión comercial - Proveedores, artículos y catálogos',
};

export default function CommercialPage() {
  return <CommercialOverview />;
}
