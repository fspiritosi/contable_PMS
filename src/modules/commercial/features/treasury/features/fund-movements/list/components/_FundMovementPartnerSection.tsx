'use client';

import { useFormContext } from 'react-hook-form';

import type { FundMovementFormInput } from '../../shared/validators';
import type {
  FundMovementAccountRef,
  FundMovementConceptOption,
  FundMovementPartnerOption,
} from '../actions.server';
import { _FundMovementConceptField } from './_FundMovementConceptField';
import { _PartnerAccountNotice } from './_PartnerAccountNotice';
import { _PartnerSelectField } from './_PartnerSelectField';

interface FundMovementPartnerSectionProps {
  partners: FundMovementPartnerOption[];
  defaultContributionsAccount: FundMovementAccountRef | null;
  /** Conceptos activos del tipo (aporte o retiro); vacío = sin campo Concepto. */
  concepts: FundMovementConceptOption[];
  isView: boolean;
  /** Solo en vista: snapshots guardados del movimiento. */
  partnerSnapshot?: string | null;
}

/** Socio, concepto y aviso de cuenta de un aporte o retiro (TSK-717 / TSK-791). */
export function _FundMovementPartnerSection({
  partners,
  defaultContributionsAccount,
  concepts,
  isView,
  partnerSnapshot,
}: FundMovementPartnerSectionProps) {
  const { watch } = useFormContext<FundMovementFormInput>();
  const selectedPartner = partners.find((p) => p.id === watch('partnerId'));
  const conceptId = watch('conceptId');
  const selectedConcept = concepts.find((c) => c.id === conceptId);

  return (
    <>
      <_PartnerSelectField partners={partners} disabled={isView} snapshotLabel={partnerSnapshot} />

      {/* En vista el concepto va en el resumen (snapshot), no como campo. */}
      {!isView && concepts.length > 0 && <_FundMovementConceptField concepts={concepts} />}

      {!isView && (
        <_PartnerAccountNotice
          partner={selectedPartner}
          defaultAccount={defaultContributionsAccount}
          concept={selectedConcept}
          hasConcepts={concepts.length > 0}
        />
      )}
    </>
  );
}
