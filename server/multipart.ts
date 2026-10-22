import type { Request } from 'express'

/**
 * Lector del cuerpo de una petición multipart/form-data, escrito a mano para no añadir una
 * dependencia (el proyecto no usa multer/busboy y solo express.json gestiona cuerpos). Vive en su
 * propio módulo para que server/evidence-storage.ts y las rutas de subida no tengan que conocer
 * el formato de las partes ni los límites de tamaño.
 *
 * Seguridad: el tope de tamaño se comprueba ANTES (Content-Length declarado) y DURANTE la lectura
 * (acumulando), así un cliente que mande un cuerpo enorme en trozos no puede llenar la memoria; si
 * se pasa, se deja de acumular, se drena la conexión dentro de un margen y se responde 413. El
 * nombre del archivo nunca se usa para abrir nada: aquí solo se conserva el basename saneado para
 * mostrarlo, y el nombre en disco lo genera el servidor con un UUID.
 */

/** Error de petición con estado HTTP propio; el middleware de errores de app.ts lo traduce a JSON. */
export class MultipartError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MultipartError'
    this.status = status
  }
}

/**
 * Techo de la petición completa: 10 MB de PDF + cabeceras de las partes + el resto de campos del
 * formulario. Un archivo de 10 MB exacto siempre cabe; por encima se rechaza antes de parsear.
 */
export const MAX_UPLOAD_REQUEST_BYTES = 11 * 1024 * 1024

/** Margen extra que se deja drenar tras superar el tope para poder responder 413 de forma limpia. */
const DRAIN_MARGIN_BYTES = 11 * 1024 * 1024

export type MultipartPart = {
  fieldName: string
  filename: string | null
  contentType: string | null
  data: Buffer
}

/**
 * Solo el nombre base del archivo: se descartan directorios (tanto "/" como "\"), controles,
 * comillas y rutas relativas. Nunca se devuelve vacío: si lo que llega no deja nada utilizable se
 * usa un nombre genérico. El límite de longitud evita cabeceras de respuesta desmedidas.
 */
export const sanitizeUploadFilename = (rawFilename: string): string => {
  const base = rawFilename.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // Caracteres de control (incluidos CR/LF, que romperían la cabecera Content-Disposition):
    // la categoría Unicode Cc cubre C0 y C1 sin poner caracteres de control literales en la regex.
    .replace(/\p{Cc}/gu, '')
    // Comillas: el nombre viaja entre comillas en Content-Disposition.
    .replace(/["]/g, '')
    // Puntos iniciales: "./x", "../x" y ".." como nombre completo.
    .replace(/^\.+/, '')
    .trim()
  if (cleaned.length === 0) return 'documento'
  if (cleaned.length <= 150) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : ''
  return `${cleaned.slice(0, 150 - extension.length)}${extension}`
}

/** Boundary del header Content-Type; sin él no hay multipart que parsear. */
const boundaryOf = (contentTypeHeader: string): string => {
  if (!/^multipart\/form-data\b/i.test(contentTypeHeader.trim())) {
    throw new MultipartError(415, 'Se esperaba un formulario multipart/form-data con el PDF adjunto')
  }
  const match = /;\s*boundary=(?:"([^"]*)"|([^;]+))/i.exec(contentTypeHeader)
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim()
  if (!boundary) throw new MultipartError(400, 'El formulario multipart no define boundary')
  return boundary
}

type PartHeaders = { fieldName: string | null; filename: string | null; contentType: string | null }

const parsePartHeaders = (raw: string): PartHeaders => {
  const headers = new Map<string, string>()
  for (const line of raw.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  const disposition = headers.get('content-disposition') ?? ''
  const unquote = (value: string | undefined | null) => (value == null ? null : value.replace(/\\"/g, '"'))
  return {
    fieldName: unquote(/(?:^|;)\s*name="((?:[^"\\]|\\.)*)"/i.exec(disposition)?.[1] ?? null),
    filename: unquote(/(?:^|;)\s*filename="((?:[^"\\]|\\.)*)"/i.exec(disposition)?.[1] ?? null),
    contentType: headers.get('content-type') ?? null,
  }
}

