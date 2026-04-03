import { CreateInvoice } from '@/modules/commercial/features/sales/features/invoices/create';

interface Props {
  searchParams: Promise<{ fromQuote?: string }>;
}

export default async function NewInvoicePage({ searchParams }: Props) {
  const { fromQuote } = await searchParams;
  return <CreateInvoice fromQuoteId={fromQuote} />;
}
