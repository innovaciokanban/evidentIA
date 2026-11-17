import { renderToStaticMarkup } from 'react-dom/server'
import type { Dispatch, SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { KpiIndicatorModal } from './KpiForm'
import { emptyKpiDraft } from './process-kpi.model'
import type { KpiIndicatorDraft } from './KpiForm'

const draft: KpiIndicatorDraft = {
  ...emptyKpiDraft,
  baselineValue: '',
  measurementMethod: '',
  deadline: '',
}

describe('KpiIndicatorModal', () => {
  it('no crea un formulario anidado y guarda con un botón no submit', () => {
    const markup = renderToStaticMarkup(
      <KpiIndicatorModal
        draft={draft}
        setDraft={vi.fn() as unknown as Dispatch<SetStateAction<KpiIndicatorDraft>>}
        users={[]}
        editing={false}
        saving={false}
        error=""
        eyebrow="INDICADORES DEL PROCESO"
        title="AÑADIR INDICADOR"
        description="Define una métrica propia."
        ariaLabel="Añadir indicador del proceso"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(markup).not.toContain('<form')
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Guardar indicador<\/button>/)
  })
})
