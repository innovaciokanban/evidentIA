export function EmptyState({ title, text, action, compact = false, icon }: { title: string; text: string; action?: React.ReactNode; compact?: boolean; icon?: string }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">{icon ?? (compact ? '○' : '□')}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
