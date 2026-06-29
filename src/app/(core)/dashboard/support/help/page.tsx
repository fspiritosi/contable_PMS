import { getReporterEmail } from '@/features/Ayuda/actions/getReporterEmail';
import { getMyTicketsWithUnread, getSupportTicketById } from '@/features/Ayuda/actions/support-tickets';
import { HelpCenter } from '@/features/Ayuda/components/HelpCenter';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Ayuda',
  description: 'Centro de ayuda',
};

interface SearchParams {
  ticket?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function HelpPage({ searchParams }: Props) {
  const reporterCheck = await getReporterEmail();
  if (!reporterCheck) redirect('/login');

  const params = await searchParams;
  const rawId = params.ticket ? Number(params.ticket) : null;
  const ticketId = rawId != null && Number.isFinite(rawId) ? rawId : null;

  const [initialTickets, initialTicket, reporter] = await Promise.all([
    getMyTicketsWithUnread(),
    ticketId != null ? getSupportTicketById(ticketId) : Promise.resolve(null),
    getReporterEmail(),
  ]);

  const currentUserEmail = reporter?.email ?? '';
  const currentUserName = reporter?.name ?? reporter?.email ?? 'Usuario';

  return (
    <HelpCenter
      initialTickets={initialTickets}
      initialTicket={initialTicket}
      initialTicketId={ticketId}
      currentUserEmail={currentUserEmail}
      currentUserName={currentUserName}
    />
  );
}
