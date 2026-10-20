/**
 * Traduce el `reason` de un 409 de DELETE /api/processes a un mensaje accionable para el mapa:
 * explica qué impide eliminar el proceso y ofrece la alternativa segura sin borrar historial ni
 * registros relacionados. La acción alternativa existe de verdad: el selector "Estado" del
 * formulario (opción Inactivo, dentro del fieldset editable) aplica INACTIVE, que el mapa
 * muestra como "En pausa". La API nunca responde 204 cuando existe el conflicto.
 */
export function processDeleteErrorMessage(reason: string | undefined): string {
  if (reason === 'CHANGE_HISTORY') {
    return 'No se puede eliminar el proceso porque tiene historial de cambios: su trazabilidad se conserva en Control de cambios y no se pueden borrar sus versiones. Como alternativa segura, ábrelo y pon su Estado en «Inactivo» (aparece como «En pausa» en el mapa) para retirarlo sin perder datos.'
  }
  if (reason === 'RELATED_RECORDS') {
    return 'No se puede eliminar el proceso porque aún tiene registros relacionados (riesgos, indicadores, procedimientos, auditorías o entradas de SIPOC). Revisa esos módulos antes de eliminarlo; si solo quieres retirarlo del mapa, pon su Estado en «Inactivo» (aparece como «En pausa»).'
  }
  return 'No se pudo eliminar el proceso.'
}
