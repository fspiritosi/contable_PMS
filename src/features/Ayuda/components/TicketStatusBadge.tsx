import { Badge } from '@/shared/components/ui/badge';
import { statusFor } from '../constants/ticket-status';

interface Props {
  slug: string | undefined;
}

export function TicketStatusBadge({ slug }: Props) {
  const def = statusFor(slug);
  return (
    <Badge variant="outline" className={`border-transparent ${def.badgeClass}`}>
      {def.label}
    </Badge>
  );
}
