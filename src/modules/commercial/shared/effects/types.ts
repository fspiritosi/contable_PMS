// Contrato común de los efectos de cada comprobante (TSK-792).

/** Empresa y usuario en cuyo nombre se aplican o revierten los efectos. */
export interface EffectsCtx {
  companyId: string;
  userId: string;
}

/** Asiento del comprobante tras aplicar sus efectos (null si no genera asiento). */
export interface EffectsResult {
  journalEntryId: string | null;
}
