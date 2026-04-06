import type { Metadata } from 'next';
import { ModulesConfig } from '@/modules/companies/features/modules';

export const metadata: Metadata = { title: 'Módulos Activos' };

export default function ModulesPage() {
  return <ModulesConfig />;
}
