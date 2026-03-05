import type { ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: string;
  helper?: string;
  icon?: ReactNode;
};

const StatCard = ({ label, value, helper, icon }: StatCardProps) => {
  return (
    <div className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-semibold text-ink">{value}</div>
      {helper ? <div className="mt-2 text-sm text-muted">{helper}</div> : null}
    </div>
  );
};

export default StatCard;
