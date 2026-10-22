const testEvidenceDir = vi.hoisted(() => {
  // El directorio de evidencia se decide en importación (env.ts parsea process.env al cargarlo):
  // hay que fijarlo ANTES de que entren los módulos. Fuera del árbol del proyecto: var/ está en
  // .gitignore y cada corrida usa su propio subdirectorio, que se borra al terminar.
  const dir = `var/evidence-test-${process.pid}`
  process.env.EVIDENCE_UPLOAD_DIR = dir
  return dir
})

import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request } from 'express'
import type { PrismaClient, Role } from '@prisma/client'
import { createApp } from './app.js'
import { MAX_EVIDENCE_BYTES, evidenceDirectory, evidenceFilePath, removeEvidenceFiles, validateEvidenceUpload, writeEvidenceFile } from './evidence-storage.js'
import { readRequestBuffer, sanitizeUploadFilename } from './multipart.js'

/**
 * Pruebas del flujo de evidencia PDF de los tickets: subida (multipart propio + validación),
 * lista, descarga, borrado, aislamiento entre empresas, lista por plan de mitigación y limpieza
 * del disco. El gate 409 tiene su propia batería en mitigation-plan.test.ts, donde el arnés ya
 * modela riesgos, planes y actividades; aquí el foco es el archivo y los permisos.
 *
 * El disco es real (un directorio temporal por corrida) porque la seguridad del módulo está en
 * cómo escribe y borra bytes, no solo en cómo responde.
 */

const companyId = 'cmcompanyevidence000000001'
const otherCompanyId = 'cmcompanyevidence000000002'
const processId = 'cmprocessevidence000000001'
const foreignProcessId = 'cmprocessevidence000000002'
const riskId = 'cmriskevidence0000000000001'
const otherRiskId = 'cmriskevidence0000000000002'

const creator = { id: 'cmuserevidence0000000001', email: 'creator@evidence.test', name: 'Ana Creadora', role: 'COMPANY_USER' as Role, companyId }
const assignee = { id: 'cmuserevidence0000000002', email: 'assignee@evidence.test', name: 'Beto Responsable', role: 'COMPANY_USER' as Role, companyId }
const foreignUser = { id: 'cmuserevidence0000000003', email: 'foreign@evidence.test', name: 'Fer Ajena', role: 'COMPANY_USER' as Role, companyId: otherCompanyId }
const superuser = { id: 'cmuserevidence0000000004', email: 'global@evidence.test', name: 'Sol Super', role: 'SUPERUSER' as Role, companyId: null }
const users = [creator, assignee, foreignUser, superuser]
const passwordHash = bcrypt.hashSync('Password123!', 4)

const ticketId = 'cmticketevidence000000001'
const assignedTicketId = 'cmticketevidence000000002'
const otherRiskTicketId = 'cmticketevidence000000003'
const foreignTicketId = 'cmticketevidence000000004'

/**
 * Ticket del arnés. `companyId` es el stand-in del par creador/responsable (lo que en producción
 * resuelve scopeForUser/canAccessTicket) y `riskId` el stand-in del enlace ticket.actionItemId ->
 * actionItem.actionPlan.riskId: marca a los tickets cuyo plan pertenece a ese riesgo.
 */
type StoredTicket = { id: string; title: string; companyId: string; createdById: string; assignedToId: string | null; riskId: string | null }
type StoredEvidence = { id: string; ticketId: string; filename: string; storedName: string; mimeType: string; size: number; uploadedById: string; createdAt: Date }

const baseTickets = (): Record<string, StoredTicket> => ({
  [ticketId]: { id: ticketId, title: 'Instalar extractor', companyId, createdById: creator.id, assignedToId: null, riskId },
  [assignedTicketId]: { id: assignedTicketId, title: 'Capacitar al equipo', companyId, createdById: creator.id, assignedToId: assignee.id, riskId },
  [otherRiskTicketId]: { id: otherRiskTicketId, title: 'Actividad de otro riesgo', companyId, createdById: creator.id, assignedToId: null, riskId: otherRiskId },
  // Ticket de otra empresa colgado del mismo plan: el alcance por empresa debe descartarlo.
  [foreignTicketId]: { id: foreignTicketId, title: 'Actividad ajena', companyId: otherCompanyId, createdById: foreignUser.id, assignedToId: null, riskId },
})

