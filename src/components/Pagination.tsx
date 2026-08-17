/**
 * 페이지네이션 바 — 현재 searchParams를 유지한 채 page만 변경
 * (서버 컴포넌트에서 사용, Link 기반이라 JS 불필요)
 */
import Link from "next/link";
import { pageRange } from "@/lib/db";

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  /** page를 제외한 현재 쿼리 문자열 */
  baseQuery: Record<string, string | undefined>;
}

function buildHref(baseQuery: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(baseQuery)) {
    if (v) params.set(k, v);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default function Pagination({ page, pages, total, baseQuery }: PaginationProps) {
  if (pages <= 1) {
    return (
      <div className="pagination-bar">
        <span className="text-[11px] text-slate-400">총 {total.toLocaleString()}건</span>
      </div>
    );
  }

  return (
    <div className="pagination-bar">
      <span className="text-[11px] text-slate-400">
        총 {total.toLocaleString()}건 · {page}/{pages}페이지
      </span>
      <div className="pagination-bar__actions">
        {page > 1 && (
          <Link href={buildHref(baseQuery, page - 1)} className="subtle-button text-[11px]">
            ← 이전
          </Link>
        )}
        {pageRange(pages, page).map((p) => (
          <Link
            key={p}
            href={buildHref(baseQuery, p)}
            className={`subtle-button min-w-[30px] text-[11px] ${p === page ? "border-[var(--accent)] text-[var(--accent-strong)]" : ""}`}
          >
            {p}
          </Link>
        ))}
        {page < pages && (
          <Link href={buildHref(baseQuery, page + 1)} className="subtle-button text-[11px]">
            다음 →
          </Link>
        )}
      </div>
    </div>
  );
}
