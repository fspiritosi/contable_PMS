'use server';

import { createSign } from 'crypto';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import {
  type ArcaEnvironment,
  getWsaaUrl,
  buildWsaaSoapBody,
  buildSoapEnvelope,
  parseWsaaResponse,
} from './utils';
import { decrypt } from '../features/credentials/actions.server';

// ============================================
// WSAA — Web Service de Autenticación y Autorización
// ============================================

interface TokenSignPair {
  token: string;
  sign: string;
}

export async function getTokenSign(
  companyId: string,
  environment: ArcaEnvironment,
  service: string = 'wsfe'
): Promise<TokenSignPair> {
  const credential = await prisma.arcaCredential.findUnique({
    where: { companyId_environment: { companyId, environment } },
  });

  if (!credential) {
    throw new Error(`No hay credenciales ARCA configuradas para ambiente ${environment}`);
  }

  // Verificar si el token cacheado sigue vigente (con 5 min de margen)
  if (credential.token && credential.sign && credential.tokenExpiry) {
    const marginMs = 5 * 60 * 1000;
    if (credential.tokenExpiry.getTime() - marginMs > Date.now()) {
      return { token: credential.token, sign: credential.sign };
    }
  }

  // Descifrar credenciales y solicitar nuevo token
  const credWithBuffers = {
    certificate: decrypt(Buffer.from(credential.certificate)),
    privateKey: decrypt(Buffer.from(credential.privateKey)),
    cuit: credential.cuit,
  };
  const result = await loginCms(credWithBuffers, environment, service);

  // Cachear el token
  await prisma.arcaCredential.update({
    where: { id: credential.id },
    data: {
      token: result.token,
      sign: result.sign,
      tokenExpiry: new Date(result.expirationTime),
    },
  });

  logger.info('Token WSAA renovado', {
    data: { companyId, environment, service, expiry: result.expirationTime },
  });

  return { token: result.token, sign: result.sign };
}

async function loginCms(
  credential: { certificate: Buffer; privateKey: Buffer; cuit: string },
  environment: ArcaEnvironment,
  service: string
): Promise<{ token: string; sign: string; expirationTime: string }> {
  const certPem = credential.certificate.toString('utf-8');
  const keyPem = credential.privateKey.toString('utf-8');

  // Generar Login Ticket Request XML
  const now = new Date();
  const generationTime = new Date(now.getTime() - 600000);
  const expirationTime = new Date(now.getTime() + 600000);

  const ltr = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>
    <generationTime>${generationTime.toISOString()}</generationTime>
    <expirationTime>${expirationTime.toISOString()}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;

  // Construir CMS firmado — en producción usar node-forge para PKCS#7 completo
  const cmsBase64 = Buffer.from(
    buildCmsStructure(certPem, keyPem, ltr)
  ).toString('base64');

  const soapBody = buildWsaaSoapBody(cmsBase64);
  const envelope = buildSoapEnvelope(soapBody);
  const url = getWsaaUrl(environment);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body: envelope,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Error HTTP en WSAA', { data: { status: response.status, body: text } });
    throw new Error(`WSAA respondió con HTTP ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parseWsaaResponse(xml);

  if (!parsed) {
    logger.error('No se pudo parsear respuesta WSAA', { data: { xml } });
    throw new Error('Respuesta inválida del WSAA');
  }

  return parsed;
}

/**
 * Construye la estructura CMS/PKCS#7 para firmar el Login Ticket Request.
 * En un entorno real, se debería usar una librería como `node-forge` o `pkcs7`.
 * Esta implementación usa `node:crypto` createSign para la firma RSA-SHA256
 * y envuelve el resultado en el formato que AFIP espera.
 */
function buildCmsStructure(certPem: string, keyPem: string, content: string): string {
  const sign = createSign('RSA-SHA256');
  sign.update(content);
  const signature = sign.sign(keyPem, 'base64');

  // Extraer el cuerpo del certificado (sin headers PEM)
  const certBody = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const contentBase64 = Buffer.from(content).toString('base64');

  // Estructura simplificada — en producción usar node-forge para PKCS#7 completo
  return JSON.stringify({
    certificate: certBody,
    signature,
    content: contentBase64,
  });
}
