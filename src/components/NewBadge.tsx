/**
 * NEW 뱃지 — first_seen_at이 24시간 이내인 항목에 표시
 * (globals.css의 .new-badge 펄스 애니메이션 사용)
 */
interface NewBadgeProps {
  /** ISO 시간 문자열 (DB first_seen_at) */
  firstSeenAt: string | null | undefined;
  /** 기준 시각(생략 시 현재) — SSR/CSR 불일치 방지용으로 서버에서 주입 가능 */
  now?: string;
}

/** 24시간 이내 신규 여부 판정 (페이지 로직에서도 재사용) */
export function isNew(firstSeenAt: string | null | undefined, now: string = new Date().toISOString()): boolean {
  if (!firstSeenAt) return false;
  const t = new Date(firstSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  return t > new Date(now).getTime() - 24 * 60 * 60 * 1000;
}

export default function NewBadge({ firstSeenAt, now }: NewBadgeProps) {
  if (!isNew(firstSeenAt, now)) return null;
  return <span className="new-badge">NEW</span>;
}
