'use client';

import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { _CreateAccountModal } from './_CreateAccountModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface CreateAccountButtonProps {
  companyId: string;
}

export function _CreateAccountButton({ companyId }: CreateAccountButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const { hasPermission } = usePermissions();

  if (!hasPermission('accounting.accounts', 'create')) {
    return null;
  }

  return (
    <>
      <Button onClick={() => setShowModal(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Nueva Cuenta
      </Button>

      {showModal && (
        <_CreateAccountModal
          companyId={companyId}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
