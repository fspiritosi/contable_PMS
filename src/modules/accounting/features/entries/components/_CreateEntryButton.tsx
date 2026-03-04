'use client';

import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { _CreateEntryModal } from './_CreateEntryModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

export function _CreateEntryButton() {
  const [showModal, setShowModal] = useState(false);
  const { hasPermission } = usePermissions();

  if (!hasPermission('accounting.entries', 'create')) {
    return null;
  }

  return (
    <>
      <Button onClick={() => setShowModal(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Nuevo Asiento
      </Button>

      {showModal && (
        <_CreateEntryModal
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
