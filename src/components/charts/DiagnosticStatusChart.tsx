import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

const COLORS = ['#94a3b8', '#7c3aed', '#16a34a']
const LABELS = ['Borrador', 'En progreso', 'Completado']

export function DiagnosticStatusChart({ draft, inProgress, completed }: { draft: number; inProgress: number; completed: number }) {
  const data = [
    { name: LABELS[0], value: draft },
    { name: LABELS[1], value: inProgress },
    { name: LABELS[2], value: completed },
  ].filter((d) => d.value > 0)

  const total = draft + inProgress + completed
  if (total === 0) return <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin datos disponibles</p></div>

  return (
    <div className="chart-card">
      <h3>Estado de diagnósticos</h3>
      <p className="chart-subtitle">{total} diagnóstico{total === 1 ? '' : 's'} en total</p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none">
            {data.map((_, index) => <Cell key={index} fill={COLORS[index]} />)}
          </Pie>
          <Tooltip formatter={(value) => [`${value}`, 'Cantidad']} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
