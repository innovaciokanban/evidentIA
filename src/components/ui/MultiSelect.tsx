import { useMemo, useState } from 'react'

export type MultiSelectOption = { id: string; label: string }

/**
 * Selector múltiple accesible con búsqueda: lista de casillas filtrable, sin depender de
 * <select multiple> (difícil de usar en móvil y con navegación por teclado inconsistente).
 */
export function MultiSelect({ label, options, value, onChange, disabled }: {
  label: string
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => option.label.toLowerCase().includes(term))
  }, [options, search])

  function toggle(id: string) {
    if (disabled) return
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  }

  return (
    <fieldset className="multi-select" disabled={disabled}>
      <legend>{label}</legend>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar…"
        aria-label={`Buscar en ${label}`}
      />
      <div className="multi-select-list" role="group" aria-label={label}>
        {filtered.length === 0 && <p className="muted multi-select-empty">Sin opciones</p>}
        {filtered.map((option) => (
          <label key={option.id} className="multi-select-option">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={() => toggle(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {value.length > 0 && <p className="multi-select-count">{value.length} seleccionado(s)</p>}
    </fieldset>
  )
}