/**
 * Lee el cuerpo sin acumular más allá del tope. Se descarta el Content-Length declarado si excede
 * (respuesta inmediata 413) y se corta la acumulación en cuanto el total lo supera, drenando
 * después un margen razonable para cerrar la petición con su respuesta 413 en lugar de cortar la
 * conexión sin avisar.
 */
export const readRequestBuffer = async (request: Request, limit: number): Promise<Buffer> => {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    throw new MultipartError(413, `El archivo supera el tamaño máximo permitido de ${Math.floor(limit / (1024 * 1024))} MB`)
  }
  const chunks: Buffer[] = []
  let size = 0
  let drained = 0
  let exceeded = false
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    if (exceeded) {
      drained += buffer.length
      // Margen agotado: no seguimos leyendo; el socket lo cierra Node al responder.
      if (drained > DRAIN_MARGIN_BYTES) break
      continue
    }
    size += buffer.length
    if (size > limit) {
      exceeded = true
      chunks.length = 0
      continue
    }
    chunks.push(buffer)
  }
  if (exceeded || size > limit) {
    throw new MultipartError(413, `El archivo supera el tamaño máximo permitido de ${Math.floor(limit / (1024 * 1024))} MB`)
  }
  return Buffer.concat(chunks)
}

/**
 * Partes del formulario. Cada parte se separa por "--boundary"; el contenido se toma como bytes
 * crudos (los PDF son binarios) y solo se inspeccionan las cabeceras. Las partes sin nombre se
 * ignoran: no hay nada que hacer con ellas y la ruta que usa este parser exige el archivo igual.
 */
export const parseMultipartFormData = (raw: Buffer, contentTypeHeader: string): MultipartPart[] => {
  const boundary = boundaryOf(contentTypeHeader)
  const delimiter = Buffer.from(`--${boundary}`)
  const parts: MultipartPart[] = []
  let cursor = raw.indexOf(delimiter)
  if (cursor < 0) throw new MultipartError(400, 'El formulario multipart no contiene la frontera declarada')
  while (cursor >= 0) {
    let position = cursor + delimiter.length
    if (raw[position] === 0x2d && raw[position + 1] === 0x2d) break
    if (raw[position] === 0x0d && raw[position + 1] === 0x0a) position += 2
    else if (raw[position] === 0x0a) position += 1
    const headerEnd = raw.indexOf('\r\n\r\n', position)
    if (headerEnd < 0) throw new MultipartError(400, 'El formulario multipart tiene una parte incompleta')
    const headers = parsePartHeaders(raw.subarray(position, headerEnd).toString('latin1'))
    const bodyStart = headerEnd + 4
    const next = raw.indexOf(delimiter, bodyStart)
    if (next < 0) throw new MultipartError(400, 'El formulario multipart no termina con la frontera declarada')
    let bodyEnd = next
    if (raw[bodyEnd - 2] === 0x0d && raw[bodyEnd - 1] === 0x0a) bodyEnd -= 2
    else if (raw[bodyEnd - 1] === 0x0a) bodyEnd -= 1
    if (headers.fieldName !== null) {
      parts.push({
        fieldName: headers.fieldName,
        filename: headers.filename,
        contentType: headers.contentType,
        data: raw.subarray(bodyStart, bodyEnd),
      })
    }
    cursor = next
  }
  return parts
}

/** Primera parte con nombre de campo concreto (o la primera adjunta, si la ruta no fija el nombre). */
export const findMultipartFile = (parts: readonly MultipartPart[], fieldName: string): MultipartPart | null => {
  const named = parts.find((part) => part.filename !== null && part.fieldName === fieldName)
  if (named) return named
  return parts.find((part) => part.filename !== null) ?? null
}
