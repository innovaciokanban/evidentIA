import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProcessCard } from './ProcessCard'

describe('ProcessCard', () => {
  it('muestra el resumen del proceso y sus acciones', () => {
    const markup = renderToStaticMarkup(
      <ProcessCard
        name="Gestión Comercial"
        code="PR-001"
        objective="Gestionar las oportunidades comerciales."
        description="Acompaña la relación con clientes."
        category="misional"
        status="active"
        responsible="Andrés Santacruz"
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(markup).toContain('Gestión Comercial')
    expect(markup).toContain('PR-001')
    expect(markup).toContain('Acompaña la relación con clientes.')
    expect(markup).not.toContain('Andrés Santacruz')
    expect(markup).not.toContain('Gestionar las oportunidades comerciales.')
    expect(markup).toContain('Activo')
    expect(markup).toContain('Ver proceso')
    expect(markup).toContain('Eliminar')
  })
})