function makeEvidenceDb() {
  const sessions = new Map<string, string>()
  const tickets = baseTickets()
  const evidenceRows: StoredEvidence[] = []
  let nextEvidence = 1

  const viewTicket = (stored: StoredTicket) => {
    const owner = users.find((user) => user.id === stored.createdById) ?? creator
    const assigneeUser = stored.assignedToId ? users.find((user) => user.id === stored.assignedToId) ?? null : null
    return {
      ...stored,
      createdBy: { id: owner.id, name: owner.name, email: owner.email, companyId: owner.companyId },
      assignedTo: assigneeUser ? { id: assigneeUser.id, name: assigneeUser.name, email: assigneeUser.email, companyId: assigneeUser.companyId } : null,
      actionItem: null,
      riskApprovals: [],
    }
  }

  /**
   * La fila tal y como la devuelve Prisma con `include`: escalares completos (incluido storedName,
   * que las rutas vuelcan fuera con evidenceView) más las relaciones. Las rutas de la API aplican
   * su propia vista encima, igual que en producción.
   */
  const evidenceWithRelations = (row: StoredEvidence) => {
    const uploader = users.find((user) => user.id === row.uploadedById) ?? creator
    const ticket = tickets[row.ticketId]
    return {
      ...row,
      uploadedBy: { id: uploader.id, name: uploader.name },
      ticket: ticket ? { id: ticket.id, title: ticket.title } : null,
    }
  }

  /**
   * Filtro del listado por plan: el real viene como { ticket: { AND: [alcanceDeEmpresa, planDelRiesgo] } }
   * y el arnés lo traduce a las dos condiciones que le importan. El alcance se resuelve contra la
   * empresa del ticket (el stand-in del arnés por creador/responsable) y el plan contra el riesgo
   * con el que el arnés marca al ticket como enlazado a un actionItem de ese plan.
   */
  const planScopeRows = (where: { ticket?: { AND?: unknown[] } } | undefined) => {
    const conditions = (where?.ticket?.AND ?? []) as Array<Record<string, unknown>>
    const scope = conditions.find((condition) => 'OR' in condition) as { OR?: Array<Record<string, { companyId?: string }>> } | undefined
    const plan = conditions.find((condition) => 'actionItem' in condition) as { actionItem?: { actionPlan?: { riskId?: string } } } | undefined
    const planRiskId = plan?.actionItem?.actionPlan?.riskId
    const scopeCompanies = scope?.OR?.flatMap((clause) => [clause.createdBy?.companyId, clause.assignedTo?.companyId].filter(Boolean) as string[]) ?? null
    return evidenceRows
      .filter((row) => {
        const ticket = tickets[row.ticketId]
        if (!ticket) return false
        if (planRiskId && ticket.riskId !== planRiskId) return false
        if (scopeCompanies && !scopeCompanies.includes(ticket.companyId)) return false
        return true
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(evidenceWithRelations)
  }

  const db = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const user = where.email ? users.find((item) => item.email === where.email) : users.find((item) => item.id === where.id)
        return user ? { ...user, passwordHash } : null
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => users.filter((user) => where.id.in.includes(user.id)).map((user) => ({ id: user.id }))),
    },
    session: {
      create: vi.fn(async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => {
        sessions.set(data.tokenHash, data.userId)
        return { id: 'cmsessionevidence0000001', expiresAt: data.expiresAt }
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const user = users.find((item) => item.id === sessions.get(where.tokenHash))
        return user ? { id: 'cmsessionevidence0000001', expiresAt: new Date(Date.now() + 3600_000), user: { ...user } } : null
      }),
      delete: vi.fn(async () => ({ id: 'cmsessionevidence0000001' })),
      deleteMany: vi.fn(async () => { sessions.clear(); return { count: 1 } }),
    },
    process: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === processId) return { id: processId, companyId, company: { id: companyId } }
        if (where.id === foreignProcessId) return { id: foreignProcessId, companyId: otherCompanyId, company: { id: otherCompanyId } }
        return null
      }),
    },
    risk: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === riskId) return { id: riskId, processId }
        if (where.id === otherRiskId) return { id: otherRiskId, processId }
        return null
      }),
    },
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; actionItemId?: string } }) => {
        const stored = where.id ? tickets[where.id] : null
        return stored ? viewTicket(stored) : null
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        delete tickets[where.id]
        // Cascada real de TicketEvidenceFile (onDelete: Cascade): el ticket se lleva sus filas.
        for (let index = evidenceRows.length - 1; index >= 0; index -= 1) {
          if (evidenceRows[index]!.ticketId === where.id) evidenceRows.splice(index, 1)
        }
        return { id: where.id }
      }),
    },
    ticketEvidenceFile: {
      create: vi.fn(async ({ data }: { data: { ticketId: string; filename: string; storedName: string; mimeType: string; size: number; uploadedById: string } }) => {
        const row: StoredEvidence = { id: `cmevidencefile${String(nextEvidence).padStart(21, '0')}`, createdAt: new Date(Date.now() + nextEvidence * 1000), ...data }
        nextEvidence += 1
        evidenceRows.push(row)
        return evidenceWithRelations(row)
      }),
      findMany: vi.fn(async (args?: { where?: { ticketId?: string } & Record<string, unknown>; orderBy?: unknown }) => {
        if (args?.where?.ticketId) {
          return evidenceRows.filter((row) => row.ticketId === args.where?.ticketId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(evidenceWithRelations)
        }
        return planScopeRows(args?.where as { ticket?: { AND?: unknown[] } } | undefined)
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; ticketId?: string } }) => {
        const row = evidenceRows.find((candidate) => (where.id ? candidate.id === where.id : true) && (where.ticketId ? candidate.ticketId === where.ticketId : true))
        return row ? evidenceWithRelations(row) : null
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = evidenceRows.findIndex((row) => row.id === where.id)
        if (index < 0) throw new Error('Record to delete not found.')
        const [removed] = evidenceRows.splice(index, 1)
        return removed
      }),
      count: vi.fn(async () => evidenceRows.length),
    },
    // Ningún fallo de escritura se prueba aquí: las rutas de evidencia no usan transacciones
    // (la subida escribe disco primero y la fila después; el borrado, la fila primero).
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => operation(db)),
  }

  return { db: db as unknown as PrismaClient, state: { tickets, evidenceRows } }
}

