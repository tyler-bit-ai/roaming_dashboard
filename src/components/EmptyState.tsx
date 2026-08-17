/**
 * 빈 상태 안내 카드 — 데이터 없음 / DB 미연결 두 가지 상황 지원
 */
interface EmptyStateProps {
  /** DB 자체가 미연결인 경우 (DATABASE_URL 없음) */
  dbNotConfigured?: boolean;
  /** 안내 문구 */
  message?: string;
}

export default function EmptyState({ dbNotConfigured = false, message }: EmptyStateProps) {
  if (dbNotConfigured) {
    return (
      <div className="inset-card">
        <div className="section-title text-[var(--warning)]">⚠️ 데이터베이스가 연결되지 않았습니다</div>
        <div className="section-copy">
          DATABASE_URL 환경변수가 설정되지 않았습니다. db/schema.sql 로 Supabase/Neon에 테이블을 만들고,
          .env.local 의 DATABASE_URL 을 채운 뒤 서버를 재시작하세요. 자세한 내용은 README.md 를 참고하세요.
        </div>
      </div>
    );
  }

  return (
    <div className="inset-card">
      <div className="section-title">수집된 데이터가 없습니다</div>
      <div className="section-copy">
        {message ?? "수집 작업을 한 번도 실행하지 않았습니다. /api/manual/collect 를 실행하거나 매일 09:00(KST) 크론잡을 기다려주세요."}
      </div>
    </div>
  );
}
