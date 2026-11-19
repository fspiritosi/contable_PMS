'use client';

import * as React from 'react';

import { Input } from '@/shared/components/ui/input';
import {
  formatMoneyDisplay,
  insertDecimalComma,
  parseMoneyDisplay,
} from '@/shared/utils/money-input';

/**
 * Input de importes con separadores de miles en formato es-AR
 * (miles con punto, decimal con coma) mientras se escribe.
 *
 * El VALOR que expone al formulario es siempre el número crudo con punto
 * decimal (ej. "4000000.5"), compatible con las validaciones Zod existentes
 * del tipo `^\d+(\.\d{1,2})?$`. Lo que se MUESTRA es el valor formateado
 * ("4.000.000,5").
 *
 * El "." del teclado numérico escribe la coma decimal (TSK-851); el "." del
 * teclado principal sigue siendo separador de miles.
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

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, maxDecimals = 2, onKeyDown, ...props }, ref) => {
    const display = formatMoneyDisplay(value == null ? '' : String(value));

    // Input donde se acaba de escribir la coma con el numérico: tras el render
    // hay que dejar el cursor detrás de ella, porque al reformatear el valor
    // React lo manda al final. Se hace en layout effect (no en un frame
    // posterior) para no pisar la tecla siguiente si se tipea rápido.
    const caretAfterComma = React.useRef<HTMLInputElement | null>(null);
    React.useLayoutEffect(() => {
      const input = caretAfterComma.current;
      if (!input) return;
      caretAfterComma.current = null;
      const comma = input.value.indexOf(',');
      if (comma !== -1) input.setSelectionRange(comma + 1, comma + 1);
    }, [display]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || e.code !== 'NumpadDecimal') return;

      e.preventDefault();
      const input = e.currentTarget;
      const next = insertDecimalComma(
        input.value,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
        maxDecimals
      );
      if (next === null) return;

      const nextRaw = parseMoneyDisplay(next, maxDecimals);
      if (formatMoneyDisplay(nextRaw) === display) {
        // Sin cambio visible (p. ej. se reemplazó la coma por otra): no habrá render.
        const comma = display.indexOf(',');
        input.setSelectionRange(comma + 1, comma + 1);
        return;
      }
      caretAfterComma.current = input;
      onChange(nextRaw);
    };

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => onChange(parseMoneyDisplay(e.target.value, maxDecimals))}
        onKeyDown={handleKeyDown}
      />
    );
  }
);

MoneyInput.displayName = 'MoneyInput';
