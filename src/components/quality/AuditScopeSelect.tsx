import { useMemo, useState } from 'react'

export type AuditScopeOption = { id: string; label: string }

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
  const term = search.trim().toLowerCase()

  const filteredProcesses = useMemo(
    () => (term ? processes.filter((option) => option.label.toLowerCase().includes(term)) : processes),
    [processes, term],
  )
  const filteredProcedures = useMemo(
    () => (term ? procedures.filter((option) => option.label.toLowerCase().includes(term)) : procedures),
    [procedures, term],
  )

  const chips: Array<{ id: string; kind: ScopeKind; label: string; locked: boolean }> = [
    ...processIds.map((id) => ({ id, kind: 'process' as const, label: optionLabel(processes, id), locked: id === lockedProcessId })),
    ...procedureIds.map((id) => ({ id, kind: 'procedure' as const, label: optionLabel(procedures, id), locked: false })),
  ]

  function toggle(kind: ScopeKind, id: string, next: boolean) {
    if (kind === 'process') {
      if (!next && id === lockedProcessId) return
      onChange({ processIds: next ? [...processIds, id] : processIds.filter((item) => item !== id), procedureIds })
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
        {filteredProcesses.length > 0 && <p className="audit-scope-group-label">Procesos</p>}
        {filteredProcesses.map((option) => (
          <label key={option.id} className={`audit-scope-option${option.id === lockedProcessId ? ' locked' : ''}${processIds.includes(option.id) ? ' selected' : ''}`}>
            <input
              type="checkbox"
              checked={processIds.includes(option.id)}
              disabled={option.id === lockedProcessId}
              onChange={(event) => toggle('process', option.id, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {filteredProcedures.length > 0 && <p className="audit-scope-group-label">Procedimientos</p>}
        {filteredProcedures.map((option) => (
          <label key={option.id} className={`audit-scope-option${procedureIds.includes(option.id) ? ' selected' : ''}`}>
            <input
              type="checkbox"
              checked={procedureIds.includes(option.id)}
              onChange={(event) => toggle('procedure', option.id, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {filteredProcesses.length === 0 && filteredProcedures.length === 0 && <p className="muted audit-scope-empty-list">Sin opciones</p>}
      </div>
      <p className="audit-scope-help">Selecciona uno o varios procesos y/o procedimientos incluidos en la auditoría</p>
    </fieldset>
  )
}
