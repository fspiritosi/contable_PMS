/**
 * Descarga un archivo de texto para los aplicativos de ARCA (TSK-796).
 *
 * Los diseños de registro son de ancho fijo contado en bytes y ARCA los importa
 * en ANSI: en UTF-8 una "ñ" o una vocal acentuada ocupa dos bytes y corre todos
 * los campos que siguen. Por eso se codifica en Latin-1 (un byte por carácter);
 * lo que no entra en Latin-1 se reemplaza por "?". Cada registro termina en CRLF.
 */
export function encodeArcaTxt(content: string): Uint8Array<ArrayBuffer> {
  const text = (content ? `${content}\r\n` : '').normalize('NFC');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}

export function downloadArcaTxt(content: string, filename: string): void {
  const blob = new Blob([encodeArcaTxt(content)], { type: 'text/plain;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Cantidad de registros de un archivo ya armado (uno por línea). */
export function countRecords(content: string): number {
  return content ? content.split('\r\n').length : 0;
}
