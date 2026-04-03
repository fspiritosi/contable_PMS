import type { Metadata } from 'next';
import { QuoteDetail } from '@/modules/commercial/features/quotes/detail';

export const metadata: Metadata = { title: 'Detalle Presupuesto' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function QuoteDetailPage({ params }: Props) {
  const { id } = await params;
  return <QuoteDetail id={id} />;
}
