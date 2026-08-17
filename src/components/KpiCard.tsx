/**
 * KPI 카드 — Meta 디자인 시스템 그대로 이식 (서버 컴포넌트 호환)
 */
interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: "blue" | "red" | "green" | "amber" | "purple";
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

const accentMap: Record<string, { icon: string; text: string }> = {
  blue: { icon: "bg-blue-50 border-blue-200", text: "text-[var(--accent)]" },
  red: { icon: "bg-red-50 border-red-200", text: "text-[var(--error)]" },
  green: { icon: "bg-emerald-50 border-emerald-200", text: "text-[var(--success)]" },
  amber: { icon: "bg-amber-50 border-amber-200", text: "text-[var(--warning)]" },
  purple: { icon: "bg-violet-50 border-violet-200", text: "text-violet-600" },
};

export default function KpiCard({ label, value, sub, color = "blue", trend, trendValue }: KpiCardProps) {
  const accent = accentMap[color] || accentMap.blue;
  const trendColor = trend === "up" ? "text-emerald-500" : trend === "down" ? "text-rose-400" : "text-slate-400";
  const trendIcon = trend === "up" ? "↗" : trend === "down" ? "↘" : "•";

  return (
    <article className="surface-card surface-card--compact">
      <div className="flex min-h-[112px] flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="stack-sm pr-2">
            <div className="muted-label">{label}</div>
            <div className="text-[26px] font-semibold leading-none text-slate-900">{value}</div>
          </div>
          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border ${accent.icon}`}>
            <div className={`h-2 w-2 rounded-full bg-current ${accent.text}`} />
          </div>
        </div>
        <div className="stack-sm">
          {sub && <div className="max-w-[16rem] text-[11px] leading-[1.4] text-slate-500">{sub}</div>}
          {trend && trendValue && (
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${trendColor}`}>
              <span>{trendIcon}</span>
              <span>{trendValue}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
