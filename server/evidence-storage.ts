import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from './env.js'

/**
 * Almacenamiento de los PDF de evidencia de los tickets. Los archivos viven en un directorio
 * privado (EVIDENCE_UPLOAD_DIR, por defecto var/evidence, fuera de la raíz pública y de Vite):
 * la API nunca expone esa ruta y la descarga pasa por un endpoint autenticado que relee el bytes
 * de disco. El nombre con el que se guarda lo genera el servidor (UUID + ".pdf"), de modo que ni
 * el nombre del archivo del cliente ni un id de la base pueden abrir un archivo arbitrario.
 *
 * Validación de la subida: extensión .pdf, MIME declarado application/pdf y firma real "%PDF-"
 * al inicio del bytes, además del tope de 10 MB. Las tres se comprueban ANTES de tocar disco; si
 * alguna falla no se escribe nada y la petición se rechaza con un estado claro (415/413/400).
 */

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
export const EVIDENCE_MIME_TYPE = 'application/pdf'

/** Error de validación de la subida, con su estado HTTP (413 tamaño, 415 tipo, 400 vacío). */
export class EvidenceValidationError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'EvidenceValidationError'
    this.status = status
  }
}

/** Directorio absoluto de evidencias, resuelto contra el directorio de trabajo del servidor. */
export const evidenceDirectory = (): string => path.resolve(env.EVIDENCE_UPLOAD_DIR)

/**
 * Ruta absoluta de un archivo guardado. El nombre se valida contra el patrón que solo puede
 * generar el servidor (UUID + ".pdf"): cualquier otra cadena (separadores, "..", rutas) hace
 * fallar la operación en lugar de salirse del directorio. Defensa en profundidad, no un control
 * principal: los nombres ya vienen de esta misma capa.
 */
export const evidenceFilePath = (storedName: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(storedName)) {
    throw new EvidenceValidationError(400, 'Referencia de archivo inválida')
  }
  return path.join(evidenceDirectory(), storedName)
}

const hasPdfSignature = (data: Buffer): boolean => data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-'

/**
 * Valida una subida sin tocar disco. Devuelve los valores ya saneados que se persisten (nombre
 * original visible, MIME y tamaño), de modo que la ruta no tenga que repetir comprobaciones.
 */
export const validateEvidenceUpload = (file: { filename: string; contentType: string | null; data: Buffer }): { filename: string; mimeType: string; size: number } => {
  if (file.data.length === 0) {
    throw new EvidenceValidationError(400, 'El archivo de evidencia está vacío')
  }
  if (file.data.length > MAX_EVIDENCE_BYTES) {
    throw new EvidenceValidationError(413, `El PDF supera el tamaño máximo de ${Math.floor(MAX_EVIDENCE_BYTES / (1024 * 1024))} MB`)
  }
  if (!/\.pdf$/i.test(file.filename)) {
    throw new EvidenceValidationError(415, 'La evidencia debe ser un archivo PDF (.pdf)')
  }
  if ((file.contentType ?? '').toLowerCase() !== EVIDENCE_MIME_TYPE) {
    throw new EvidenceValidationError(415, 'El archivo adjunto no tiene el tipo application/pdf')
  }
  if (!hasPdfSignature(file.data)) {
    throw new EvidenceValidationError(415, 'El contenido del archivo no corresponde a un PDF válido')
  }
  return { filename: file.filename, mimeType: EVIDENCE_MIME_TYPE, size: file.data.length }
}

/** Escribe el bytes con el nombre generado. "wx" falla si el archivo ya existiera: no pisar. */
export const writeEvidenceFile = async (storedName: string, data: Buffer): Promise<void> => {
  const target = evidenceFilePath(storedName)
  await mkdir(evidenceDirectory(), { recursive: true })
  await writeFile(target, data, { flag: 'wx', mode: 0o600 })
}

export const readEvidenceFile = async (storedName: string): Promise<Buffer> => readFile(evidenceFilePath(storedName))

/**
 * Borra los archivos indicados DESPUÉS de confirmar la escritura en base de datos (el orden es
 * siempre: la BD manda y el disco acompaña). Un ENOENT cuenta como borrado (ya no estaba); el
 * resto de fallos se devuelven para que el llamador los registre sin tumbar la operación: un
 * archivo huérfano en disco es preferible a dejar filas que apuntan a nada.
 */
export const removeEvidenceFiles = async (storedNames: readonly string[]): Promise<{ removed: string[]; failed: string[] }> => {
  const removed: string[] = []
  const failed: string[] = []
  for (const storedName of storedNames) {
    try {
      await unlink(evidenceFilePath(storedName))
      removed.push(storedName)
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        removed.push(storedName)
        continue
      }
      failed.push(storedName)
    }
  }
  return { removed, failed }
}

/** Nombre nuevo de archivo en disco: UUID (imprevisible e inyectable en la ruta con evidenceFilePath). */
export const nextStoredName = (): string => `${randomUUID()}.pdf`