type TestAgent = ReturnType<typeof request.agent>

async function loggedIn(db: PrismaClient, email: string): Promise<TestAgent> {
  const agent = request.agent(createApp(db))
  await agent.post('/api/auth/login').send({ email, password: 'Password123!' })
  return agent
}

const boundary = '----EvidentiaEvidenceBoundary'
type MultipartField = { name: string; filename?: string; contentType?: string; data: Buffer | string }

const buildMultipart = (fields: MultipartField[]): Buffer => {
  const chunks: Buffer[] = []
  for (const field of fields) {
    const disposition = `Content-Disposition: form-data; name="${field.name}"${field.filename !== undefined ? `; filename="${field.filename}"` : ''}`
    const headers = field.contentType ? `${disposition}\r\nContent-Type: ${field.contentType}` : disposition
    chunks.push(Buffer.from(`--${boundary}\r\n${headers}\r\n\r\n`))
    chunks.push(Buffer.isBuffer(field.data) ? field.data : Buffer.from(field.data))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

const validPdf = (bytes = 512): Buffer => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, bytes - 8), 0x20)])
const uploadPath = (id: string) => `/api/tickets/${id}/evidence`
const sendUpload = (agent: TestAgent, id: string, fields: MultipartField[]) =>
  agent.post(uploadPath(id)).set('Content-Type', `multipart/form-data; boundary=${boundary}`).send(buildMultipart(fields))

const pdfField = (filename: string, contentType: string, data: Buffer): MultipartField => ({ name: 'file', filename, contentType, data })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(testEvidenceDir, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(testEvidenceDir, { recursive: true, force: true })
})

