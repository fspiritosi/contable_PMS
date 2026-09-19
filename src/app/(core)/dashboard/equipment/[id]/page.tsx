import { EquipmentDetail, type EquipmentDetailTab } from '@/modules/equipment';

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  // Validate tab parameter
  const validTabs: EquipmentDetailTab[] = ['info', 'contract', 'assignment', 'contractors', 'documents', 'depreciation', 'qr'];
  const currentTab = validTabs.includes(tab as EquipmentDetailTab)
    ? (tab as EquipmentDetailTab)
    : 'info';

  return <EquipmentDetail id={id} tab={currentTab} />;
}
