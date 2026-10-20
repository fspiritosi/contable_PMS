'use client';

import { useState, type ComponentProps } from 'react';

import { Input } from '@/shared/components/ui/input';
import { fromDateInputValue, toDateInputValue, type DateInputMode } from '@/shared/utils/date-input';

type DateInputProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: Date | null | undefined;
  /** Recibe `null` mientras la fecha está vacía o a medio tipear. */
  onChange: (date: Date | null) => void;
  /** `'local'` (por defecto): 12:00 locales. `'utc'`: 00:00Z, convención del núcleo contable. */
  mode?: DateInputMode;
};

/**
 * Input de fecha que se puede tipear segmento por segmento (TSK-782).
 *
 * Guarda localmente lo que muestra el navegador: si el formulario recibe `null` (o lo ignora)
 * mientras un segmento está incompleto, React no reescribe el input a mitad del tipeo.
 */
export function _DateInput({ value, onChange, mode = 'local', ...props }: DateInputProps) {
  const external = toDateInputValue(value, mode);
  const [text, setText] = useState(external);
  const [synced, setSynced] = useState(external);

  // El valor cambió desde afuera (reset del formulario, carga para editar): se muestra ese.
  if (external !== synced) {
    setSynced(external);
    setText(external);
  }

  return (
    <Input
      {...props}
      type="date"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(fromDateInputValue(e.target.value, mode));
      }}
    />
  );
}