describe('subida de evidencia PDF', () => {
  it('guarda el PDF en el directorio privado y lo lista por ticket', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    const content = validPdf()
    const response = await sendUpload(agent, ticketId, [pdfField('informe de extractor.pdf', 'application/pdf', content)])
    expect(response.status).toBe(201)
    expect(response.body.evidence).toMatchObject({ ticketId, filename: 'informe de extractor.pdf', mimeType: 'application/pdf', size: content.length, uploadedBy: { id: creator.id, name: creator.name } })
    // El nombre en disco nunca se expone al cliente.
    expect(response.body.evidence).not.toHaveProperty('storedName')

    // El archivo vive fuera de la raíz pública con nombre generado por el servidor.
    const files = await readdir(evidenceDirectory())
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(await readFile(path.join(evidenceDirectory(), files[0]!))).toEqual(content)

    const list = await agent.get(uploadPath(ticketId))
    expect(list.status).toBe(200)
    expect(list.body.evidence).toHaveLength(1)
    expect(list.body.evidence[0]).toMatchObject({ filename: 'informe de extractor.pdf', ticket: { id: ticketId, title: 'Instalar extractor' } })
    expect(list.body.evidence[0]).not.toHaveProperty('storedName')
  })

  it('sanea el nombre original y descarta rutas', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    const response = await sendUpload(agent, ticketId, [pdfField('..\\..\\tmp\\informe.pdf', 'application/pdf', validPdf())])
    expect(response.status).toBe(201)
    expect(response.body.evidence.filename).toBe('informe.pdf')

    // El nombre saneado es el que se anuncia al descargar.
    const download = await agent.get(`${uploadPath(ticketId)}/${response.body.evidence.id}`)
    expect(download.headers['content-disposition']).toBe('attachment; filename="informe.pdf"')

    // Un nombre con saltos de línea no genera registro: rompe las cabeceras de la parte del
    // formulario y la subida se descarta sin tocar disco.
    const injected = await sendUpload(agent, ticketId, [pdfField('infor\r\nevil.pdf', 'application/pdf', validPdf())])
    expect(injected.status).toBe(400)
    expect((await agent.get(uploadPath(ticketId))).body.evidence).toHaveLength(1)
  })

  it('permite subir al responsable del ticket aunque no lo haya creado', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, assignee.email)

    const response = await sendUpload(agent, assignedTicketId, [pdfField('capacitacion.pdf', 'application/pdf', validPdf())])
    expect(response.status).toBe(201)
    expect(response.body.evidence.uploadedBy.id).toBe(assignee.id)
  })

  it('rechaza un cuerpo que no es multipart/form-data y un formulario sin archivo', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    const wrongType = await agent.post(uploadPath(ticketId)).set('Content-Type', 'application/json').send('{"file":"x"}')
    expect(wrongType.status).toBe(415)

    const noFile = await sendUpload(agent, ticketId, [{ name: 'comentario', data: 'sin archivo' }])
    expect(noFile.status).toBe(400)
    expect(noFile.body.error).toContain('file')
  })

  it('rechaza lo que no es un PDF: extensión, MIME declarado y firma real', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    const wrongExtension = await sendUpload(agent, ticketId, [pdfField('informe.txt', 'application/pdf', validPdf())])
    expect(wrongExtension.status).toBe(415)

    const wrongMime = await sendUpload(agent, ticketId, [pdfField('informe.pdf', 'text/plain', validPdf())])
    expect(wrongMime.status).toBe(415)

    const impostor = await sendUpload(agent, ticketId, [pdfField('informe.pdf', 'application/pdf', Buffer.from('MZ\x90\x00esto no es un PDF'))])
    expect(impostor.status).toBe(415)
    expect(impostor.body.error).toContain('PDF')

    expect((await agent.get(uploadPath(ticketId))).body.evidence).toHaveLength(0)
    await expect(stat(evidenceDirectory())).rejects.toThrow()
  })

  it('rechaza archivos por encima de 10 MB sin escribir nada', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    const oversized = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_EVIDENCE_BYTES)])
    const response = await sendUpload(agent, ticketId, [pdfField('grande.pdf', 'application/pdf', oversized)])
    expect(response.status).toBe(413)
    expect(response.body.error).toContain('10 MB')
    expect((await agent.get(uploadPath(ticketId))).body.evidence).toHaveLength(0)
  })

  it('exige sesión para subir, listar o descargar', async () => {
    const { db } = makeEvidenceDb()
    const anonymous = request.agent(createApp(db))

    expect((await sendUpload(anonymous, ticketId, [pdfField('informe.pdf', 'application/pdf', validPdf())])).status).toBe(401)
    expect((await anonymous.get(uploadPath(ticketId))).status).toBe(401)
    expect((await anonymous.get(`${uploadPath(ticketId)}/cmevidencefile0000000000000000001`)).status).toBe(401)
  })
})

