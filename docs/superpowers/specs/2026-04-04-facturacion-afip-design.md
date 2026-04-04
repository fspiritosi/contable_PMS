# Spec: Facturación Electrónica AFIP (WSFE)

## Contexto

Baxer-N necesita integrar facturación electrónica con AFIP para que las facturas de venta obtengan CAE (Código de Autorización Electrónico) automáticamente al confirmarlas. Esto es obligatorio para empresas Responsable Inscripto en Argentina.

El modelo SalesInvoice ya tiene campos `cae` y `caeExpiryDate`. El flujo actual es: DRAFT → CONFIRMED (manual, sin AFIP). El objetivo es que al confirmar se solicite CAE a AFIP y se rechace la confirmación si AFIP rechaza.

---

## 1. Arquitectura General

```
┌──────────────────────────────────────────────┐
│  Baxer-N ERP                                 │
│                                              │
│  confirmInvoice() ─► AFIPService             │
│                      ├─ WSAAClient (auth)     │
│                      │  └─ Token/Sign cache   │
│                      └─ WSFEClient (factura)  │
│                         ├─ FECAESolicitar     │
│                         ├─ FECompUltimoAuth   │
│                         └─ FECompConsultar    │
└──────────────┬───────────────────────────────┘
               │ SOAP/HTTPS
               ▼
┌──────────────────────────────────────────────┐
│  AFIP Web Services                           │
│  ├─ WSAA (auth.afip.gov.ar)                  │
│  │  └─ LoginCms (certificado + private key)  │
│  └─ WSFE (wsfe.afip.gov.ar)                  │
│     └─ FECAESolicitar (solicitud de CAE)     │
└──────────────────────────────────────────────┘
```

---

## 2. Componentes

### 2.1 Gestión de Certificados

**Modelo Prisma: `AFIPCertificate`**
- companyId, pointOfSaleId (opcional, puede ser por empresa o por PdV)
- certificatePem (texto del .crt)
- privateKeyPem (texto del .key, encriptado en BD)
- cuit (CUIT asociado al certificado)
- environment: 'testing' | 'production'
- expiresAt (vencimiento del certificado)
- isActive

**UI: Pantalla de configuración AFIP**
- En Configuración de Empresa > AFIP
- Upload de certificado (.crt) y clave privada (.key)
- Selector de ambiente (testing/producción)
- Test de conexión
- Estado del certificado (válido/vencido/error)

### 2.2 WSAA Client (Autenticación)

Web Service de Autenticación y Autorización de AFIP.

