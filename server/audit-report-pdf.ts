import type { AuditReportSnapshot } from './audit-report-contract.js'

const stripDiacritics = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const pdfText = (value: string): string => stripDiacritics(value).replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&').replace(/[\r\n]+/g, ' ')

const wrap = (value: string, width = 92): string[] => {
  const words = stripDiacritics(value || 'Sin información').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['Sin información']
}

const dateLabel = (value: string | null): string => value ? new Date(value).toLocaleDateString('es-CO') : 'Sin fecha'
const valueLabel = (value: string | null | undefined): string => value?.trim() ? value : 'Sin información'

type PdfPage = { content: string }

export const generateAuditReportPdf = (snapshot: AuditReportSnapshot, version: number): Buffer => {
  const pages: PdfPage[] = []
  let commands: string[] = []
  let y = 754
  const addPage = () => {
    if (commands.length > 0) pages.push({ content: commands.join('\n') })
    commands = []
    y = 754
    commands.push('q 0.035 0.10 0.18 rg 0 790 595 52 re f Q')
    commands.push('BT 1 1 1 rg /F2 18 Tf 42 814 Td (EvidentIA) Tj ET')
    commands.push('BT 0.82 0.90 0.94 rg /F1 8 Tf 42 800 Td (Informe oficial de auditoria) Tj ET')
    commands.push(`BT 0.82 0.90 0.94 rg /F1 8 Tf 430 814 Td (Version ${version}) Tj ET`)
  }
  const text = (line: string, size = 9, bold = false, color = '0.12 0.16 0.22') => {
    if (y < 72) addPage()
    commands.push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf 42 ${y} Td (${pdfText(line)}) Tj ET`)
    y -= size + 5
  }
  const paragraph = (label: string, value: string | null | undefined) => {
    text(label, 10, true, '0.04 0.36 0.48')
    for (const line of wrap(valueLabel(value))) text(line, 9)
    y -= 5
  }
  const heading = (label: string) => {
    if (y < 110) addPage()
    y -= 6
    text(label.toUpperCase(), 12, true, '0.04 0.36 0.48')
    y -= 2
  }

  addPage()
  const official = snapshot.official
  heading('Identificacion')
  text(`${official.identification.code} · ${official.identification.title}`, 11, true)
  text(`Proceso: ${official.identification.process.code ?? 'Sin codigo'} · ${official.identification.process.name}`)
  text(`Tipo: ${valueLabel(official.identification.auditType)} | Fecha planificada: ${dateLabel(official.dates.plannedDate)} | Inicio: ${dateLabel(official.dates.startDate)}`)
  paragraph('Alcance', official.scope)
  paragraph('Objetivos', official.objectives)
  paragraph('Criterios', official.criteria)

  heading('Equipo auditor e independencia')
  for (const member of official.team) text(`${member.name} · ${member.role} · Independencia: ${member.independenceStatus}`)
  if (official.team.length === 0) text('No hay integrantes registrados.')

  heading('Procesos, procedimientos y plan')
  text(`Procesos: ${official.processes.map((item) => `${item.code ?? 'Sin codigo'} · ${item.name}`).join('; ') || 'Ninguno'}`)
  text(`Procedimientos: ${official.procedures.map((item) => `${item.code} · ${item.name}`).join('; ') || 'Ninguno'}`)
  if (official.plan) {
    text(`Metodologia: ${valueLabel(official.plan.methodology)} | Estado: ${valueLabel(official.plan.status)}`)
    for (const activity of official.plan.activities) text(`Actividad: ${activity.title} · ${activity.status} · ${dateLabel(activity.scheduledStart)} - ${dateLabel(activity.scheduledEnd)}`)
  } else text('No hay plan de auditoria registrado.')

  heading('Resultados del checklist')
  text(`Evaluados: ${official.results.checklistEvaluated}/${official.results.checklistTotal} | Conformes: ${official.results.conform} | No conformes: ${official.results.nonConform}`)
  for (const checklist of official.checklists) {
    text(checklist.name, 10, true)
    for (const item of checklist.items) text(`${item.result} · ${item.description}`)
  }

  heading('Hallazgos, evidencias y tratamiento')
  text(`Hallazgos: ${official.results.findingsTotal} | Pendientes: ${official.results.findingsOpen}`)
  for (const finding of official.findings) {
    text(`${finding.severity} · ${finding.title} · ${finding.status}`, 10, true)
    for (const line of wrap(finding.description, 88)) text(line, 9)
    text(`Responsable: ${finding.responsible?.name ?? 'Sin asignar'} | Vencimiento: ${dateLabel(finding.dueDate)}`)
    for (const action of finding.actions) text(`Accion: ${action.title} · ${action.status} · ${action.responsible?.name ?? 'Sin asignar'} · ${dateLabel(action.dueDate)}`)
    for (const evaluation of finding.efficacyEvaluations) text(`Eficacia: ${evaluation.status} · ${evaluation.outcome} · ${valueLabel(evaluation.conclusion)}`)
  }

  heading('Resumen ejecutivo')
  paragraph('Resumen', snapshot.editable.executiveSummary)
  heading('Conclusiones')
  paragraph('Conclusiones', snapshot.editable.conclusions)
  heading('Recomendaciones')
  paragraph('Recomendaciones', snapshot.editable.recommendations)
  text(`Snapshot: ${snapshot.sourceFingerprint}`, 7, false, '0.35 0.40 0.46')

  if (commands.length > 0) pages.push({ content: commands.join('\n') })
  const objects: string[] = []
  const addObject = (value: string) => { const id = objects.length + 1; objects.push(`${id} 0 obj\n${value}\nendobj\n`); return id }
  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesId = addObject('<< /Type /Pages /Kids [] /Count 0 >>')
  const regularFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const boldFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const pageIds: number[] = []
  for (const page of pages) {
    const stream = Buffer.from(page.content, 'latin1')
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }
  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const objectOffsets: number[] = [0]
  for (const object of objects) {
    objectOffsets.push(Buffer.byteLength(body, 'latin1'))
    body += object
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) body += `${String(objectOffsets[index]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
