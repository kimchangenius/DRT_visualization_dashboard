import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TripStatusData } from '../types/simulation';

interface TripStatusChartProps {
  data: TripStatusData[];
}

export default function TripStatusChart({ data }: TripStatusChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Trip Status</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={total > 0 ? data : [{ name: 'No Data', value: 1, color: '#334155' }]}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={60}
              paddingAngle={2}
              dataKey="value"
            >
              {(total > 0 ? data : [{ name: 'No Data', value: 1, color: '#334155' }]).map(
                (entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                )
              )}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            {total > 0 && (
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                formatter={(value: string) => <span style={{ color: '#94a3b8' }}>{value}</span>}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