describe('aislamiento de la evidencia entre empresas', () => {
  it('una usuaria de otra empresa no ve, sube, descarga ni borra evidencia ajena', async () => {
    const { db, state } = makeEvidenceDb()
    const owner = await loggedIn(db, creator.email)
    const uploaded = await sendUpload(owner, ticketId, [pdfField('interno.pdf', 'application/pdf', validPdf())])
    expect(uploaded.status).toBe(201)
    const evidenceId = uploaded.body.evidence.id

    const intruder = await loggedIn(db, foreignUser.email)
    expect((await intruder.get(uploadPath(ticketId))).status).toBe(404)
    expect((await sendUpload(intruder, ticketId, [pdfField('intruso.pdf', 'application/pdf', validPdf())])).status).toBe(404)
    expect((await intruder.get(`${uploadPath(ticketId)}/${evidenceId}`)).status).toBe(404)
    expect((await intruder.delete(`${uploadPath(ticketId)}/${evidenceId}`)).status).toBe(404)
    expect(state.evidenceRows).toHaveLength(1)
  })

  it('el listado por plan respeta el alcance de empresa: descarta tickets de otra empresa', async () => {
    const { db, state } = makeEvidenceDb()
    const ownEvidenceId = 'cmevidencefilemiampa000000001'
    const foreignEvidenceId = 'cmevidencefileajena0000000001'
    const otherRiskEvidenceId = 'cmevidencefileotro00000000001'
    const row = (id: string, storedTicketId: string, offset: number): StoredEvidence => ({ id, ticketId: storedTicketId, filename: `${id}.pdf`, storedName: `${randomUUID()}.pdf`, mimeType: 'application/pdf', size: 100, uploadedById: creator.id, createdAt: new Date(Date.parse('2026-10-01T10:00:00.000Z') + offset) })
    state.evidenceRows.push(row(ownEvidenceId, ticketId, 0), row(foreignEvidenceId, foreignTicketId, 1000), row(otherRiskEvidenceId, otherRiskTicketId, 2000))

    const agent = await loggedIn(db, creator.email)
    const response = await agent.get(`/api/processes/${processId}/risks/${riskId}/plan-evidence`)
    expect(response.status).toBe(200)
    expect(response.body.evidence.map((evidence: { id: string }) => evidence.id)).toEqual([ownEvidenceId])
    expect(response.body.evidence[0]).not.toHaveProperty('storedName')

    // Un superusuario ve también la evidencia de la empresa ajena (sigue sin ver la de otro riesgo).
    const global = await loggedIn(db, superuser.email)
    const all = await global.get(`/api/processes/${processId}/risks/${riskId}/plan-evidence`)
    expect(all.status).toBe(200)
    expect(all.body.evidence.map((evidence: { id: string }) => evidence.id)).toEqual([foreignEvidenceId, ownEvidenceId])
  })

  it('el listado por plan protege el proceso y el riesgo ajenos', async () => {
    const { db } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)

    expect((await agent.get(`/api/processes/${foreignProcessId}/risks/${riskId}/plan-evidence`)).status).toBe(404)
    expect((await agent.get(`/api/processes/${processId}/risks/${riskId}x/plan-evidence`)).status).toBe(404)
    expect((await agent.get(`/api/processes/${processId}/risks/${otherRiskId}/plan-evidence`)).status).toBe(200)
  })
})

