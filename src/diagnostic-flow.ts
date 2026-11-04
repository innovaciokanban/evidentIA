/** Las etapas intermedias se muestran sobre la vista de la matriz DOFA, que es la que las abre. */
export type StrategicScreen = 'checky' | 'ponderacion' | 'objetivos'
export type FlowStep = 'diagnostico' | 'dofa' | StrategicScreen

/**
 * Unico recorrido del análisis. El indicador del detalle y los chips numerados de cada bloque salen de
 * aqui, de modo que ninguna pantalla puede anunciar una etapa que el indicador no tiene ni repetirla.
 *
 * El análisis estratégico con IA no aparece como etapa propia: Checky lo orquesta dentro de su propia
 * pantalla, que es donde se lee, y así el usuario ejecuta un análisis y no dos.
 *
 * Las secciones de recomendaciones y planes de acción quedan deliberadamente fuera: no son una etapa
 * del análisis estratégico, asi que no aparecen en el indicador. Se siguen alcanzando desde el
 * contenido del propio análisis y desde las rutas que ya existen.
 */
export const diagnosticFlow: Array<{ key: FlowStep; label: string }> = [
  { key: 'diagnostico', label: 'Análisis estratégico' },
  { key: 'dofa', label: 'Matriz DOFA' },
  { key: 'checky', label: 'Checky' },
  { key: 'ponderacion', label: 'Ponderación' },
  { key: 'objetivos', label: 'Objetivos SMART' },
]
