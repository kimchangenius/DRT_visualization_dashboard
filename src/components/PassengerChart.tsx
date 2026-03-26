import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PassengerTimeSeriesPoint } from '../types/simulation';

interface PassengerChartProps {
  data: PassengerTimeSeriesPoint[];
}

export default function PassengerChart({ data }: PassengerChartProps) {
  return (
    <div className="panel chart-panel">
      <h3 className="panel-title">Passenger Overview</h3>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="servedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="waitingGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
            <YAxis stroke="#94a3b8" fontSize={10} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Area
              type="monotone"
              dataKey="served"
              stroke="#10b981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#servedGrad)"
              name="Served"
            />
            <Area
              type="monotone"
              dataKey="waiting"
              stroke="#f59e0b"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#waitingGrad)"
              name="Waiting"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
