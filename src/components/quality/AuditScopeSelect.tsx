import { useMemo, useState } from 'react'
import { askConfirm } from '../ui/useConfirm'

export type AuditScopeOption = { id: string; label: string; processId?: string }

type ScopeKind = 'process' | 'procedure'

const optionLabel = (options: AuditScopeOption[], id: string): string => options.find((option) => option.id === id)?.label ?? id

/**
 * Selector compuesto del alcance de la auditoría: procesos y procedimientos en una sola lista
 * agrupada, con chips removibles. En edición, el proceso ancla (processId del backend, que fija el
 * código y el tenant) se muestra bloqueado: no se puede quitar del conjunto.
 */
export function AuditScopeSelect({ processes, procedures, processIds, procedureIds, lockedProcessId, onChange }: {
  processes: AuditScopeOption[]
  procedures: AuditScopeOption[]
  processIds: string[]
  procedureIds: string[]
  lockedProcessId?: string | null
  onChange: (next: { processIds: string[]; procedureIds: string[] }) => void
}) {
  const [search, setSearch] = useState('')
  const [changingProcessId, setChangingProcessId] = useState<string | null>(null)
  const term = search.trim().toLowerCase()

  const proceduresByProcess = useMemo(() => {
    const grouped = new Map<string, AuditScopeOption[]>()
    for (const procedure of procedures) {
      if (!procedure.processId) continue
      const current = grouped.get(procedure.processId) ?? []
      current.push(procedure)
      grouped.set(procedure.processId, current)
    }
    return grouped
  }, [procedures])

  const proceduresForProcess = (processId: string): AuditScopeOption[] => proceduresByProcess.get(processId) ?? []
  const filteredProcesses = useMemo(
    () => processes.filter((process) => !term || process.label.toLowerCase().includes(term) || proceduresForProcess(process.id).some((procedure) => procedure.label.toLowerCase().includes(term))),
    [processes, proceduresByProcess, term],
  )

  const chips: Array<{ id: string; kind: ScopeKind; label: string; locked: boolean }> = [
    ...processIds.map((id) => ({ id, kind: 'process' as const, label: optionLabel(processes, id), locked: id === lockedProcessId })),
    ...procedureIds.map((id) => ({ id, kind: 'procedure' as const, label: optionLabel(procedures, id), locked: false })),
  ]

  function visibleProcedures(process: AuditScopeOption): AuditScopeOption[] {
    const available = proceduresForProcess(process.id)
    return term && !process.label.toLowerCase().includes(term)
      ? available.filter((procedure) => procedure.label.toLowerCase().includes(term))
      : available
  }

  async function toggle(kind: ScopeKind, id: string, next: boolean) {
    if (kind === 'process') {
      if (!next && id === lockedProcessId) return
      if (next) {
        onChange({ processIds: [...processIds, id], procedureIds })
        return
      }
      const processProcedureIds = proceduresForProcess(id).map((procedure) => procedure.id)
      const selectedProcedureIds = procedureIds.filter((procedureId) => processProcedureIds.includes(procedureId))
      if (selectedProcedureIds.length > 0) {
        setChangingProcessId(id)
        try {
          const confirmed = await askConfirm({
            title: 'Retirar proceso del alcance',
            message: 'También se retirarán los procedimientos seleccionados de este proceso.',
            confirmLabel: 'Retirar proceso',
            variant: 'danger',
          })
          if (!confirmed) return
        } finally {
          setChangingProcessId(null)
        }
      }
      onChange({
        processIds: processIds.filter((item) => item !== id),
        procedureIds: procedureIds.filter((procedureId) => !processProcedureIds.includes(procedureId)),
      })
      return
    }
    onChange({ processIds, procedureIds: next ? [...procedureIds, id] : procedureIds.filter((item) => item !== id) })
  }

  return (
    <fieldset className="multi-select audit-scope">
      <legend>Alcance</legend>
      <div className="audit-scope-chips">
        {chips.length === 0 && <p className="audit-scope-empty">Selecciona procesos y/o procedimientos</p>}
        {chips.map((chip) => (
          <span key={`${chip.kind}-${chip.id}`} className={`audit-scope-chip ${chip.kind}`}>
            <span className="audit-scope-chip-dot" aria-hidden="true" />
            {chip.label}
            {chip.locked
              ? <span className="audit-scope-chip-lock" title="Proceso principal de la auditoría">Principal</span>
              : <button type="button" className="audit-scope-chip-remove" aria-label={`Quitar ${chip.label}`} onClick={() => toggle(chip.kind, chip.id, false)}>×</button>}
          </span>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar proceso o procedimiento…"
        aria-label="Buscar en el alcance"
      />
      <div className="audit-scope-groups" role="group" aria-label="Alcance">
        {filteredProcesses.length > 0 && <p className="audit-scope-group-label">Procesos y procedimientos</p>}
        {filteredProcesses.map((option) => (
          <div key={option.id} className="audit-scope-process-group">
            <label className={`audit-scope-option${option.id === lockedProcessId ? ' locked' : ''}${processIds.includes(option.id) ? ' selected' : ''}`}>
              <input
                type="checkbox"
                checked={processIds.includes(option.id)}
                disabled={option.id === lockedProcessId || changingProcessId === option.id}
                onChange={(event) => void toggle('process', option.id, event.target.checked)}
              />
              <span>{option.label}</span>
              {option.id === lockedProcessId && <span className="audit-scope-chip-lock">Principal</span>}
            </label>
            {(processIds.includes(option.id) || procedureIds.some((id) => proceduresForProcess(option.id).some((procedure) => procedure.id === id))) && (
              <div className="audit-scope-procedures">
                {visibleProcedures(option).map((procedure) => (
                  <label key={procedure.id} className={`audit-scope-option audit-scope-procedure-option${procedureIds.includes(procedure.id) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={procedureIds.includes(procedure.id)} onChange={(event) => void toggle('procedure', procedure.id, event.target.checked)} />
                    <span>{procedure.label}</span>
                  </label>
                ))}
                {visibleProcedures(option).length === 0 && <p className="muted audit-scope-empty-list">Este proceso no tiene procedimientos disponibles.</p>}
              </div>
            )}
          </div>
        ))}
        {filteredProcesses.length === 0 && <p className="muted audit-scope-empty-list">Sin opciones</p>}
      </div>
      <p className="audit-scope-help">Selecciona uno o varios procesos y/o procedimientos incluidos en la auditoría</p>
    </fieldset>
  )
}
