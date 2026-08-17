/**
 * 데이터베이스 접근 레이어 — postgres.js
 * - Supabase pgbouncer 호환: prepare 비활성화
 * - 개발 HMR 간 연결 재사용: globalThis에 캐시
 * - DATABASE_URL 미설정 시 안전하게 빈 상태 UI로 폴백
 *
 * 타이핑 참고: 이 postgres.js 버전은 sql<행배열타입[]> 형태로 제네릭을 받으며
 * 대기 결과가 곧 행 배열이 된다. 동적 WHERE는 조각(fragment) 임베딩으로 조합한다.
 */
import postgres, { type Sql, type PendingQuery } from "postgres";
import type {
  Carrier,
  ItemVersion,
  ListFilters,
  NewsArticle,
  Notice,
  RoamingItem,
  ScrapeRun,
  OverviewStats,
} from "./types";

const PAGE_SIZE = 30;

/** DB가 설정되어 있는지 여부 (미설정이면 페이지가 세팅 안내 UI를 렌더) */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let cached: Sql | null | undefined;

/** postgres.js 클라이언트 (지연 생성) */
export function getSql(): Sql | null {
  if (cached === undefined) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      cached = null;
    } else {
      // 로컬 postgres는 SSL 없이, 원격(Supabase/Neon)은 SSL 필수
      const isLocal = /localhost|127\.0\.0\.1/.test(url);
      cached = postgres(url, {
        prepare: false, // pgbouncer(transaction 모드) 호환
        ssl: isLocal ? false : "require",
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
      });
    }
  }
  return cached;
}

function sqlOrThrow(): Sql {
  const s = getSql();
  if (!s) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  return s;
}

/** 시간 문자열 → "YYYY-MM-DD HH:mm" 표시 형식 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** KST 기준날짜 문자열(YYYY-MM-DD)을 timestamptz 경계 리터럴로 변환 */
function dayStart(date: string): string {
  return `${date} 00:00:00+09:00`;
}

function dayEnd(date: string): string {
  return `${date} 23:59:59+09:00`;
}

/** 통신사 전체 조회 */
export async function getCarriers(): Promise<Carrier[]> {
  return sqlOrThrow()<Carrier[]>`SELECT * FROM carriers ORDER BY id`;
}

/** 오버뷰 KPI 집계 */
export async function getOverviewStats(): Promise<OverviewStats> {
  const rows = await sqlOrThrow()<
    {
      active_items: number;
      new_items_24h: number;
      notice_count: number;
      news_count: number;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM roaming_items WHERE is_active)              AS active_items,
      (SELECT count(*)::int FROM roaming_items WHERE first_seen_at > now() - interval '24 hours')
        + (SELECT count(*)::int FROM notices WHERE first_seen_at > now() - interval '24 hours')
        + (SELECT count(*)::int FROM news_articles WHERE first_seen_at > now() - interval '24 hours')
                                                                              AS new_items_24h,
      (SELECT count(*)::int FROM notices)                                     AS notice_count,
      (SELECT count(*)::int FROM news_articles)                               AS news_count
  `;
  const r = rows[0];
  return {
    activeItems: r?.active_items ?? 0,
    newItems24h: r?.new_items_24h ?? 0,
    noticeCount: r?.notice_count ?? 0,
    newsCount: r?.news_count ?? 0,
  };
}

/** 최근 수집 실행 로그 */
export async function getRecentRuns(limit = 5): Promise<ScrapeRun[]> {
  return sqlOrThrow()<ScrapeRun[]>`
    SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
}

/** 마지막 성공 수집 시각 (헤더/사이드바 표시용) */
export async function getLastSyncTime(): Promise<string | null> {
  const rows = await sqlOrThrow()<{ last: string | null }[]>`
    SELECT max(finished_at)::text AS last FROM scrape_runs WHERE status IN ('success', 'partial')
  `;
  return rows[0]?.last ?? null;
}

/** 최근 24시간 신규 항목 (오버뷰 하이라이트) */
export async function getNewItems(limit = 10): Promise<RoamingItem[]> {
  return sqlOrThrow()<RoamingItem[]>`
    SELECT i.*, c.code AS carrier_code, c.name AS carrier_name, c.color AS carrier_color,
           0 AS version_count
    FROM roaming_items i
    JOIN carriers c ON c.id = i.carrier_id
    WHERE i.first_seen_at > now() - interval '24 hours'
    ORDER BY i.first_seen_at DESC
    LIMIT ${limit}
  `;
}

/** 최근 24시간 신규 공지 (오버뷰 하이라이트) */
export async function getNewNotices(limit = 5): Promise<Notice[]> {
  return sqlOrThrow()<Notice[]>`
    SELECT n.*, c.code AS carrier_code, c.name AS carrier_name, c.color AS carrier_color
    FROM notices n
    JOIN carriers c ON c.id = n.carrier_id
    WHERE n.first_seen_at > now() - interval '24 hours'
    ORDER BY n.first_seen_at DESC
    LIMIT ${limit}
  `;
}

/** 조건 조각들을 AND 로 결합 (postgres.js 이 버전에는 sql.join이 없어 임베딩으로 조합) */
function andAll(conds: PendingQuery<any>[]): PendingQuery<any> {
  return conds.reduce((acc: PendingQuery<any>, c) => sqlOrThrow()`${acc} AND ${c}` as PendingQuery<any>);
}