**Flujo:**
1. Generar LoginTicketRequest (XML con destino=wsfe, fechas)
2. Firmar con CMS (PKCS#7) usando certificado + private key
3. Enviar a WSAA endpoint LoginCms
4. Recibir Token + Sign (válidos ~12 horas)
5. Cachear Token/Sign en BD o Redis

**Modelo: `AFIPAuthToken`**
- companyId, service ('wsfe'), token, sign, expiresAt
- Se renueva automáticamente cuando expira

**Librería:** `xml2js` para XML, `node-forge` o `crypto` nativo de Node para firmar CMS.

### 2.3 WSFE Client (Facturación)

Web Service de Facturación Electrónica.

**Operaciones necesarias:**
- `FECAESolicitar` — Solicitar CAE para una factura
- `FECompUltimoAutorizado` — Último número autorizado por AFIP (para sincronizar numeración)
- `FEParamGetTiposCbte` — Tipos de comprobante
- `FECompConsultar` — Consultar comprobante existente

**Mapeo de datos Baxer-N → AFIP:**
- VoucherType → CbteTipo (1=Factura A, 6=Factura B, 11=Factura C, etc.)
- Líneas → se agregan como IVA por alícuota (AFIP no recibe líneas individuales)
- Punto de venta → PtoVta
- Número → CbteDesde/CbteHasta
- Importes → ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpIVA, ImpTrib

### 2.4 Flujo de Confirmación con AFIP

```
Usuario clickea "Confirmar" en factura DRAFT
  │
  ├─ Punto de venta tiene afipEnabled=true?
  │   ├─ NO → confirmar sin AFIP (flujo actual)
  │   └─ SI → solicitar CAE a AFIP
  │       │
  │       ├─ Obtener token WSAA (cachear/renovar)
  │       ├─ Consultar último nro autorizado (sincronizar)
  │       ├─ Armar request FECAESolicitar
  │       ├─ Enviar a AFIP
  │       │
  │       ├─ Resultado = Aprobado
  │       │   ├─ Guardar CAE + caeExpiryDate
  │       │   ├─ Confirmar factura (status=CONFIRMED)
  │       │   └─ Generar PDF con CAE
  │       │
  │       ├─ Resultado = Rechazado
  │       │   ├─ Mostrar errores de AFIP al usuario
  │       │   └─ Factura queda en DRAFT
  │       │
  │       └─ Resultado = Error de conexión
  │           ├─ Reintentar 1 vez
  │           └─ Si falla: mostrar error, factura queda en DRAFT
```

---

## 3. Modelo de datos

### Nuevos modelos

```prisma
model AFIPCertificate {
  id              String    @id @default(uuid())
  companyId       String
  cuit            String
  certificatePem  String    @db.Text
  privateKeyPem   String    @db.Text  // encriptado
  environment     String    @default("testing") // 'testing' | 'production'
  isActive        Boolean   @default(true)
  expiresAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  company Company @relation(fields: [companyId], references: [id])
  @@unique([companyId, environment])
}

model AFIPAuthToken {
  id          String   @id @default(uuid())
  companyId   String
  service     String   @default("wsfe")
  token       String   @db.Text
  sign        String   @db.Text
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  
  company Company @relation(fields: [companyId], references: [id])
  @@unique([companyId, service])
}
```

### Cambios en SalesInvoice

Agregar:
- `afipResult Json?` — respuesta completa de AFIP (para debugging)
- `afipObservations String?` — observaciones de AFIP

### Cambios en SalesPointOfSale

Ya tiene `afipEnabled Boolean`. Agregar:
- `afipPointOfSaleNumber Int?` — número de PdV registrado en AFIP (puede diferir del interno)

---

## 4. Archivos a crear

### Servicio AFIP (shared)
- `src/shared/lib/afip/wsaa-client.ts` — Autenticación WSAA
- `src/shared/lib/afip/wsfe-client.ts` — Facturación WSFE
- `src/shared/lib/afip/afip-service.ts` — Orquestador (solicitar CAE)
- `src/shared/lib/afip/afip-types.ts` — Tipos de request/response
- `src/shared/lib/afip/afip-mappers.ts` — Mapeo Baxer-N → AFIP
- `src/shared/lib/afip/constants.ts` — Endpoints, códigos comprobante, alícuotas

### Configuración AFIP (empresa)
- `src/modules/company/features/afip-config/` — CRUD certificados, test conexión
- `src/app/(core)/dashboard/company/afip/page.tsx`

### Integración en facturación
- Modificar `confirmInvoice()` en actions.server.ts

### PDF
- Agregar código de barras AFIP (interleaved 2 of 5) al footer del PDF
- Ya hay campos cae/caeExpiryDate en el template

---

## 5. Dependencias necesarias

- `soap` o `strong-soap` — cliente SOAP para Node.js
- `xml2js` — parser XML (probablemente ya existe)
- `node-forge` — firmar CMS con certificado (o usar `crypto` nativo)

---

## 6. Ambientes AFIP

| Ambiente | WSAA Endpoint | WSFE Endpoint |
|----------|--------------|---------------|
| Testing (homologación) | https://wsaahomo.afip.gov.ar/ws/services/LoginCms | https://wswhomo.afip.gov.ar/wsfev1/service.asmx |
| Producción | https://wsaa.afip.gov.ar/ws/services/LoginCms | https://servicios1.afip.gov.ar/wsfev1/service.asmx |

---

## 7. Estimación de complejidad

| Componente | Complejidad | Notas |
|-----------|-------------|-------|
| WSAA Client | Alta | CMS signing, XML, token caching |
| WSFE Client | Alta | SOAP, mapeo complejo de datos |
| Config UI | Media | Upload certificados, test conexión |
| Integración confirmación | Media | Modificar flujo existente |
| PDF con código AFIP | Baja | Barcode interleaved 2of5 |
| Testing/homologación | Alta | Requiere CUIT de prueba AFIP |

**Estimación total:** Proyecto de 2-3 sesiones dedicadas.

---

## 8. Qué NO incluye

- FCEM (Factura de Crédito Electrónica MiPyME) — requiere otro web service
- Percepciones/retenciones automáticas en factura
- Nota de crédito/débito electrónica asociada (usa mismo WSFE pero flujo diferente)
- Consulta de CUIT en padrón AFIP (WSPCI)
