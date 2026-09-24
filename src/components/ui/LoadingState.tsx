export function LoadingState({ text = 'Cargando...' }: { text?: string }) {
  return <div className="loading-state"><span className="loader" />{text}</div>
}

export function InlineLoading({ text = 'Cargando...' }: { text?: string }) {
  return <div className="inline-loading"><span className="loader" />{text}</div>
}

export function SkeletonLine({ width }: { width?: string }) {
  return <div className="skeleton skeleton-line" style={{ width: width ?? '100%' }} />
}
