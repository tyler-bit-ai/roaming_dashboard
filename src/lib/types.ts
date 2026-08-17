/** DB 행 타입 정의 — db/schema.sql 스키마와 1:1 대응 */

export type CarrierCode = "SKT" | "KT" | "LGU";
export type ItemCategory = "plan" | "service" | "promotion";

/** carriers 테이블 행 */
export interface Carrier {
  id: number;
  code: CarrierCode;
  name: string;
  color: string;
  created_at: string;
}

/** roaming_items 테이블 행 (+ carriers 조인 컬럼) */
export interface RoamingItem {
  id: number;
  carrier_id: number;
  category: ItemCategory;
  name: string;
  url: string;
  region: string | null;
  price: string | null;
  raw: unknown;
  content_hash: string;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  /** 조인 컬럼 */
  carrier_code: CarrierCode;
  carrier_name: string;
  carrier_color: string;
  /** 서브쿼리 컬럼 */
  version_count: number;
}

/** roaming_item_versions 테이블 행 */
export interface ItemVersion {
  id: number;
  item_id: number;
  version_no: number;
  name: string;
  region: string | null;
  price: string | null;
  raw: unknown;
  content_hash: string;
  captured_at: string;
}

/** notices 테이블 행 (+ carriers 조인 컬럼) */
export interface Notice {
  id: number;
  carrier_id: number;
  title: string;
  url: string;
  author: string | null;
  content_preview: string | null;
  content_hash: string;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  /** 조인 컬럼 */
  carrier_code: CarrierCode;
  carrier_name: string;
  carrier_color: string;
}

/** news_articles 테이블 행 */
export interface NewsArticle {
  id: number;
  title: string;
  url: string;
  originallink: string | null;
  source: string | null;
  description: string | null;
  query_keyword: string;
  published_at: string | null;
  first_seen_at: string;
}

/** scrape_runs 테이블 행 */
export interface ScrapeRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "failed" | string;
  trigger: string;
  target: string;
  items_inserted: number;
  items_updated: number;
  items_unchanged: number;
  error_message: string | null;
}

/** 요금제/서비스 가격·이름 변경 이벤트 (최신 버전 vs 직전 버전 diff) */
export interface ChangeEvent {
  item_id: number;
  name: string;
  old_name: string | null;
  category: ItemCategory;
  old_price: string | null;
  new_price: string | null;
  changed_at: string;
  carrier_code: CarrierCode;
  carrier_name: string;
  carrier_color: string;
}

/** 오버뷰 KPI 집계 결과 */
export interface OverviewStats {
  activeItems: number;
  newItems24h: number;
  noticeCount: number;
  newsCount: number;
}

/** 목록 조회 공통 필터 */
export interface ListFilters {
  carrier?: CarrierCode | null;
  category?: ItemCategory | null;
  keyword?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page: number;
}

/** 통신사 메타 (DB 부재 시 폴백용 — CSS 변수와 동일한 색상) */
export const CARRIER_META: Record<CarrierCode, { name: string; color: string }> = {
  SKT: { name: "SK텔레콤", color: "#dc2626" },
  KT: { name: "KT", color: "#2563eb" },
  LGU: { name: "LG유플러스", color: "#0d9488" },
};

/** 카테고리 표시 라벨 */
export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  plan: "요금제",
  service: "부가서비스",
  promotion: "프로모션",
};
