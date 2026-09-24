import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export function ActionStatusChart({ pending, overdue }: { pending: number; overdue: number }) {
  const data = [
    { name: 'Pendientes', value: Math.max(0, pending - overdue), fill: '#d97706' },
    { name: 'Vencidas', value: overdue, fill: '#dc2626' },
  ].filter((d) => d.value > 0)
  const total = pending
  if (total === 0) return <div className="empty-state compact"><p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Sin acciones pendientes</p></div>

  return (
    <div className="chart-card">
      <h3>Acciones pendientes</h3>
      <p className="chart-subtitle">{total} acción{total === 1 ? '' : 'es'} por gestionar</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
          <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
          <Tooltip formatter={(value) => [`${value}`, 'Cantidad']} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={32}>
            {data.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
