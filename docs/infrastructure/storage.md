# Sistema de Almacenamiento

Archivos: `src/shared/config/storage.config.ts` y `src/shared/lib/storage.ts`

---

## Providers

| Provider | Uso | Detalles |
|----------|-----|---------|
| `s3` | MinIO (dev) o Cloudflare R2 (prod) | AWS SDK v3, path-style para MinIO |
| `local` | Legacy / sin Docker | Archivos en `./storage/uploads`, servidos via `/api/storage/*` |

Se controla con la variable `STORAGE_PROVIDER` (default: `local`).

---

## Configuracion

### MinIO (desarrollo)

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=http://localhost:9004
S3_REGION=us-east-1
S3_BUCKET=contable
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
S3_FORCE_PATH_STYLE=true          # Obligatorio para MinIO
S3_PUBLIC_URL=http://localhost:9004/contable
```

### Cloudflare R2 (produccion)

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=my-bucket
S3_ACCESS_KEY=<r2-access-key>
S3_SECRET_KEY=<r2-secret-key>
S3_FORCE_PATH_STYLE=false         # R2 usa virtual-hosted style
S3_PUBLIC_URL=https://cdn.example.com
```

### Local (fallback)

```env
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./storage/uploads
```

Archivos se sirven via la API route `/api/storage/[...path]`.

---

## API Publica

```typescript
import { uploadFile, deleteFile, getPresignedDownloadUrl, getPresignedUploadUrl } from '@/shared/lib/storage';
```

### Upload

```typescript
const result = await uploadFile(buffer, filename, {
  folder: 'empresa/documentos',
  contentType: 'application/pdf',
  useUniqueFilename: true,  // default: true
});
// result: { key, url, filename }
```

### Download (presigned URL)

```typescript
const url = await getPresignedDownloadUrl(fileKey, {
  expiresIn: 3600,  // 1 hora (default)
  filename: 'mi-archivo.pdf',
});
```

### Upload presigned (subida directa del browser)

```typescript
const { url, key } = await getPresignedUploadUrl(filename, {
  folder: 'temp',
  contentType: 'image/jpeg',
  expiresIn: 3600,
});
// El browser sube directo a S3/MinIO usando la URL
```

### Eliminar

```typescript
await deleteFile(fileKey);
```

---

## Path Builders

Funciones que generan rutas de almacenamiento consistentes:

| Funcion | Formato | Ejemplo |
|---------|---------|---------|
| `buildEmployeeDocumentPath()` | `{company}/{tipo-doc}/{empleado-dni}/{file}` | `acme-sa/licencia-conducir/juan-perez-12345678/2024-01-15-lic.pdf` |
| `buildEquipmentDocumentPath()` | `{company}/{tipo-doc}/{vehiculo-patente}/{file}` | `acme-sa/vtv/scania-abc123/vtv-2024.pdf` |
| `buildCompanyDocumentPath()` | `{company}/empresa/{tipo-doc}/{file}` | `acme-sa/empresa/habilitacion-cnrt/hab.pdf` |
| `buildCommercialDocumentPath()` | `{company}/comercial/{tipo}/{numero}/{file}` | `acme-sa/comercial/facturas-compra/0001-00000123/factura.pdf` |

Todas aplican slugificacion automatica (sin acentos, lowercase, guiones).

---

## Limites y Validacion

- **Tamano maximo:** 10 MB
- **Tipos permitidos:** JPEG, PNG, WebP, GIF, PDF, DOC, DOCX, XLS, XLSX
- **Presigned URLs:** Expiran en 1 hora (3600 segundos)

```typescript
import { validateFile } from '@/shared/lib/storage';

const { valid, error } = validateFile({
  size: file.size,
  type: file.type,
  name: file.name,
});
```

---

## Server Actions de Storage

Archivo: `src/shared/actions/storage.ts`

Estas actions son llamadas desde Client Components para manejar uploads:

```typescript
import { getUploadUrl, getDownloadUrl } from '@/shared/actions/storage';

// Obtener URL para subir archivo
const { url, key } = await getUploadUrl(filename, folder);

// Obtener URL para descargar archivo
const url = await getDownloadUrl(fileKey);
```
