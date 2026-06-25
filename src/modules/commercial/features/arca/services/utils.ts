/**
 * Helpers para construcción y parsing de XML/SOAP de servicios ARCA.
 *
 * Los WS de AFIP usan SOAP 1.1 con XML puro. Estos helpers evitan
 * dependencias externas de XML parsing — generan strings y parsean
 * con regex para los formatos fijos que devuelve AFIP.
 */

// ============================================
// CONSTANTES
// ============================================

const WSAA_URLS = {
  HOMOLOGACION: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  PRODUCCION: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;

const WSFE_URLS = {
  HOMOLOGACION: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  PRODUCCION: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const;

export type ArcaEnvironment = 'HOMOLOGACION' | 'PRODUCCION';

export function getWsaaUrl(env: ArcaEnvironment): string {
  return WSAA_URLS[env];
}

export function getWsfeUrl(env: ArcaEnvironment): string {
  return WSFE_URLS[env];
}

// ============================================
// XML BUILDERS
// ============================================

export function buildSoapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildWsaaSoapBody(cmsBase64: string): string {
  return `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <in0>${cmsBase64}</in0>
    </loginCms>`;
}

// ============================================
// WSFE XML BUILDERS
// ============================================

interface FEAuthRequest {
  token: string;
  sign: string;
  cuit: string;
}

export function buildFECompUltimoAutorizado(
  auth: FEAuthRequest,
  ptoVta: number,
  cbteTipo: number
): string {
  return buildSoapEnvelope(`
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${auth.token}</ar:Token>
        <ar:Sign>${auth.sign}</ar:Sign>
        <ar:Cuit>${auth.cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>`);
}

interface FECAERequest {
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

export function buildFECAESolicitar(auth: FEAuthRequest, req: FECAERequest): string {
  let ivaXml = '';
  if (req.ivaLines.length > 0) {
    ivaXml = `<ar:Iva>${req.ivaLines
      .map(
        (iv) => `
          <ar:AlicIva>
            <ar:Id>${iv.id}</ar:Id>
            <ar:BaseImp>${iv.baseImp.toFixed(2)}</ar:BaseImp>
            <ar:Importe>${iv.importe.toFixed(2)}</ar:Importe>
          </ar:AlicIva>`
      )
      .join('')}
        </ar:Iva>`;
  }

  let tributosXml = '';
  if (req.tributos && req.tributos.length > 0) {
    tributosXml = `<ar:Tributos>${req.tributos
      .map(
        (t) => `
          <ar:Tributo>
            <ar:Id>${t.id}</ar:Id>
            <ar:Desc>${escapeXml(t.desc)}</ar:Desc>
            <ar:BaseImp>${t.baseImp.toFixed(2)}</ar:BaseImp>
            <ar:Alic>${t.alic.toFixed(2)}</ar:Alic>
            <ar:Importe>${t.importe.toFixed(2)}</ar:Importe>
          </ar:Tributo>`
      )
      .join('')}
        </ar:Tributos>`;
  }

  let cbtesAsocXml = '';
  if (req.cbtesAsoc && req.cbtesAsoc.length > 0) {
    cbtesAsocXml = `<ar:CbtesAsoc>${req.cbtesAsoc
      .map(
        (c) => `
          <ar:CbteAsoc>
            <ar:Tipo>${c.tipo}</ar:Tipo>
            <ar:PtoVta>${c.ptoVta}</ar:PtoVta>
            <ar:Nro>${c.nro}</ar:Nro>
            <ar:Cuit>${c.cuit}</ar:Cuit>
            <ar:CbteFch>${c.cbteFch}</ar:CbteFch>
          </ar:CbteAsoc>`
      )
      .join('')}
        </ar:CbtesAsoc>`;
  }

  const serviceDates =
    req.concepto > 1
      ? `<ar:FchServDesde>${req.fchServDesde}</ar:FchServDesde>
            <ar:FchServHasta>${req.fchServHasta}</ar:FchServHasta>
            <ar:FchVtoPago>${req.fchVtoPago}</ar:FchVtoPago>`
      : '';

  return buildSoapEnvelope(`
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${auth.token}</ar:Token>
        <ar:Sign>${auth.sign}</ar:Sign>
        <ar:Cuit>${auth.cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${req.ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${req.cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${req.concepto}</ar:Concepto>
            <ar:DocTipo>${req.docTipo}</ar:DocTipo>
            <ar:DocNro>${req.docNro}</ar:DocNro>
            <ar:CbteDesde>${req.cbteDesde}</ar:CbteDesde>
            <ar:CbteHasta>${req.cbteHasta}</ar:CbteHasta>
            <ar:CbteFch>${req.cbteFch}</ar:CbteFch>
            <ar:ImpTotal>${req.impTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>${req.impTotConc.toFixed(2)}</ar:ImpTotConc>
            <ar:ImpNeto>${req.impNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>${req.impOpEx.toFixed(2)}</ar:ImpOpEx>
            <ar:ImpIVA>${req.impIVA.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>${req.impTrib.toFixed(2)}</ar:ImpTrib>
            ${serviceDates}
            <ar:MonId>${req.monId}</ar:MonId>
            <ar:MonCotiz>${req.monCotiz.toFixed(6)}</ar:MonCotiz>
            ${ivaXml}
            ${tributosXml}
            ${cbtesAsocXml}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>`);
}

// ============================================
// XML PARSERS
// ============================================

export function extractXmlValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

export function extractXmlValues(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

export function extractXmlBlock(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

interface WsaaLoginResponse {
  token: string;
  sign: string;
  expirationTime: string;
}

export function parseWsaaResponse(xml: string): WsaaLoginResponse | null {
  const loginReturn = extractXmlValue(xml, 'loginCmsReturn');
  if (!loginReturn) return null;

  const decoded = loginReturn
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

  const token = extractXmlValue(decoded, 'token');
  const sign = extractXmlValue(decoded, 'sign');
  const expirationTime = extractXmlValue(decoded, 'expirationTime');

  if (!token || !sign || !expirationTime) return null;

  return { token, sign, expirationTime };
}

export interface FECAEResponse {
  resultado: string;
  cae: string | null;
  caeFchVto: string | null;
  cbteDesde: number;
  cbteHasta: number;
  observations: string[];
  errors: string[];
}

export function parseFECAEResponse(xml: string): FECAEResponse {
  const detResponse = extractXmlBlock(xml, 'FECAEDetResponse') ?? xml;

  const resultado = extractXmlValue(detResponse, 'Resultado') ?? 'R';
  const cae = extractXmlValue(detResponse, 'CAE');
  const caeFchVto = extractXmlValue(detResponse, 'CAEFchVto');
  const cbteDesde = parseInt(extractXmlValue(detResponse, 'CbteDesde') ?? '0', 10);
  const cbteHasta = parseInt(extractXmlValue(detResponse, 'CbteHasta') ?? '0', 10);

  const observations = extractXmlValues(xml, 'Msg');
  const errors = extractXmlValues(xml, 'Msg');

  return { resultado, cae, caeFchVto, cbteDesde, cbteHasta, observations, errors };
}

export function parseFECompUltimoAutorizadoResponse(xml: string): number {
  const value = extractXmlValue(xml, 'CbteNro');
  return value ? parseInt(value, 10) : 0;
}

// ============================================
// HELPERS
// ============================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Mapeo de tipos de comprobante del sistema a códigos AFIP
export const VOUCHER_TYPE_MAP: Record<string, number> = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_M: 51,
  NOTA_DEBITO_M: 52,
  NOTA_CREDITO_M: 53,
};

// Mapeo de alícuotas IVA a IDs AFIP
export const IVA_RATE_MAP: Record<number, number> = {
  0: 3,      // 0%
  2.5: 9,    // 2.5%
  5: 8,      // 5%
  10.5: 4,   // 10.5%
  21: 5,     // 21%
  27: 6,     // 27%
};

// Mapeo de tipo de documento
export const DOC_TIPO_MAP: Record<string, number> = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  DNI: 96,
  PASAPORTE: 94,
  CI_EXTRANJERA: 91,
  SIN_IDENTIFICAR: 99,
};

export function formatAfipDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
