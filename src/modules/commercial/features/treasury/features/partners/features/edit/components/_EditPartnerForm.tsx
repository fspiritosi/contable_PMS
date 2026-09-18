'use client';

import { logger } from '@/shared/lib/logger';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PartnerWithAccount } from '../../../shared/types';
import type { PartnerFormData } from '../../../shared/validators';
import { _PartnerForm } from '../../create/components/_PartnerForm';
import { updatePartner } from '../../list/actions.server';

interface EditPartnerFormProps {
  partner: PartnerWithAccount;
}

export function _EditPartnerForm({ partner }: EditPartnerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: PartnerFormData) => {
    setIsSubmitting(true);
    try {
      await updatePartner(partner.id, data);
      toast.success('Socio actualizado correctamente');
      router.push(`/dashboard/commercial/treasury/partners/${partner.id}`);
      router.refresh();
    } catch (error) {
      logger.error('Error al actualizar socio', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al actualizar socio');
    } finally {
      setIsSubmitting(false);
    }
  };

  const defaultValues: PartnerFormData = {
    name: partner.name,
    taxId: partner.taxId || '',
    email: partner.email || '',
    phone: partner.phone || '',
    notes: partner.notes || '',
    isActive: partner.isActive,
    contributionsAccountId: partner.contributionsAccountId ?? null,
  };

  return (
    <_PartnerForm
      defaultValues={defaultValues}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitLabel="Guardar Cambios"
      savedAccountId={partner.contributionsAccountId}
    />
  );
}