describe('descarga y borrado de evidencia', () => {
  it('descarga el PDF con sus cabeceras y lo borra junto con el archivo', async () => {
    const { db, state } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)
    const content = validPdf()
    const uploaded = await sendUpload(agent, ticketId, [pdfField('informe.pdf', 'application/pdf', content)])
    const evidenceId = uploaded.body.evidence.id

    const download = await agent.get(`${uploadPath(ticketId)}/${evidenceId}`)
    expect(download.status).toBe(200)
    expect(download.headers['content-type']).toContain('application/pdf')
    expect(download.headers['content-disposition']).toBe('attachment; filename="informe.pdf"')
    expect(download.headers['x-content-type-options']).toBe('nosniff')
    expect(download.headers['cache-control']).toContain('private')
    expect(download.headers['content-length']).toBe(String(content.length))
    // superagent parsea application/pdf con su parser binario: el cuerpo llega como Buffer.
    const downloaded = Buffer.isBuffer(download.body) ? download.body : Buffer.alloc(0)
    expect(downloaded.equals(content)).toBe(true)

    const removed = await agent.delete(`${uploadPath(ticketId)}/${evidenceId}`)
    expect(removed.status).toBe(204)
    expect(state.evidenceRows).toHaveLength(0)
    expect(await readdir(evidenceDirectory())).toHaveLength(0)
    expect((await agent.get(`${uploadPath(ticketId)}/${evidenceId}`)).status).toBe(404)
    expect((await agent.delete(`${uploadPath(ticketId)}/${evidenceId}`)).status).toBe(404)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('la descarga no cruza tickets: la evidencia de otro ticket da 404', async () => {
    const { db, state } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)
    state.evidenceRows.push({ id: 'cmevidencefiledelotrot00001', ticketId: otherRiskTicketId, filename: 'otro.pdf', storedName: `${randomUUID()}.pdf`, mimeType: 'application/pdf', size: 10, uploadedById: creator.id, createdAt: new Date() })

    expect((await agent.get(`${uploadPath(ticketId)}/cmevidencefiledelotrot00001`)).status).toBe(404)
  })

  it('una fila sin archivo detrás responde 404 y no 500', async () => {
    const { db, state } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)
    state.evidenceRows.push({ id: 'cmevidencefilefantasma0000001', ticketId, filename: 'fantasma.pdf', storedName: `${randomUUID()}.pdf`, mimeType: 'application/pdf', size: 10, uploadedById: creator.id, createdAt: new Date() })

    const response = await agent.get(`${uploadPath(ticketId)}/cmevidencefilefantasma0000001`)
    expect(response.status).toBe(404)
    expect(response.body.error).toContain('no está disponible')
  })
})

