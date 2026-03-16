import { DeliveryNotesList } from '@/modules/commercial/features/sales/features/delivery-notes';

export default async function DeliveryNotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return <DeliveryNotesList searchParams={params} />;
}
