'use client';

import type { ReactNode } from 'react';
import { QueryProvider } from './QueryProvider';
import { SessionProvider } from './SessionProvider';
import { ThemeProvider } from './ThemeProvider';
import { Toaster } from '@/shared/components/ui/sonner';
// Idioma de moment en SSR y navegador (TSK-795); el layout raíz lo carga en el servidor.
import '@/shared/lib/moment-locale';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Providers combinados de la aplicación
 *
 * Orden de anidamiento:
 * 1. SessionProvider - Autenticación
 * 2. ThemeProvider - Modo claro/oscuro
 * 3. QueryProvider - React Query (datos del servidor)
 * 4. Toaster - Notificaciones
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