/** 요금제 목록용 WHERE 조합 */
function itemConditions(sql: Sql, f: ListFilters): PendingQuery<any> {
  const conds: PendingQuery<any>[] = [];
  if (f.carrier) conds.push(sql`c.code = ${f.carrier}`);
  if (f.category) conds.push(sql`i.category = ${f.category}`);
  if (f.keyword) conds.push(sql`i.name ILIKE ${"%" + f.keyword + "%"}`);
  if (f.dateFrom) conds.push(sql`i.first_seen_at >= ${dayStart(f.dateFrom)}::timestamptz`);
  if (f.dateTo) conds.push(sql`i.first_seen_at <= ${dayEnd(f.dateTo)}::timestamptz`);
  if (conds.length === 0) return sql`TRUE`;
  return andAll(conds);
}

/** 요금제/부가서비스/프로모션 목록 (페이지네이션 포함) */
export async function listItems(
  f: ListFilters,
): Promise<{ rows: RoamingItem[]; total: number; pages: number }> {
  const sql = sqlOrThrow();
  const where = itemConditions(sql, f);
  const offset = (f.page - 1) * PAGE_SIZE;

  const [rows, countRows] = await Promise.all([
    sql<RoamingItem[]>`
      SELECT i.*, c.code AS carrier_code, c.name AS carrier_name, c.color AS carrier_color,
             (SELECT count(*)::int FROM roaming_item_versions v WHERE v.item_id = i.id) AS version_count
      FROM roaming_items i
      JOIN carriers c ON c.id = i.carrier_id
      WHERE ${where}
      ORDER BY i.first_seen_at DESC, i.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM roaming_items i
      JOIN carriers c ON c.id = i.carrier_id
      WHERE ${where}
    `,
  ]);

  const total = countRows[0]?.total ?? 0;
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** 표시 중인 요금제들의 버전 히스토리 일괄 조회 (확장 영역 렌더링용) */
export async function getItemVersions(itemIds: number[]): Promise<ItemVersion[]> {
  if (itemIds.length === 0) return [];
  return sqlOrThrow()<ItemVersion[]>`
    SELECT * FROM roaming_item_versions
    WHERE item_id = ANY(${itemIds})
    ORDER BY item_id, version_no ASC
  `;
}

/** 공지사항 목록 */
export async function listNotices(
  f: ListFilters,
): Promise<{ rows: Notice[]; total: number; pages: number }> {
  const sql = sqlOrThrow();
  const conds: PendingQuery<any>[] = [];
  if (f.carrier) conds.push(sql`c.code = ${f.carrier}`);
  if (f.keyword) conds.push(sql`n.title ILIKE ${"%" + f.keyword + "%"}`);
  if (f.dateFrom) conds.push(sql`n.first_seen_at >= ${dayStart(f.dateFrom)}::timestamptz`);
  if (f.dateTo) conds.push(sql`n.first_seen_at <= ${dayEnd(f.dateTo)}::timestamptz`);
  const where = conds.length ? andAll(conds) : sql`TRUE`;
  const offset = (f.page - 1) * PAGE_SIZE;

  const [rows, countRows] = await Promise.all([
    sql<Notice[]>`
      SELECT n.*, c.code AS carrier_code, c.name AS carrier_name, c.color AS carrier_color
      FROM notices n
      JOIN carriers c ON c.id = n.carrier_id
      WHERE ${where}
      ORDER BY n.first_seen_at DESC, n.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM notices n
      JOIN carriers c ON c.id = n.carrier_id
      WHERE ${where}
    `,
  ]);

  const total = countRows[0]?.total ?? 0;
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** 뉴스 목록 (키워드 + 날짜 필터) */
export async function listNews(
  f: ListFilters & { newsKeyword?: string | null },
): Promise<{ rows: NewsArticle[]; total: number; pages: number; keywords: string[] }> {
  const sql = sqlOrThrow();
  const conds: PendingQuery<any>[] = [];
  if (f.newsKeyword) conds.push(sql`a.query_keyword = ${f.newsKeyword}`);
  if (f.keyword) conds.push(sql`a.title ILIKE ${"%" + f.keyword + "%"}`);
  if (f.dateFrom)
    conds.push(sql`coalesce(a.published_at, a.first_seen_at) >= ${dayStart(f.dateFrom)}::timestamptz`);
  if (f.dateTo) conds.push(sql`coalesce(a.published_at, a.first_seen_at) <= ${dayEnd(f.dateTo)}::timestamptz`);
  const where = conds.length ? andAll(conds) : sql`TRUE`;
  const offset = (f.page - 1) * PAGE_SIZE;

  const [rows, countRows, kwRows] = await Promise.all([
    sql<NewsArticle[]>`
      SELECT * FROM news_articles a
      WHERE ${where}
      ORDER BY coalesce(a.published_at, a.first_seen_at) DESC, a.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
    sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM news_articles a WHERE ${where}
    `,
    sql<{ query_keyword: string }[]>`
      SELECT DISTINCT query_keyword FROM news_articles ORDER BY query_keyword
    `,
  ]);

  const total = countRows[0]?.total ?? 0;
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    keywords: kwRows.map((r) => r.query_keyword),
  };
}

/** 페이지 목록 배열 (현재 페이지 주변 5개) */
export function pageRange(pages: number, current: number): number[] {
  const window = 5;
  const start = Math.max(1, Math.min(current - Math.floor(window / 2), pages - window + 1));
  const end = Math.min(pages, start + window - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
