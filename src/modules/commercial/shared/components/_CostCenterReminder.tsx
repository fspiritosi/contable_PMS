'use client';

import { useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';

/** Una línea que va a quedar sin centro de costo, con su posición en el formulario. */
export interface CostCenterReminderLine {
  index: number;
  description: string;
}

/** Id del bloque de reparto de una línea: "Elegir ahora" lleva la vista hasta ahí. */
export function costCenterFieldId(index: number): string {
  return `cost-center-line-${index}`;
}

interface Pending<T> {
  data: T;
  lines: CostCenterReminderLine[];
  save: (data: T) => Promise<void>;
}

/**
 * Recordatorio al guardar una factura con líneas sin centro de costo (TSK-840).
 *
 * No es una validación: pregunta "¿lo elegís ahora o después?". "Elegir ahora"
 * cierra el aviso y lleva la vista al reparto de la primera línea; "Guardar sin
 * centro de costo" guarda igual. Qué líneas cuentan lo decide
 * `findLinesWithoutCostCenter`, del lado del formulario que conoce sus ítems.
 */
export function useCostCenterReminder<T>(): {
  /** Guarda directo si no faltan centros; si faltan, pregunta antes. */
  guard: (data: T, lines: CostCenterReminderLine[], save: (data: T) => Promise<void>) => Promise<void>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending<T> | null>(null);
  const [saving, setSaving] = useState(false);

  const guard = async (
    data: T,
    lines: CostCenterReminderLine[],
    save: (data: T) => Promise<void>
  ) => {
    if (lines.length === 0) {
      await save(data);
      return;
    }
    setPending({ data, lines, save });
  };

  const chooseNow = () => {
    const first = pending?.lines[0];
    setPending(null);
    if (!first) return;
    // Después del cierre del diálogo, que devuelve el foco al botón de guardar.
    setTimeout(() => {
      document
        .getElementById(costCenterFieldId(first.index))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  const saveAnyway = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await pending.save(pending.data);
    } finally {
      setSaving(false);
      setPending(null);
    }
  };

  const count = pending?.lines.length ?? 0;

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !saving && chooseNow()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? 'Una línea sin centro de costo' : `${count} líneas sin centro de costo`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {count === 1 ? 'Esta línea va' : 'Estas líneas van'} a quedar sin centro de costo en
                el asiento, porque no {count === 1 ? 'tiene' : 'tienen'} reparto y{' '}
                {count === 1 ? 'su ítem no tiene' : 'sus ítems no tienen'} un centro predeterminado:
              </p>
              <ul className="list-disc pl-5">
                {pending?.lines.map((line) => (
                  <li key={line.index}>{line.description || `Línea ${line.index + 1}`}</li>
                ))}
              </ul>
              <p>¿Querés elegirlo ahora o guardar así y cargarlo después?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Cierra por `onOpenChange`, que es el que lleva a la línea (también con Escape). */}
          <AlertDialogCancel disabled={saving}>Elegir ahora</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              // Sin esto el diálogo se cierra antes de que termine el guardado.
              event.preventDefault();
              void saveAnyway();
            }}
          >
            {saving ? 'Guardando...' : 'Guardar sin centro de costo'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { guard, dialog };
}
