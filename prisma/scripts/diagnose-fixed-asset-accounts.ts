/**
 * TSK-618 — Diagnóstico de la marca de Bien de Uso en el plan de cuentas.
 *
 * Contexto: este ticket agrega el flag `isFixedAsset` al modelo `Account`. La
 * marca es una decisión de cada empresa y arranca en `false` para todas las
 * cuentas preexistentes (la migración es aditiva, sin backfill). Eso abre un
 * riesgo silencioso: una empresa que nunca tilda ninguna cuenta jamás va a ver
 * el aviso de "sería ideal que adjuntes el comprobante" en la factura de
 * compra, y nada en la app se lo va a advertir.
 *
 * Este script SOLO LEE. No hace ningún UPDATE ni INSERT: no decide por el
 * usuario qué cuentas son Bien de Uso. Lista, por empresa:
 *
 *   1. Cuántas cuentas tienen `is_fixed_asset = true`.
 *   2. Para las que tienen CERO: el código y nombre de la cuenta apuntada por
 *      `AccountingSettings.fixedAssetAccountId` (la cuenta de capitalización de
 *      equipos, etiquetada "Bienes de Uso" en la configuración contable), como
 *      pista de por dónde arrancar a tildar. Es solo una pista: esa cuenta es
 *      imputable (`isLeaf: true`), y lo que conviene tildar es el rubro padre.
 *
 * === Cómo correrlo ===
 *   Aplicar PRIMERO la migración 20260908133427_tsk_618_fixed_asset_account_flag:
 *
 *     npx tsx prisma/scripts/diagnose-fixed-asset-accounts.ts
 *
 *   Idempotente por construcción: no escribe nada. Carga `DATABASE_URL` desde
 *   `.env` vía dotenv.
 */

import 'dotenv/config';
import { prisma } from '../../src/shared/lib/prisma';

interface CompanyFixedAssetDiagnosis {
  companyId: string;
  companyName: string;
  markedAccounts: number;
  /** Solo cuando markedAccounts === 0: pista de por dónde arrancar a tildar. */
  fixedAssetSettingHint: { code: string; name: string } | null;
}

async function diagnoseFixedAssetAccounts(): Promise<CompanyFixedAssetDiagnosis[]> {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          accounts: { where: { isFixedAsset: true } },
        },
      },
      accountingSettings: {
        select: {
          fixedAssetAccount: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return companies.map((company) => {
    const markedAccounts = company._count.accounts;
    const hint = company.accountingSettings?.fixedAssetAccount ?? null;

    return {
      companyId: company.id,
      companyName: company.name,
      markedAccounts,
      fixedAssetSettingHint: markedAccounts === 0 && hint ? { code: hint.code, name: hint.name } : null,
    };
  });
}

async function main(): Promise<void> {
  const diagnoses = await diagnoseFixedAssetAccounts();

  console.log('--- Cuentas marcadas como Bien de Uso, por empresa ---');

  if (diagnoses.length === 0) {
    console.log('No hay empresas cargadas.');
    return;
  }

  for (const row of diagnoses) {
    console.log(`${row.companyName} | cuentas marcadas: ${row.markedAccounts} | id ${row.companyId}`);
  }

  const pending = diagnoses.filter((row) => row.markedAccounts === 0);

  console.log('');
  console.log('--- Empresas SIN ninguna cuenta marcada ---');
  console.log('(el aviso de adjunto nunca se va a disparar para ellas)');

  if (pending.length === 0) {
    console.log('Ninguna. Todas las empresas tienen al menos una cuenta marcada.');
    return;
  }

  for (const row of pending) {
    const hint = row.fixedAssetSettingHint
      ? `pista: la configuración contable apunta a ${row.fixedAssetSettingHint.code} ${row.fixedAssetSettingHint.name}`
      : 'sin pista: la configuración contable tampoco tiene cuenta de Bienes de Uso';
    console.log(`${row.companyName} | ${hint} | id ${row.companyId}`);
  }

  console.log('');
  console.log(`Total de empresas a revisar: ${pending.length}.`);
}

main()
  .catch((error) => {
    console.error('Error en el diagnóstico de cuentas de Bien de Uso:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
