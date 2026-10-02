export function KPICard({ icon, label, value, tone, hint }: { icon: string; label: string; value: number; tone: string; hint?: string }) {
  return (
    <div className="metric-card">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  )
}
