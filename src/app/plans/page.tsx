import FilterBar from "@/components/FilterBar";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import { CATEGORY_LABEL, type CarrierCode, type ItemCategory, type ItemVersion, type RoamingItem } from "@/lib/types";
import { formatDateTime, getItemVersions, hasDb, listItems } from "@/lib/db";

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
  const carrier = one(sp.carrier);
  const category = one(sp.category);
  const q = one(sp.q);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  const filters = {
    carrier: carrier as CarrierCode | undefined,
    category: category as ItemCategory | undefined,
    keyword: q,
    dateFrom: from,
    dateTo: to,
    page,
  };

  if (!hasDb()) {
    return (
      <>
        <PlansHeading />
        <EmptyState dbNotConfigured />
      </>
    );
  }

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

  const baseQuery: Record<string, string | undefined> = { carrier, category, q, from, to };

  return (
    <>
      <PlansHeading />
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

function PlansHeading() {
  return (
    <div className="section-heading">
      <div>
        <div className="section-heading__eyebrow">Plans · Services · Promotions</div>
        <h1 className="section-heading__title">요금제 · 부가서비스</h1>
        <p className="section-heading__subtext">
          통신 3사 로밍 상품 아카이브. 카드를 확장하면 가격·내용이 바뀐 시점의 버전 히스토리를 볼 수 있습니다.
        </p>
      </div>
    </div>
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
