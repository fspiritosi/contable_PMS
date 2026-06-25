'use server';

import { logger } from '@/shared/lib/logger';
import {
  type ArcaEnvironment,
  type FECAEResponse,
  getWsfeUrl,
  buildFECompUltimoAutorizado,
  buildFECAESolicitar,
  parseFECAEResponse,
  parseFECompUltimoAutorizadoResponse,
} from './utils';

// ============================================
// WSFEv1 — Web Service de Facturación Electrónica
// ============================================

interface WsfeAuth {
  token: string;
  sign: string;
  cuit: string;
}

async function callWsfe(
  environment: ArcaEnvironment,
  soapAction: string,
  body: string
): Promise<string> {
  const url = getWsfeUrl(environment);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${soapAction}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Error HTTP en WSFEv1', {
      data: { soapAction, status: response.status, body: text },
    });
    throw new Error(`WSFEv1 respondió con HTTP ${response.status}`);
  }

  return response.text();
}

// ============================================
// FECompUltimoAutorizado
// ============================================

export async function feCompUltimoAutorizado(
  auth: WsfeAuth,
  environment: ArcaEnvironment,
  ptoVta: number,
  cbteTipo: number
): Promise<number> {
  const xml = buildFECompUltimoAutorizado(auth, ptoVta, cbteTipo);
  const responseXml = await callWsfe(environment, 'FECompUltimoAutorizado', xml);

  const lastNumber = parseFECompUltimoAutorizadoResponse(responseXml);

  logger.info('FECompUltimoAutorizado', {
    data: { ptoVta, cbteTipo, lastNumber },
  });

  return lastNumber;
}

// ============================================
// FECAESolicitar
// ============================================

interface FECAESolicitarInput {
  concepto: number;
  docTipo: number;
  docNro: string;
  cbteTipo: number;
  ptoVta: number;
  cbteDesde: number;
  cbteHasta: number;
  cbteFch: string;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impIVA: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
  ivaLines: { id: number; baseImp: number; importe: number }[];
  tributos?: { id: number; baseImp: number; importe: number; desc: string; alic: number }[];
  cbtesAsoc?: { tipo: number; ptoVta: number; nro: number; cuit: string; cbteFch: string }[];
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
}

export async function feCAESolicitar(
  auth: WsfeAuth,
  environment: ArcaEnvironment,
  input: FECAESolicitarInput
): Promise<FECAEResponse> {
  const xml = buildFECAESolicitar(auth, input);
  const responseXml = await callWsfe(environment, 'FECAESolicitar', xml);

  const result = parseFECAEResponse(responseXml);

  logger.info('FECAESolicitar resultado', {
    data: {
      ptoVta: input.ptoVta,
      cbteTipo: input.cbteTipo,
      cbteDesde: input.cbteDesde,
      resultado: result.resultado,
      cae: result.cae,
    },
  });

  return result;
}
