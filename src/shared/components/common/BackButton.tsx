'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  label?: string;
  variant?: 'ghost' | 'outline';
  size?: 'icon' | 'sm' | 'default';
}

export function BackButton({ label, variant = 'ghost', size = 'icon' }: BackButtonProps) {
  const router = useRouter();

  return (
    <Button variant={variant} size={size} onClick={() => router.back()}>
      <ArrowLeft className="h-4 w-4" />
      {label && <span className="ml-2">{label}</span>}
    </Button>
  );
}
