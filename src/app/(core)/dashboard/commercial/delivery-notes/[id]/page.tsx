import { DeliveryNoteDetail } from '@/modules/commercial/features/sales/features/delivery-notes/detail';

export default async function DeliveryNoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeliveryNoteDetail id={id} />;
}
