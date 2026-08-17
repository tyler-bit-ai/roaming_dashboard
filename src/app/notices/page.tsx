import FilterBar from "@/components/FilterBar";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import type { CarrierCode } from "@/lib/types";
import { formatDateTime, hasDb, listNotices } from "@/lib/db";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NoticesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const carrier = one(sp.carrier);
  const q = one(sp.q);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  const filters = {
    carrier: carrier as CarrierCode | undefined,
    keyword: q,
    dateFrom: from,
    dateTo: to,
    page,
  };

  if (!hasDb()) {
    return (
      <>
        <NoticesHeading />
        <EmptyState dbNotConfigured />
      </>
    );
  }

  let result: Awaited<ReturnType<typeof listNotices>>;
  try {
    result = await listNotices(filters);
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회 실패: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부를 확인하세요.`}
      />
    );
  }

  const baseQuery: Record<string, string | undefined> = { carrier, q, from, to };

  return (
    <>
      <NoticesHeading />
      <FilterBar initial={{ carrier, keyword: q, dateFrom: from, dateTo: to }} showCarrier />

      {result.rows.length === 0 ? (
        <EmptyState message="조건에 맞는 공지가 없습니다. 필터를 변경하거나 수집을 실행해주세요." />
      ) : (
        <section className="surface-card">
          <div className="list-card-row" style={{ borderTop: 0 }}>
            <div className="muted-label">제목</div>
            <div className="muted-label">게시일 / 최초 수집</div>
          </div>
          {result.rows.map((notice) => (
            <div key={notice.id} className="list-card-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="carrier-dot" style={{ background: notice.carrier_color }} />
                  <a
                    href={notice.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[12px] font-medium text-slate-800 hover:text-[var(--accent-strong)]"
                  >
                    {notice.title}
                  </a>
                  <NewBadge firstSeenAt={notice.first_seen_at} />
                  {!notice.is_active && <span className="pill-badge">삭제됨</span>}
                </div>
                {notice.content_preview && (
                  <div className="mt-1 line-clamp-2 max-w-[720px] text-[11px] leading-[1.5] text-slate-400">
                    {notice.content_preview}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] text-slate-600">{formatDateTime(notice.published_at)}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  수집 {formatDateTime(notice.first_seen_at)}
                </div>
              </div>
            </div>
          ))}
          <div style={{ padding: "0 16px 14px" }}>
            <Pagination page={page} pages={result.pages} total={result.total} baseQuery={baseQuery} />
          </div>
        </section>
      )}
    </>
  );
}

function NoticesHeading() {
  return (
    <div className="section-heading">
      <div>
        <div className="section-heading__eyebrow">Carrier Notices</div>
        <h1 className="section-heading__title">공지사항</h1>
        <p className="section-heading__subtext">
          통신 3사 로밍 관련 게시판 아카이브. 원본 게시일과 최초 수집 시각이 함께 표시됩니다.
        </p>
      </div>
    </div>
  );
}
