import KpiCard from "@/components/KpiCard";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import { CARRIER_META, CATEGORY_LABEL, type CarrierCode, type ScrapeRun } from "@/lib/types";
import {
  formatDateTime,
  getActivePlans,
  getNewItems,
  getNewNotices,
  getOverviewStats,
  getRecentChanges,
  getRecentlyDeactivated,
  getRecentRuns,
  hasDb,
} from "@/lib/db";
import { extractWon, wonPerGb } from "@/lib/planAnalytics";

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
    // 커넥션 풀(max 5) 초과로 한 요청에서 5개 이상을 동시에 열면 Supabase pooler 쪽에서
    // 대기가 길어지는 현상이 있어(관측됨), 배치를 나눠 동시 커넥션 수를 억제한다.
    const batch1 = await Promise.all([getOverviewStats(), getRecentRuns(5), getNewItems(10), getNewNotices(5)]);
    const batch2 = await Promise.all([getActivePlans(), getRecentChanges(8), getRecentlyDeactivated(5)]);
    data = [...batch1, ...batch2] as const;
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회에 실패했습니다: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부와 DATABASE_URL을 확인하세요.`}
      />
    );
  }

  const [stats, runs, newItems, newNotices, activePlans, changes, deactivated] = data;
  const isEmpty = stats.activeItems === 0 && stats.noticeCount === 0 && stats.newsCount === 0;

  // 통신사별 GB당 최저 단가 — "SKT가 경쟁사 대비 어디서 밀리는가"를 한눈에 보여주는 지표.
  // 무제한/용량 미상 상품은 wonPerGb가 null을 반환해 자연스럽게 제외된다.
  const cheapestPerGbByCarrier = new Map<CarrierCode, { won: number; item: (typeof activePlans)[number] }>();
  for (const item of activePlans) {
    const perGb = wonPerGb(item.price, item.raw, item.name);
    if (perGb === null) continue;
    const current = cheapestPerGbByCarrier.get(item.carrier_code);
    if (!current || perGb < current.won) {
      cheapestPerGbByCarrier.set(item.carrier_code, { won: perGb, item });
    }
  }
  const carrierOrder: CarrierCode[] = ["SKT", "KT", "LGU"];
  const positioningTiles = carrierOrder
    .map((code) => ({ code, entry: cheapestPerGbByCarrier.get(code) }))
    .filter((t): t is { code: CarrierCode; entry: NonNullable<typeof t.entry> } => Boolean(t.entry));
  const sktCheapest = cheapestPerGbByCarrier.get("SKT")?.won ?? null;
  const marketCheapest = positioningTiles.reduce<{ code: CarrierCode; won: number } | null>((min, t) => {
    if (!min || t.entry.won < min.won) return { code: t.code, won: t.entry.won };
    return min;
  }, null);

  // 신규/변경/단종/공지를 하나의 시간순 피드로 병합 — "오늘 뭐가 바뀌었는지" 한 화면에서 파악.
  type FeedEvent = {
    key: string;
    time: string;
    typeLabel: string;
    typeTone: "new" | "change" | "gone" | "notice";
    carrierCode: CarrierCode;
    carrierName: string;
    carrierColor: string;
    text: string;
  };
  const feed: FeedEvent[] = [
    ...newItems.map((item) => ({
      key: `new-${item.id}`,
      time: item.first_seen_at,
      typeLabel: "신규",
      typeTone: "new" as const,
      carrierCode: item.carrier_code,
      carrierName: item.carrier_name,
      carrierColor: item.carrier_color,
      text: `${item.name} · ${CATEGORY_LABEL[item.category]}${item.price ? ` · ${item.price}` : ""}`,
    })),
    ...changes.map((c) => {
      const oldWon = extractWon(c.old_price);
      const newWon = extractWon(c.new_price);
      const arrow =
        oldWon !== null && newWon !== null
          ? oldWon === newWon
            ? ""
            : newWon > oldWon
              ? ` (${c.old_price} → ${c.new_price}, ▲인상)`
              : ` (${c.old_price} → ${c.new_price}, ▼인하)`
          : c.old_price !== c.new_price
            ? ` (${c.old_price ?? "-"} → ${c.new_price ?? "-"})`
            : "";
      return {
        key: `change-${c.item_id}-${c.changed_at}`,
        time: c.changed_at,
        typeLabel: "변경",
        typeTone: "change" as const,
        carrierCode: c.carrier_code,
        carrierName: c.carrier_name,
        carrierColor: c.carrier_color,
        text: `${c.name}${arrow}`,
      };
    }),
    ...deactivated.map((item) => ({
      key: `gone-${item.id}`,
      time: item.last_seen_at,
      typeLabel: "단종",
      typeTone: "gone" as const,
      carrierCode: item.carrier_code,
      carrierName: item.carrier_name,
      carrierColor: item.carrier_color,
      text: `${item.name} · ${CATEGORY_LABEL[item.category]}`,
    })),
    ...newNotices.map((notice) => ({
      key: `notice-${notice.id}`,
      time: notice.first_seen_at,
      typeLabel: "공지",
      typeTone: "notice" as const,
      carrierCode: notice.carrier_code,
      carrierName: notice.carrier_name,
      carrierColor: notice.carrier_color,
      text: notice.title,
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 12);

  const feedToneClass: Record<FeedEvent["typeTone"], string> = {
    new: "feed-tag--new",
    change: "feed-tag--change",
    gone: "feed-tag--gone",
    notice: "feed-tag--notice",
  };

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

      {/* 요금제 포지셔닝 — GB당 단가 기준 3사 최저가, SKT가 지금 어디 서 있는지 */}
      {positioningTiles.length > 0 && (
        <section className="surface-card surface-card--section">
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <div>
              <div className="section-heading__eyebrow">Pricing Position</div>
              <div className="section-title">GB당 단가 포지셔닝</div>
              <p className="section-copy" style={{ marginTop: 6 }}>
                {marketCheapest && sktCheapest !== null
                  ? marketCheapest.code === "SKT"
                    ? `SKT가 GB당 ${sktCheapest.toLocaleString()}원으로 3사 중 최저가입니다.`
                    : `${CARRIER_META[marketCheapest.code].name}가 GB당 ${marketCheapest.won.toLocaleString()}원으로 최저 — SKT(${sktCheapest.toLocaleString()}원/GB) 대비 ${(sktCheapest - marketCheapest.won).toLocaleString()}원 낮습니다.`
                  : "GB당 단가를 비교할 수 있는 활성 요금제가 부족합니다."}
              </p>
            </div>
          </div>
          <div className="three-up-grid">
            {carrierOrder.map((code) => {
              const entry = cheapestPerGbByCarrier.get(code);
              const meta = CARRIER_META[code];
              const isCheapest = marketCheapest?.code === code;
              return (
                <div key={code} className="inset-card">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="carrier-dot" style={{ background: meta.color }} />
                      <span className="text-[12px] font-semibold text-slate-800">{meta.name}</span>
                    </span>
                    {isCheapest && <span className="pill-badge">최저가</span>}
                  </div>
                  {entry ? (
                    <>
                      <div className="mt-2 text-[20px] font-semibold text-slate-900">
                        {entry.won.toLocaleString()}
                        <span className="ml-1 text-[11px] font-medium text-slate-400">원/GB</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">{entry.item.name}</div>
                    </>
                  ) : (
                    <div className="mt-2 text-[12px] text-slate-400">비교 가능한 요금제 없음</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 경쟁사 동향 피드 + 수집 현황 */}
      <div className="chart-grid">
        {/* 신규/변경/단종/공지를 하나로 합친 모니터링 피드 */}
        <section className="surface-card surface-card--section">
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <div>
              <div className="section-heading__eyebrow">Competitive Feed</div>
              <div className="section-title">경쟁사 동향</div>
            </div>
          </div>
          {feed.length === 0 ? (
            <div className="inset-card">
              <div className="section-copy">
                최근 수집에서 신규·변경·단종 항목이 없습니다. 다음 수집은 매일 09:00(KST)에 실행됩니다.
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              {feed.map((ev) => (
                <div key={ev.key} className="inset-card flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="carrier-dot" style={{ background: ev.carrierColor }} />
                    <span className={`feed-tag ${feedToneClass[ev.typeTone]}`}>{ev.typeLabel}</span>
                    <span className="truncate text-[12px] font-medium text-slate-800">{ev.text}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-slate-400">{ev.carrierCode}</span>
                    <span className="text-[10px] text-slate-400">{formatDateTime(ev.time)}</span>
                    <NewBadge firstSeenAt={ev.time} />
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
