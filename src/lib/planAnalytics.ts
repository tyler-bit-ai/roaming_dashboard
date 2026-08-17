/**
 * 요금제 원본(raw JSONB)에서 비교 가능한 수치를 뽑아내는 유틸.
 *
 * 통신사마다 raw 필드 이름이 다르다(SKT/KT는 "data": "4GB" 문자열,
 * LGU+는 "data_gb": 4.0 숫자를 이미 계산해서 넣어둠) — 여기서 하나로 정규화한다.
 * GB/가격을 뽑을 수 없는 상품(무제한, 데이터 나눠쓰기 부가서비스 등)은 null 반환 —
 * 호출부에서 "비교 불가" 로 분리 처리한다.
 */

const GB_PATTERN = /(\d+(?:\.\d+)?)\s*GB/i;
const MB_PATTERN = /(\d+(?:\.\d+)?)\s*MB/i;
const WON_PATTERN = /(\d[\d,]*)\s*원/;

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/** 상품의 데이터 제공량(GB). 정수/소수 GB로 정규화, 못 찾으면 null(무제한/비GB성 상품). */
export function extractDataGb(raw: unknown, name: string): number | null {
  const r = asRecord(raw);
  if (typeof r.data_gb === "number" && r.data_gb > 0) return r.data_gb;

  const candidates = [r.data, name].filter((v): v is string => typeof v === "string");
  for (const text of candidates) {
    const gbMatch = text.match(GB_PATTERN);
    if (gbMatch) return parseFloat(gbMatch[1]);
    const mbMatch = text.match(MB_PATTERN);
    if (mbMatch) return Math.round((parseFloat(mbMatch[1]) / 1024) * 100) / 100;
  }
  return null;
}

/** 표시용 가격 문자열에서 원화 숫자 추출 ("29,000원" → 29000). */
export function extractWon(price: string | null | undefined): number | null {
  if (!price) return null;
  const m = price.replace(/,/g, "").match(WON_PATTERN);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * "표준 판매 요금제"인지 판별 — 나눠쓰기(회선 공유) 같은 부가 상품은 제외해야 한다.
 * 예: LGU+ "로밍패스 나눠쓰기"는 3,000원에 대표회선의 데이터를 "최대 25GB까지 공유"
 * 받는 부가상품이라 raw.data_gb=25가 들어있지만, 3,000원이 25GB 값이 아니라
 * 공유 수수료다 — GB당 단가 계산에 넣으면 통신사 최저가처럼 왜곡되어 보인다.
 */
export function isStandalonePlan(raw: unknown): boolean {
  const r = asRecord(raw);
  const group = typeof r.group === "string" ? r.group : "";
  const category = typeof r.category === "string" ? r.category : "";
  return !group.includes("나눠쓰기") && !category.includes("나눠쓰기");
}

/** GB당 단가(원) — 가격/용량 둘 다 뽑을 수 있고 표준 요금제일 때만 값 반환. */
export function wonPerGb(price: string | null, raw: unknown, name: string): number | null {
  if (!isStandalonePlan(raw)) return null;
  const won = extractWon(price);
  const gb = extractDataGb(raw, name);
  if (!won || !gb) return null;
  return Math.round(won / gb);
}

/** 상품의 이용 기간(일) — SKT raw.duration(숫자) 또는 LGU raw.term("최대 30일") 텍스트 지원. */
export function extractDurationLabel(raw: unknown): string | null {
  const r = asRecord(raw);
  if (typeof r.duration === "number") return `${r.duration}일`;
  if (typeof r.term === "string" && r.term.trim()) return r.term.trim();
  return null;
}
