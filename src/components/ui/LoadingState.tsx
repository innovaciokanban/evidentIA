export function LoadingState({ text = 'Cargando...' }: { text?: string }) {
  return <div className="loading-state"><span className="loader" />{text}</div>
}