describe('limpieza de archivos al eliminar', () => {
  it('eliminar el ticket borra su evidencia en base de datos y en disco', async () => {
    const { db, state } = makeEvidenceDb()
    const agent = await loggedIn(db, creator.email)
    const uploaded = await sendUpload(agent, ticketId, [pdfField('informe.pdf', 'application/pdf', validPdf())])
    expect(uploaded.status).toBe(201)
    expect(await readdir(evidenceDirectory())).toHaveLength(1)

    const deleted = await agent.delete(`/api/tickets/${ticketId}`)
    expect(deleted.status).toBe(204)
    expect(state.evidenceRows).toHaveLength(0)
    expect(await readdir(evidenceDirectory())).toHaveLength(0)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('si el archivo no se puede borrar, la fila sale igual y el fallo queda registrado', async () => {
    const { db, state } = makeEvidenceDb()
    // Un directorio con el nombre del archivo no se puede desvincular: es el caso real de un
    // disco con problemas (EPERM en Windows, EISDIR/EBUSY en Unix).
    const stubbornName = `${randomUUID()}.pdf`
    await mkdir(evidenceFilePath(stubbornName), { recursive: true })
    state.evidenceRows.push({ id: 'cmevidencefilebloqueada0000001', ticketId, filename: 'bloqueada.pdf', storedName: stubbornName, mimeType: 'application/pdf', size: 10, uploadedById: creator.id, createdAt: new Date() })

    const agent = await loggedIn(db, creator.email)
    const deleted = await agent.delete(`/api/tickets/${ticketId}`)
    expect(deleted.status).toBe(204)
    expect(state.evidenceRows).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
  })

  it('removeEvidenceFiles distingue lo que ya no estaba de lo que no se pudo borrar', async () => {
    const missing = `${randomUUID()}.pdf`
    const ok = `${randomUUID()}.pdf`
    const blocked = `${randomUUID()}.pdf`
    await writeEvidenceFile(ok, validPdf())
    await mkdir(evidenceFilePath(blocked), { recursive: true })

    const result = await removeEvidenceFiles([missing, ok, blocked])
    expect(result.removed).toEqual([missing, ok])
    expect(result.failed).toEqual([blocked])
    expect(await readdir(evidenceDirectory())).toEqual([path.basename(blocked)])
  })
})

describe('validación de PDF como unidad', () => {
  it('acepta un PDF válido y rechaza el resto con su estado', () => {
    const good = validateEvidenceUpload({ filename: 'informe.pdf', contentType: 'application/pdf', data: validPdf() })
    expect(good).toEqual({ filename: 'informe.pdf', mimeType: 'application/pdf', size: good.size })

    expect(() => validateEvidenceUpload({ filename: 'informe.pdf', contentType: 'application/pdf', data: Buffer.alloc(0) })).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => validateEvidenceUpload({ filename: 'informe.pdf', contentType: 'application/pdf', data: Buffer.alloc(MAX_EVIDENCE_BYTES + 1, 0x20) })).toThrow(expect.objectContaining({ status: 413 }))
    expect(() => validateEvidenceUpload({ filename: 'informe.exe', contentType: 'application/pdf', data: validPdf() })).toThrow(expect.objectContaining({ status: 415 }))
    expect(() => validateEvidenceUpload({ filename: 'informe.pdf', contentType: 'application/octet-stream', data: validPdf() })).toThrow(expect.objectContaining({ status: 415 }))
    expect(() => validateEvidenceUpload({ filename: 'informe.pdf', contentType: 'application/pdf', data: Buffer.from('hola mundo') })).toThrow(expect.objectContaining({ status: 415 }))
  })
})

describe('nombre de archivo saneado', () => {
  it('se queda con el base, sin directorios, controles ni comillas', () => {
    expect(sanitizeUploadFilename('..\\..\\tmp\\informe.pdf')).toBe('informe.pdf')
    expect(sanitizeUploadFilename('/var/log/informe.pdf')).toBe('informe.pdf')
    expect(sanitizeUploadFilename('infor\rme.pdf')).toBe('informe.pdf')
    expect(sanitizeUploadFilename('"comillas".pdf')).toBe('comillas.pdf')
    expect(sanitizeUploadFilename('...')).toBe('documento')
    expect(sanitizeUploadFilename('')).toBe('documento')
    // La cabecera de descarga no puede crecer sin límite.
    expect(sanitizeUploadFilename(`${'a'.repeat(400)}.pdf`)).toHaveLength(150)
  })
})

describe('límite de tamaño de la petición de subida', () => {
  /** Cuerpo que llega en trozos, como una petición real que no declara Content-Length. */
  const streamedRequest = (chunks: Buffer[], consumed: { value: boolean }): Request =>
    ({
      headers: {},
      [Symbol.asyncIterator]: async function* () {
        consumed.value = true
        for (const chunk of chunks) yield chunk
      },
    }) as unknown as Request

  it('corta la acumulación y responde 413 cuando el cuerpo pasa del tope', async () => {
    const consumed = { value: false }
    await expect(readRequestBuffer(streamedRequest([Buffer.alloc(600), Buffer.alloc(600)], consumed), 1024)).rejects.toThrow(expect.objectContaining({ status: 413 }))
    expect(consumed.value).toBe(true)
  })

  it('rechaza por Content-Length declarado sin llegar a leer el cuerpo', async () => {
    const consumed = { value: false }
    const request = { headers: { 'content-length': '999999' }, [Symbol.asyncIterator]: async function* () { consumed.value = true; yield Buffer.alloc(1) } } as unknown as Request
    await expect(readRequestBuffer(request, 1024)).rejects.toThrow(expect.objectContaining({ status: 413 }))
    expect(consumed.value).toBe(false)
  })
})
