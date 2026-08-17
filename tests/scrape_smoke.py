"""스크래퍼 라이브 스모크 테스트 — 실제 통신사 사이트에서 수집 함수를 호출해 결과를 출력.

사용법: python tests/scrape_smoke.py [skt|kt|lgu|naver]
(인자 없으면 통신사 3개 모두 실행 — 네이버는 API 키 필요해 .env 있을 때만 수행)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.scrapers.kt import collect_notices as kt_notices  # noqa: E402
from collector.scrapers.kt import collect_products as kt_products  # noqa: E402
from collector.scrapers.lgu import collect_guide_services as lgu_guide  # noqa: E402
from collector.scrapers.lgu import collect_hub_services as lgu_hub  # noqa: E402
from collector.scrapers.skt import collect_fee_page_products as skt_fee  # noqa: E402
from collector.scrapers.skt import collect_notices as skt_notices  # noqa: E402


def show(label: str, rows: list, fields: tuple[str, ...]) -> None:
    print(f"\n[{label}] {len(rows)}건")
    for row in rows[:5]:
        print("  -", " | ".join(str(getattr(row, f) or "-")[:60] for f in fields))


def main() -> None:
    targets = sys.argv[1:] or ["skt", "kt", "lgu"]

    if "skt" in targets:
        print("=" * 60, "\nSKT (T로밍)")
        try:
            items = skt_fee()
            show("상품(임베디드 JSON)", items, ("name", "price", "url"))
        except Exception as exc:
            print("  [상품 실패]", exc)
        try:
            rows = skt_notices()
            show("공지(로밍 키워드)", rows, ("title", "url"))
        except Exception as exc:
            print("  [공지 실패]", exc)

    if "kt" in targets:
        print("=" * 60, "\nKT (globalroaming)")
        try:
            items = kt_products()
            show("상품", items, ("name", "price", "url"))
        except Exception as exc:
            print("  [상품 실패]", exc)
        try:
            rows = kt_notices()
            show("공지", rows, ("title", "url"))
        except Exception as exc:
            print("  [공지 실패]", exc)

    if "lgu" in targets:
        print("=" * 60, "\nLG유플러스")
        try:
            items = lgu_hub()
            show("허브 서비스", items, ("name", "price", "url"))
        except Exception as exc:
            print("  [허브 실패]", exc)
        try:
            items = lgu_guide()
            show("가이드 요금", items, ("name", "price", "url"))
        except Exception as exc:
            print("  [가이드 실패]", exc)

    if "naver" in targets:
        print("=" * 60, "\n네이버 뉴스")
        if os.getenv("NAVER_CLIENT_ID") and os.getenv("NAVER_CLIENT_SECRET"):
            from collector.scrapers import naver_news
            from collector.config import load_settings
            articles = naver_news.collect_news(load_settings())
            show("뉴스", articles, ("title", "query_keyword"))
        else:
            print("  [스킵] NAVER_CLIENT_ID/SECRET 미설정")


if __name__ == "__main__":
    main()
