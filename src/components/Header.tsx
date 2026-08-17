"use client";

/**
 * sticky 헤더 — Meta 디자인 시스템 포팅
 * react-router useLocation/useNavigate → next/navigation usePathname/useRouter
 * Refresh 버튼은 RSC 재검증(router.refresh)으로 실제 동작
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

function getTitle(pathname: string): string {
  if (pathname.startsWith("/plans")) return "요금제 · 부가서비스";
  if (pathname.startsWith("/notices")) return "공지사항";
  if (pathname.startsWith("/news")) return "로밍 뉴스";
  return "오버뷰";
}

interface HeaderProps {
  /** 마지막 수집 완료 시각 (표시 형식 문자열, DB 미연결 시 null) */
  lastSync: string | null;
}

export default function Header({ lastSync }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 900);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--surface-border)] bg-white px-4 py-3 md:px-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-400">
            <Link href="/" className="transition-colors hover:text-slate-700">
              Home
            </Link>
            <span>/</span>
            <span className="text-slate-700">{getTitle(pathname)}</span>
          </div>
          <div className="text-[15px] font-semibold leading-tight text-slate-900">{getTitle(pathname)}</div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[11px] text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            {lastSync ? `Updated ${lastSync}` : "수집 대기 중"}
          </div>
          <button onClick={handleRefresh} className="subtle-button gap-1.5">
            <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
