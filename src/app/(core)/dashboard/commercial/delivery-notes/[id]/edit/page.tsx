import { EditDeliveryNote } from '@/modules/commercial/features/sales/features/delivery-notes/edit';

export default async function EditDeliveryNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditDeliveryNote id={id} />;
}
