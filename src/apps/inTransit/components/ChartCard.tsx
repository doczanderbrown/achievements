import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ChartCardProps = {
  title: string;
  subtitle?: string;
  data: { name: string; value: number }[];
  height?: number;
  footer?: ReactNode;
};

const ChartCard = ({ title, subtitle, data, height = 240, footer }: ChartCardProps) => {
  return (
    <div className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
        </div>
      </div>
      <div className="mt-4" style={{ height }}>
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(199, 169, 123, 0.25)" />
              <XAxis
                dataKey="name"
                tick={{ fill: 'rgb(71,85,105)', fontSize: 11 }}
                interval={0}
                angle={-20}
                height={50}
              />
              <YAxis tick={{ fill: 'rgb(71,85,105)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(245, 153, 35, 0.1)' }}
                contentStyle={{
                  background: 'white',
                  borderRadius: '16px',
                  borderColor: 'rgba(240, 228, 210, 1)',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="value" fill="rgb(245, 153, 35)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
};

export default ChartCard;
