import Link from "next/link";
import FilterBar from "@/components/FilterBar";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import {
  CATEGORY_LABEL,
  type CarrierCode,
  type ItemCategory,
  type ItemVersion,
  type RoamingItem,
} from "@/lib/types";
import { formatDateTime, getActivePlans, getItemVersions, hasDb, listItems } from "@/lib/db";
import { extractDataGb, extractDurationLabel, extractWon, wonPerGb } from "@/lib/planAnalytics";

export const dynamic = "force-dynamic";

/** searchParams 값 정규화 (string | string[] → string) */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlansPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const view = one(sp.view) === "list" ? "list" : "compare";

  if (!hasDb()) {
    return (
      <>
        <PlansHeading view={view} />
        <EmptyState dbNotConfigured />
      </>
    );
  }

  return (
    <>
      <PlansHeading view={view} />
      {view === "compare" ? <ComparePlansView /> : <ListPlansView searchParams={sp} />}
    </>
  );
}

function PlansHeading({ view }: { view: "compare" | "list" }) {
  return (
    <div className="section-heading">
      <div>
        <div className="section-heading__eyebrow">Plans · Services · Promotions</div>
        <h1 className="section-heading__title">요금제 · 부가서비스</h1>
        <p className="section-heading__subtext">
          {view === "compare"
            ? "활성 요금제를 GB당 단가 기준으로 3사 통합 정렬했습니다. SKT 상품은 왼쪽에 강조 표시됩니다."
            : "통신사·부가서비스까지 포함한 전체 상품 아카이브. 카드를 확장하면 버전 히스토리를 볼 수 있습니다."}
        </p>
      </div>
      <div className="detail-tabbar surface-card">
        <Link href="/plans?view=compare" className={`detail-tabbar__button${view === "compare" ? " detail-tabbar__button--active" : ""}`}>
          요금 비교
        </Link>
        <Link href="/plans?view=list" className={`detail-tabbar__button${view === "list" ? " detail-tabbar__button--active" : ""}`}>
          전체 목록
        </Link>
      </div>
    </div>
  );
}

