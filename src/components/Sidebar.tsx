"use client";

/**
 * 다크 고정 사이드바 — Meta 디자인 시스템 포팅
 * react-router NavLink → next/link Link + usePathname
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  path: string;
  label: string;
  labelKo: string;
  icon: "globe" | "bars" | "folder" | "target";
};

const navItems: NavItem[] = [
  { path: "/", label: "Overview", labelKo: "오버뷰", icon: "globe" },
  { path: "/plans", label: "Plans & Services", labelKo: "요금제·서비스", icon: "bars" },
  { path: "/notices", label: "Notices", labelKo: "공지사항", icon: "folder" },
  { path: "/news", label: "Roaming News", labelKo: "로밍 뉴스", icon: "target" },
];

function NavIcon({ type }: { type: NavItem["icon"] }) {
  if (type === "globe") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16" />
        <path d="M12 4a12 12 0 0 1 0 16" />
        <path d="M12 4a12 12 0 0 0 0 16" />
      </svg>
    );
  }
  if (type === "bars") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 19V10" />
        <path d="M12 19V5" />
        <path d="M19 19v-7" />
        <path d="M3 19h18" />
      </svg>
    );
  }
  if (type === "target") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-[15px] w-[15px]" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
    </svg>
  );
}

interface SidebarProps {
  /** 마지막 수집 완료 시각 (표시 형식 문자열, DB 미연결 시 null) */
  lastSync: string | null;
}

export default function Sidebar({ lastSync }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="dashboard-sidebar">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-[#1f2937] px-5 py-5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(135deg,#2563eb,#0d9488)] text-[13px] font-bold text-white">
            R
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight text-slate-50">Roaming Radar</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-600">
              Carrier Monitor
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-0 py-5 md:flex-col md:overflow-visible">
          <div className="hidden px-4 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 md:block">
            Monitoring
          </div>
          {navItems.map((item) => {
            const isActive = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={[
                  "sidebar-nav-link group flex min-w-[220px] items-center gap-3 px-5 py-3.5 transition-all md:min-w-0",
                  isActive ? "sidebar-nav-link--active" : "",
                ].join(" ")}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <NavIcon type={item.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium leading-5">{item.label}</div>
                  <div className="truncate text-[10px] leading-4 opacity-55">{item.labelKo}</div>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="hidden flex-1 border-t border-[#1f2937] md:block" />

        <div className="mt-auto hidden border-t border-[#1f2937] px-4 py-3 md:block">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <div>
              <div className="text-[12px] font-medium text-slate-300">Auto-sync · 09:00 KST</div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                {lastSync ? `Updated ${lastSync}` : "수집 실행 전"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
