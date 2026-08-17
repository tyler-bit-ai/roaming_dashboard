import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { getLastSyncTime, hasDb, formatDateTime } from "@/lib/db";

export const metadata: Metadata = {
  title: "Roaming Radar — 통신 3사 로밍 모니터링",
  description: "SKT·KT·LG유플러스 로밍 요금제, 부가서비스, 공지사항, 뉴스를 한눈에 추적하는 대시보드",
};

/** 사이드바/헤더에 표시할 마지막 수집 시각 (DB 미연결 시 null) */
async function loadLastSync(): Promise<string | null> {
  if (!hasDb()) return null;
  try {
    return formatDateTime(await getLastSyncTime());
  } catch {
    // DB 연결 실패 시 조용히 폴백 (페이지별 안내에서 상세 처리)
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lastSync = await loadLastSync();

  return (
    <html lang="ko">
      <body>
        <div className="dashboard-shell">
          <Sidebar lastSync={lastSync} />
          <div className="dashboard-main">
            <Header lastSync={lastSync} />
            <main className="dashboard-main__inner">
              <div className="dashboard-content section-stack">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