/** 기본 뷰 — GB당 단가로 3사 요금제를 통합 정렬한 비교 랭킹 */
async function ComparePlansView() {
  let plans: RoamingItem[];
  try {
    plans = await getActivePlans();
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회 실패: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부를 확인하세요.`}
      />
    );
  }

  const ranked = plans
    .map((item) => ({
      item,
      won: extractWon(item.price),
      gb: extractDataGb(item.raw, item.name),
      perGb: wonPerGb(item.price, item.raw, item.name),
      duration: extractDurationLabel(item.raw),
    }))
    .filter((r): r is typeof r & { perGb: number } => r.perGb !== null)
    .sort((a, b) => a.perGb - b.perGb);

  const excludedCount = plans.length - ranked.length;

  if (ranked.length === 0) {
    return (
      <EmptyState message="GB당 단가를 비교할 수 있는 활성 요금제가 없습니다. /api/manual/collect 로 수집을 실행해주세요." />
    );
  }

  return (
    <section className="surface-card">
      <div className="overflow-x-auto">
        <table className="content-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>통신사</th>
              <th>요금제</th>
              <th>데이터</th>
              <th>기간</th>
              <th>대상 지역/국가</th>
              <th className="text-right">가격</th>
              <th className="text-right">GB당 단가</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, idx) => {
              const isSkt = r.item.carrier_code === "SKT";
              const rank = idx + 1;
              return (
                <tr key={r.item.id} className={isSkt ? "compare-row--self" : undefined}>
                  <td>
                    <span className={`compare-rank${rank <= 3 ? " compare-rank--top" : ""}`}>{rank}</span>
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="carrier-dot" style={{ background: r.item.carrier_color }} />
                      <span className="text-[11px] font-medium">{r.item.carrier_name}</span>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      {r.item.name}
                      <NewBadge firstSeenAt={r.item.first_seen_at} />
                    </span>
                  </td>
                  <td className="content-table__muted">{r.gb !== null ? `${r.gb}GB` : "-"}</td>
                  <td className="content-table__muted">{r.duration ?? "-"}</td>
                  <td className="content-table__muted">{r.item.region ?? "-"}</td>
                  <td className="content-table__number">{r.item.price ?? "-"}</td>
                  <td className="content-table__number">
                    <strong>{r.perGb.toLocaleString()}원</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {excludedCount > 0 && (
        <div className="section-copy" style={{ padding: "10px 16px 14px" }}>
          무제한·데이터 나눠쓰기 등 GB당 단가를 계산할 수 없는 상품 {excludedCount}건은 이 비교에서 제외했습니다 —{" "}
          <Link href="/plans?view=list" className="action-link">
            전체 목록
          </Link>
          에서 확인하세요.
        </div>
      )}
    </section>
  );
}

/** 보조 뷰 — 기존 필터 기반 전체 카드 목록(요금제+부가서비스+프로모션, 버전 히스토리 포함) */
async function ListPlansView({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const carrier = one(searchParams.carrier);
  const category = one(searchParams.category);
  const q = one(searchParams.q);
  const from = one(searchParams.from);
  const to = one(searchParams.to);
  const page = Math.max(1, Number(one(searchParams.page) ?? 1) || 1);

  const filters = {
    carrier: carrier as CarrierCode | undefined,
    category: category as ItemCategory | undefined,
    keyword: q,
    dateFrom: from,
    dateTo: to,
    page,
  };

  let result: Awaited<ReturnType<typeof listItems>>;
  try {
    result = await listItems(filters);
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회 실패: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부를 확인하세요.`}
      />
    );
  }

  // 표시 중인 항목의 버전 히스토리 일괄 조회 (확장 영역용)
  let versionsByItem = new Map<number, ItemVersion[]>();
  if (result.rows.length > 0) {
    try {
      const versions = await getItemVersions(result.rows.map((r) => r.id));
      versionsByItem = versions.reduce((acc, v) => {
        const list = acc.get(v.item_id) ?? [];
        list.push(v);
        acc.set(v.item_id, list);
        return acc;
      }, new Map<number, ItemVersion[]>());
    } catch {
      // 버전 조회 실패는 목록 표시에 영향 없음
    }
  }

  const baseQuery: Record<string, string | undefined> = { view: "list", carrier, category, q, from, to };

  return (
    <>
      <FilterBar initial={{ carrier, category, keyword: q, dateFrom: from, dateTo: to }} showCarrier showCategory />

      {result.rows.length === 0 ? (
        <EmptyState message="조건에 맞는 상품이 없습니다. 필터를 변경하거나 /api/manual/collect 로 수집을 실행해주세요." />
      ) : (
        <section className="surface-card">
          <div className="dashboard-grid" style={{ gap: 10, padding: "10px" }}>
            {result.rows.map((item) => (
              <PlanCard key={item.id} item={item} versions={versionsByItem.get(item.id) ?? []} />
            ))}
          </div>
          <div style={{ padding: "0 16px 14px" }}>
            <Pagination page={page} pages={result.pages} total={result.total} baseQuery={baseQuery} />
          </div>
        </section>
      )}
    </>
  );
}

/** 요금제 카드 + 버전 히스토리 확장 (<details> — JS 없이 동작) */
function PlanCard({ item, versions }: { item: RoamingItem; versions: ItemVersion[] }) {
  return (
    <article className="surface-card surface-card--compact">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="carrier-dot" style={{ background: item.carrier_color }} />
            <span className="text-[13px] font-semibold text-slate-900">{item.name}</span>
            <NewBadge firstSeenAt={item.first_seen_at} />
            {!item.is_active && <span className="pill-badge">단종</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="pill-badge">{item.carrier_name}</span>
            <span className="pill-badge">{CATEGORY_LABEL[item.category]}</span>
            {item.price && <span className="pill-badge">{item.price}</span>}
            {item.region && <span className="pill-badge">{item.region}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="muted-label">First seen</div>
          <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(item.first_seen_at)}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="action-link text-[11px]"
        >
          출처 보기 ↗
        </a>
        {versions.length > 1 && (
          <details className="version-details">
            <summary>변경 이력 {versions.length}건</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="content-table">
                <thead>
                  <tr>
                    <th>버전</th>
                    <th>이름</th>
                    <th>가격</th>
                    <th>지역</th>
                    <th>수집 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td className="content-table__muted">v{v.version_no}</td>
                      <td>{v.name}</td>
                      <td className="content-table__muted">{v.price ?? "-"}</td>
                      <td className="content-table__muted">{v.region ?? "-"}</td>
                      <td className="content-table__muted">{formatDateTime(v.captured_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
