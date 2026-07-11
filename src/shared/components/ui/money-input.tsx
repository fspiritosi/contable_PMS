'use client';

import * as React from 'react';

import { Input } from '@/shared/components/ui/input';

/**
 * Input de importes con separadores de miles en formato es-AR
 * (miles con punto, decimal con coma) mientras se escribe.
 *
 * El VALOR que expone al formulario es siempre el número crudo con punto
 * decimal (ej. "4000000.5"), compatible con las validaciones Zod existentes
 * del tipo `^\d+(\.\d{1,2})?$`. Lo que se MUESTRA es el valor formateado
 * ("4.000.000,5").
 */
export interface MoneyInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Valor crudo del formulario (string o number con punto decimal). */
  value: string | number | null | undefined;
  /** Recibe el valor crudo (string con punto decimal, sin separadores de miles). */
  onChange: (rawValue: string) => void;
  /** Máximo de decimales permitidos (por defecto 2). */
  maxDecimals?: number;
}

/** "4000000.5" -> "4.000.000,5" (formato es-AR). */
function formatDisplay(raw: string): string {
  if (raw === '' || raw == null) return '';
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart, decPart] = unsigned.split('.');
  const intClean = intPart.replace(/^0+(?=\d)/, ''); // sin ceros a la izquierda
  const intFormatted = (intClean || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted;
  return negative ? `-${body}` : body;
}

/**
 * Texto tipeado (es-AR) -> valor crudo con punto decimal.
 * Acepta puntos y comas: el ÚLTIMO separador de coma se toma como decimal;
 * los puntos se tratan como separadores de miles.
 */
function parseToRaw(display: string, maxDecimals: number): string {
  const negative = display.trim().startsWith('-');
  // Quitar todo lo que no sea dígito o coma (los puntos son miles)
  let cleaned = display.replace(/[^\d,]/g, '');
  // Solo la primera coma cuenta como decimal
  const firstComma = cleaned.indexOf(',');
  if (firstComma !== -1) {
    const intp = cleaned.slice(0, firstComma).replace(/,/g, '');
    let decp = cleaned.slice(firstComma + 1).replace(/,/g, '');
    if (maxDecimals >= 0) decp = decp.slice(0, maxDecimals);
    cleaned = `${intp}.${decp}`;
  }
  if (cleaned === '' || cleaned === '.') return '';
  return negative ? `-${cleaned}` : cleaned;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, maxDecimals = 2, ...props }, ref) => {
    const display = formatDisplay(value == null ? '' : String(value));

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => onChange(parseToRaw(e.target.value, maxDecimals))}
      />
    );
  }
);

MoneyInput.displayName = 'MoneyInput';
