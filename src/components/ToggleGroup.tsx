"use client";

/**
 * 세그먼트 토글 — Meta 디자인 시스템 그대로 이식
 * 통신사/카테고리 필터 등에 재사용
 */
interface ToggleGroupProps {
  options: { value: string; label: string; dotColor?: string }[];
  value: string;
  onChange: (value: string) => void;
}

export default function ToggleGroup({ options, value, onChange }: ToggleGroupProps) {
  return (
    <div className="toggle-group inline-flex h-[34px] rounded-md bg-slate-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={[
            "toggle-group__button rounded px-3 text-[11px] font-semibold transition-all",
            value === opt.value
              ? "toggle-group__button--active bg-white text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              : "text-slate-400 hover:text-slate-700",
          ].join(" ")}
        >
          <span
            className="toggle-group__dot"
            style={opt.dotColor && value === opt.value ? { background: opt.dotColor } : undefined}
          />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
