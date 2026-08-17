import FilterBar from "@/components/FilterBar";
import NewBadge from "@/components/NewBadge";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import { formatDateTime, hasDb, listNews } from "@/lib/db";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** 네이버 API가 반환하는 HTML 엔티티 제거 */
function decodeEntities(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/<b>/g, "")
    .replace(/<\/b>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kw = one(sp.kw);
  const q = one(sp.q);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  if (!hasDb()) {
    return (
      <>
        <NewsHeading />
        <EmptyState dbNotConfigured />
      </>
    );
  }

  let result: Awaited<ReturnType<typeof listNews>>;
  try {
    result = await listNews({
      keyword: q,
      newsKeyword: kw,
      dateFrom: from,
      dateTo: to,
      page,
    });
  } catch (err) {
    return (
      <EmptyState
        message={`DB 조회 실패: ${err instanceof Error ? err.message : String(err)} — db/schema.sql 적용 여부를 확인하세요.`}
      />
    );
  }

  const baseQuery: Record<string, string | undefined> = { kw, q, from, to };

  return (
    <>
      <NewsHeading />
      <FilterBar
        initial={{ keyword: q, newsKeyword: kw, dateFrom: from, dateTo: to }}
        showNewsKeyword
        newsKeywordOptions={result.keywords}
      />

      {result.rows.length === 0 ? (
        <EmptyState message="조건에 맞는 기사가 없습니다. NAVER_CLIENT_ID/SECRET 설정 후 수집을 실행해주세요." />
      ) : (
        <section className="surface-card">
          {result.rows.map((article) => (
            <article key={article.id} className="list-card-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] font-semibold text-slate-800 hover:text-[var(--accent-strong)]"
                  >
                    {decodeEntities(article.title) || "(제목 없음)"}
                  </a>
                  <NewBadge firstSeenAt={article.first_seen_at} />
                </div>
                {article.description && (
                  <div className="mt-1 line-clamp-2 max-w-[720px] text-[11px] leading-[1.5] text-slate-500">
                    {decodeEntities(article.description)}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {article.source && <span className="pill-badge">{article.source}</span>}
                  <span className="pill-badge">{article.query_keyword}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] text-slate-600">{formatDateTime(article.published_at)}</div>
                {article.originallink && (
                  <a
                    href={article.originallink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-block text-[10px] text-slate-400 hover:text-[var(--accent)]"
                  >
                    언론사 원문 ↗
                  </a>
                )}
              </div>
            </article>
          ))}
          <div style={{ padding: "0 16px 14px" }}>
            <Pagination page={page} pages={result.pages} total={result.total} baseQuery={baseQuery} />
          </div>
        </section>
      )}
    </>
  );
}

function NewsHeading() {
  return (
    <div className="section-heading">
      <div>
        <div className="section-heading__eyebrow">Roaming News Archive</div>
        <h1 className="section-heading__title">로밍 뉴스</h1>
        <p className="section-heading__subtext">
          네이버 Search API로 수집한 로밍 관련 기사 아카이브. 과거 기사도 언제든 검색할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
