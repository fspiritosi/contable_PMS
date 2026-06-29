'use server';

import { headers } from 'next/headers';
import { auth } from '@/shared/lib/auth';

export interface ReporterSession {
  email: string;
  name: string | null;
  /** ID estable del usuario en tu sistema de auth. Usado como FK en support_ticket_views. */
  userId: string;
}

/**
 * Devuelve la identidad del usuario actual (email, nombre y userId) o null si
 * no hay sesión. Implementación: Better Auth.
 *
 * Si más adelante migrás de sistema de auth, este archivo es lo único que
 * tenés que tocar del módulo de Ayuda.
 */
export async function getReporterEmail(): Promise<ReporterSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.email) return null;

  return {
    email: session.user.email,
    name: session.user.name ?? null,
    userId: session.user.id,
  };
}
