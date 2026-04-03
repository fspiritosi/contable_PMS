import type { Metadata } from 'next';
import { EditQuote } from '@/modules/commercial/features/quotes/edit';

export const metadata: Metadata = { title: 'Editar Presupuesto' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditQuotePage({ params }: Props) {
  const { id } = await params;
  return <EditQuote id={id} />;
}
