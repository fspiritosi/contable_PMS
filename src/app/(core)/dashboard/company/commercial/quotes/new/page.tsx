import type { Metadata } from 'next';
import { CreateQuote } from '@/modules/commercial/features/quotes/create';

export const metadata: Metadata = { title: 'Nuevo Presupuesto' };

export default function NewQuotePage() {
  return <CreateQuote />;
}
