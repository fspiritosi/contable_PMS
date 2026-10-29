import moment from 'moment';
import { describe, expect, it } from 'vitest';

import '@/shared/lib/moment-locale';

describe('moment-locale (TSK-795)', () => {
  it('los nombres de mes salen en español', () => {
    expect(moment('2026-10', 'YYYY-MM').format('MMMM YYYY')).toBe('octubre 2026');
    expect(moment('2026-09', 'YYYY-MM').format('MMM YY')).toBe('sep. 26');
  });

  it('las semanas ISO no cambian: arrancan el lunes como antes', () => {
    expect(moment('2026-10-29').startOf('isoWeek').format('YYYY-MM-DD')).toBe('2026-10-26');
  });
});
