import KpiCard from "@/components/KpiCard";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import { CATEGORY_LABEL, type ScrapeRun } from "@/lib/types";
import {
  formatDateTime,
  getNewItems,
  getNewNotices,
  getOverviewStats,
  getRecentRuns,
  hasDb,
} from "@/lib/db";

// DB 조회 결과를 매 요청마다 반영 (빌드 시 정적 프리렌더 시도하지 않음)
export const dynamic = "force-dynamic";

/** 수집 실행 상태 → 표시 라벨/색 */
function runStatus(run: ScrapeRun): { label: string; cls: string } {
  switch (run.status) {
    case "success":
      return { label: "성공", cls: "status-dot--success" };
    case "partial":
      return { label: "일부 성공", cls: "status-dot--partial" };
    case "failed":
      return { label: "실패", cls: "status-dot--failed" };
    case "running":
      return { label: "실행 중", cls: "status-dot--running" };
    default:
      return { label: run.status, cls: "status-dot--running" };
  }
}

export default async function OverviewPage() {
  // DB 미연결 → 세팅 안내
  if (!hasDb()) {
    return (
      <>
        <div className="section-heading">
          <div>
            <div className="section-heading__eyebrow">Overview</div>
            <h1 className="section-heading__title">통신 3사 로밍 모니터링</h1>
            <p className="section-heading__subtext">
              SKT·KT·LG유플러스의 로밍 요금제, 부가서비스, 공지사항, 프로모션과 로밍 뉴스를 매일 자동 수집해
              히스토리까지 추적합니다.
            </p>
          </div>
        </div>
        <EmptyState dbNotConfigured />
      </>
    );
  }

  let data;
  try {
    data = await Promise.all([getOverviewStats(), getRecentRuns(5), getNewItems(10), getNewNotices(5)]);
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회에 실패했습니다: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부와 DATABASE_URL을 확인하세요.`}
      />
    );
  }

  const [stats, runs, newItems, newNotices] = data;
  const isEmpty = stats.activeItems === 0 && stats.noticeCount === 0 && stats.newsCount === 0;

  return (
    <>
      {/* 페이지 헤더 */}
      <div className="section-heading">
        <div>
          <div className="section-heading__eyebrow">Overview</div>
          <h1 className="section-heading__title">통신 3사 로밍 모니터링</h1>
          <p className="section-heading__subtext">
            SKT·KT·LG유플러스의 로밍 요금제, 부가서비스, 공지사항, 프로모션과 로밍 뉴스를 매일 09:00(KST) 자동
            수집해 히스토리까지 추적합니다.
          </p>
        </div>
      </div>

      {isEmpty && <EmptyState />}

      {/* KPI 카드 */}
      <div className="kpi-grid">
        <KpiCard
          label="활성 로밍 상품"
          value={stats.activeItems.toLocaleString()}
          sub="요금제·부가서비스·프로모션 합계 (현재 판매 중)"
          color="blue"
        />
        <KpiCard
          label="24시간 신규"
          value={`+${stats.newItems24h.toLocaleString()}`}
          sub="상품·공지·뉴스 합산, 최근 수집에서 처음 발견"
          color="red"
          trend={stats.newItems24h > 0 ? "up" : "neutral"}
          trendValue={stats.newItems24h > 0 ? "신규 항목 있음" : "변동 없음"}
        />
        <KpiCard
          label="공지사항 누적"
          value={stats.noticeCount.toLocaleString()}
          sub="3사 게시판 아카이브 전체 건수"
          color="amber"
        />
        <KpiCard
          label="로밍 뉴스 누적"
          value={stats.newsCount.toLocaleString()}
          sub="네이버 검색 아카이브 전체 건수"
          color="green"
        />
      </div>

      {/* 새로 추가된 항목 + 수집 현황 */}
      <div className="chart-grid">
        {/* 신규 하이라이트 */}
        <section className="surface-card surface-card--section">
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <div>
              <div className="section-heading__eyebrow">Last 24 Hours</div>
              <div className="section-title">새로 추가된 항목</div>
            </div>
          </div>
          {newItems.length === 0 && newNotices.length === 0 ? (
            <div className="inset-card">
              <div className="section-copy">
                최근 24시간에 새로 수집된 항목이 없습니다. 다음 수집은 매일 09:00(KST)에 실행됩니다.
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              {newItems.map((item) => (
                <div key={`item-${item.id}`} className="inset-card flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="carrier-dot" style={{ background: item.carrier_color }} />
                    <span className="truncate text-[12px] font-medium text-slate-800">{item.name}</span>
                    <span className="pill-badge shrink-0">{CATEGORY_LABEL[item.category]}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-slate-400">{item.carrier_code}</span>
                    <NewBadge firstSeenAt={item.first_seen_at} />
                  </div>
                </div>
              ))}
              {newNotices.map((notice) => (
                <div key={`notice-${notice.id}`} className="inset-card flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="carrier-dot" style={{ background: notice.carrier_color }} />
                    <span className="truncate text-[12px] font-medium text-slate-800">{notice.title}</span>
                    <span className="pill-badge shrink-0">공지</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-slate-400">{notice.carrier_code}</span>
                    <NewBadge firstSeenAt={notice.first_seen_at} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 수집 실행 현황 */}
        <section className="surface-card surface-card--section">
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <div>
              <div className="section-heading__eyebrow">Scrape Runs</div>
              <div className="section-title">최근 수집 실행</div>
            </div>
          </div>
          {runs.length === 0 ? (
            <div className="inset-card">
              <div className="section-copy">아직 수집이 실행된 적이 없습니다.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="content-table">
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>대상</th>
                    <th className="text-right">신규</th>
                    <th className="text-right">변경</th>
                    <th>실행 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const st = runStatus(run);
                    return (
                      <tr key={run.id}>
                        <td>
                          <span className="flex items-center gap-2">
                            <span className={`status-dot ${st.cls}`} />
                            <span className="text-[11px]">{st.label}</span>
                          </span>
                        </td>
                        <td className="content-table__muted">{run.target}</td>
                        <td className="content-table__number">{run.items_inserted}</td>
                        <td className="content-table__number">{run.items_updated}</td>
                        <td className="content-table__muted" title={run.error_message ?? ""}>
                          {formatDateTime(run.started_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
