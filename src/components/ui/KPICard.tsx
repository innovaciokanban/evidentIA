export function KPICard({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="metric-card">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}
