import type { Metadata } from 'next';
import { DashboardSettings } from '@/modules/dashboard/features/settings';

export const metadata: Metadata = {
  title: 'Configuracion del Dashboard',
  description: 'Personaliza tu dashboard',
};

export default function DashboardSettingsPage() {
  return <DashboardSettings />;
}
