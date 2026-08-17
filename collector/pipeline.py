"""수집 오케스트레이션 — 스크래퍼 실행 + 실행 로그 기록."""
from __future__ import annotations

from collector import db
from collector.config import Settings
from collector.scrapers import naver_news
from collector.scrapers.kt import KtScraper
from collector.scrapers.lgu import LguScraper
from collector.scrapers.skt import SktScraper

SCRAPERS = {
    "skt": SktScraper,
    "kt": KtScraper,
    "lgu": LguScraper,
}


def run_collection(settings: Settings, *, target: str, trigger: str) -> dict:
    """지정 대상(skt|kt|lgu|naver|all) 수집 실행. 요약 dict 반환."""
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL 환경변수가 설정되지 않았습니다.")

    targets: list[str]
    if target == "all":
        targets = ["skt", "kt", "lgu", "naver"]
    else:
        targets = [target]

    summary: dict = {"trigger": trigger, "results": []}
    conn = db.get_conn(settings.database_url)
    try:
        carrier_ids = db.get_carrier_ids(conn)
        overall_status = "success"
        total_inserted = total_updated = total_unchanged = 0
        error_notes: list[str] = []

        for t in targets:
            run_id = db.start_run(conn, target=t, trigger=trigger)
            conn.commit()
            try:
                if t == "naver":
                    result = naver_news.run(settings, conn)
                    total_inserted += result["inserted"]
                else:
                    scraper = SCRAPERS[t]()
                    if scraper.code not in carrier_ids:
                        raise RuntimeError(f"carriers 테이블에 {scraper.code} 가 없습니다 — db/schema.sql 을 먼저 실행하세요.")
                    sr = scraper.run(conn, carrier_ids[scraper.code])
                    result = {
                        "target": sr.target,
                        "inserted": sr.inserted,
                        "updated": sr.updated,
                        "unchanged": sr.unchanged,
                        "errors": sr.errors,
                    }
                    total_inserted += sr.inserted
                    total_updated += sr.updated
                    total_unchanged += sr.unchanged
                    error_notes.extend(f"[{t}] {e}" for e in sr.errors)
                status = "partial" if result["errors"] else "success"
                if status == "partial":
                    overall_status = "partial"
                db.finish_run(
                    conn, run_id,
                    status=status,
                    inserted=result["inserted"],
                    updated=result["updated"],
                    unchanged=result["unchanged"],
                    error_message="\n".join(result["errors"]) or None,
                )
                conn.commit()
                summary["results"].append(result)
            except Exception as exc:  # noqa: BLE001 — 대상 1개 실패가 전체 중단시키지 않도록
                conn.rollback()
                overall_status = "partial"
                db.finish_run(
                    conn, run_id, status="failed",
                    inserted=0, updated=0, unchanged=0,
                    error_message=str(exc),
                )
                conn.commit()
                summary["results"].append({"target": t, "error": str(exc)})

        summary["status"] = overall_status
        summary["total"] = {
            "inserted": total_inserted,
            "updated": total_updated,
            "unchanged": total_unchanged,
        }
        if error_notes:
            summary["notes"] = error_notes
        return summary
    finally:
        conn.close()
