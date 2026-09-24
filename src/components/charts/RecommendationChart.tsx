import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { DashboardPriorityRecommendation } from '../../types'

const PRIORITY_COLORS: Record<string, string> = { HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#64748b' }

export function RecommendationChart({ recommendations }: { recommendations: DashboardPriorityRecommendation[] }) {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  recommendations.forEach((r) => { counts[r.priority]++ })
  const data = [
    { name: 'Alta', value: counts.HIGH, fill: PRIORITY_COLORS.HIGH },
    { name: 'Media', value: counts.MEDIUM, fill: PRIORITY_COLORS.MEDIUM },
    { name: 'Baja', value: counts.LOW, fill: PRIORITY_COLORS.LOW },
  ].filter((d) => d.value > 0)

  if (data.length === 0) return <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin recomendaciones pendientes</p></div>

  return (
    <div className="chart-card">
      <h3>Recomendaciones pendientes</h3>
      <p className="chart-subtitle">{recommendations.length} por prioridad</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ left: -10, right: 20 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => [`${value}`, 'Cantidad']} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
            {data.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
