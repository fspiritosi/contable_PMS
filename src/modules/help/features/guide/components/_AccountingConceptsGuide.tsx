'use client';

import { Info, Tags } from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

/**
 * Guía de Conceptos (TSK-791): catálogo que Contabilidad arma para que Gestión no elija cuentas.
 * Separada de `_AccountingGuide` para no hacerla crecer.
 */
export function _AccountingConceptsGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-5 w-5" />
          Conceptos
        </CardTitle>
        <CardDescription>
          Qué cuenta usa cada movimiento de fondos o bancario, definido por Contabilidad
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          Un <strong>concepto</strong> es un nombre que entiende cualquier usuario (por ejemplo
          &quot;Impuesto ley 25.413&quot; o &quot;Aporte para obra&quot;) y que ya sabe a qué cuenta
          contable imputa. Quien carga movimientos en Gestión (Tesorería) elige el concepto y{' '}
          <strong>nunca ve ni elige una cuenta</strong>: el asiento sale de la cuenta que
          Contabilidad definió en el concepto.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Configuralos antes de que Gestión los necesite.</strong> Sin conceptos para{' '}
            <strong>Gastos e impuestos bancarios</strong> y para cada tipo de{' '}
            <strong>movimiento bancario</strong> que se cargue a mano, Gestión no puede registrar
            esos movimientos: ve un aviso que le pide que los cree Contabilidad.
          </AlertDescription>
        </Alert>
        <p>
          <strong>Crear un concepto:</strong>
        </p>
        <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
          <li>
            Andá a <strong>Empresa → Contabilidad → Conceptos</strong> y hacé clic en{' '}
            <strong>Nuevo concepto</strong>
          </li>
          <li>
            Escribí el <strong>nombre</strong>. No puede repetirse entre los conceptos activos,
            aunque cambien las mayúsculas o haya espacios de más
          </li>
          <li>
            Marcá los <strong>usos</strong>, agrupados en dos familias:{' '}
            <strong>Movimientos de fondo</strong> (Gastos e impuestos bancarios, Aporte de socio,
            Retiro de socio) y <strong>Movimientos bancarios</strong> (depósito, extracción,
            transferencia recibida o enviada, cheque, débito automático, comisión, interés). Un
            mismo concepto puede tener varios usos
          </li>
          <li>
            Elegí la <strong>cuenta</strong> a la que imputa. Solo se ofrecen cuentas imputables
            (de último nivel y activas)
          </li>
          <li>
            Guardá. El concepto aparece enseguida en los formularios de Gestión
          </li>
        </ol>
        <p>
          <strong>Qué cuentas admite cada uso:</strong>
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>
            <strong>Gastos e impuestos bancarios</strong>: cuentas de <strong>Egreso</strong> o{' '}
            <strong>Activo</strong> (Activo sirve para impuestos que se computan como crédito, como
            el Sircreb)
          </li>
          <li>
            <strong>Aporte y Retiro de socio</strong>: cuentas de <strong>Activo</strong>,{' '}
            <strong>Pasivo</strong> o <strong>Patrimonio Neto</strong>
          </li>
          <li>
            <strong>Movimientos bancarios</strong>: cuentas de <strong>Activo</strong>,{' '}
            <strong>Pasivo</strong> o <strong>Patrimonio Neto</strong>
          </li>
          <li>
            Si el concepto tiene <strong>varios usos</strong>, solo admite las cuentas que sirven
            para todos a la vez. Por ejemplo, un concepto de Gastos bancarios y de Comisión
            bancaria admite únicamente cuentas de Activo
          </li>
        </ul>
        <p>
          <strong>Aporte y Retiro de socio:</strong> si el concepto se usa solo en aportes y retiros,
          además de elegir una cuenta podés indicar{' '}
          <strong>&quot;Usar la cuenta del socio&quot;</strong>. En ese caso el asiento va a la
          cuenta de aportes del socio (o a la de Ajustes contables), igual que antes de que
          existieran los conceptos.
        </p>
        <p>
          <strong>Desactivar o eliminar:</strong>
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>
            <strong>Desactivar</strong> saca el concepto de los formularios de Gestión pero conserva
            el historial. Se puede volver a activar (si su nombre no lo ocupa otro activo)
          </li>
          <li>
            <strong>Eliminar</strong> solo es posible si el concepto nunca se usó. Si ya figura en
            algún movimiento, el sistema lo avisa y solo queda desactivarlo
          </li>
          <li>
            Los movimientos <strong>confirmados</strong> no cambian nunca: conservan la cuenta y el
            nombre del concepto de cuando se registraron
          </li>
          <li>
            Un <strong>borrador</strong> cuyo concepto se desactivó, perdió el uso o quedó con una
            cuenta que ya no es imputable <strong>no se puede confirmar</strong>: el mensaje nombra
            el concepto y hay que editar el borrador y elegir otro (o avisar a Contabilidad para
            corregir la cuenta)
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Necesitás el permiso <strong>Conceptos</strong> (Contabilidad) para ver y administrar este
          catálogo. En las empresas existentes, otorgalo desde <strong>Empresa → Roles</strong> a los
          roles que lo necesiten.
        </p>
      </CardContent>
    </Card>
  );
}
