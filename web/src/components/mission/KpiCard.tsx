import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Horizontal KPI tile used on Mission Control (icon tile + label/value/sub), readable from 1280px to 4K. */
export function KpiCard({ label, value, sub, icon, accent, className, highlight }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; accent: string; className?: string; highlight?: boolean;
}) {
  return (
    <div className={clsx('panel relative overflow-hidden h-full px-4 py-3.5 flex items-center gap-3.5', className)}
      style={highlight ? { borderColor: `${accent}88`, boxShadow: `0 0 0 1px ${accent}44, 0 18px 40px -24px ${accent}` } : undefined}>
      <div className="absolute -top-12 -right-10 w-32 h-32 rounded-full blur-2xl opacity-25 pointer-events-none" style={{ background: accent }} />
      <span className="relative shrink-0 grid place-items-center w-10 h-10 rounded-xl" style={{ background: `${accent}1c`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}33` }}>
        {icon}
      </span>
      <div className="relative min-w-0 flex-1">
        <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium truncate">{label}</div>
        <div className="text-[24px] leading-[1.15] font-semibold tabular-nums tracking-tight truncate">{value}</div>
        {sub && <div className="text-[11.5px] text-muted truncate flex items-center gap-1.5 whitespace-nowrap">{sub}</div>}
      </div>
    </div>
  );
}
