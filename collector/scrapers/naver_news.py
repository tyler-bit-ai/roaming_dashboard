"""네이버 로밍 뉴스 수집기 — 공식 Search API 방식.

C:\\Codex\\NewsCollectorVersel/src/collectors/naver_collector.py 의 검증된 패턴 재사용:
  - https://openapi.naver.com/v1/search/news.json (X-Naver-Client-Id/Secret 헤더)
  - 요청 간 0.3초 딜레이 + 429 레이트리밋 처리
  - pubDate(RFC2822) → tz-aware datetime 변환
  - 네이버 리디렉션 링크 정제
"""
from __future__ import annotations

import re
import time
from email.utils import parsedate_to_datetime

import psycopg
import requests

from collector.config import Settings

BASE_URL = "https://openapi.naver.com/v1/search"
REQUEST_DELAY = 0.3  # 초당 요청 한도(무료 10/s) 대비 딜레이

# 로밍 모니터링용 검색어 세트
QUERIES = [
    "로밍 요금제",
    "로밍 프로모션",
    "SKT 로밍",
    "KT 로밍",
    "LG유플러스 로밍",
    "로밍 eSIM",
]
DISPLAY_PER_QUERY = 30


def _clean_naver_news_link(link: str) -> str:
    """네이버 뉴스 링크 정제 — 모바일 도메인 통합 및 빈 링크 처리."""
    if not link:
        return ""
    link = link.replace("n.news.naver.com", "news.naver.com")
    link = re.sub(r"\?.*$", "", link) if link.endswith("=") else link
    return link.strip()


def _strip_html(text: str | None) -> str | None:
    """API description 에 포함된 HTML 태그/엔티티 제거."""
    if not text:
        return None
    text = re.sub(r"<[^>]+>", "", text)
    for entity, char in (("&quot;", '"'), ("&amp;", "&"), ("&lt;", "<"),
                         ("&gt;", ">"), ("&nbsp;", " ")):
        text = text.replace(entity, char)
    return text.strip()


def collect_news(settings: Settings) -> list[dict]:
    """검색어별로 네이버 뉴스를 수집해 정규화된 기사 dict 리스트 반환."""
    if not settings.naver_client_id or not settings.naver_client_secret:
        raise RuntimeError("NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.")

    headers = {
        "X-Naver-Client-Id": settings.naver_client_id,
        "X-Naver-Client-Secret": settings.naver_client_secret,
    }
    articles: list[dict] = []
    for query in QUERIES:
        params = {"query": query, "display": DISPLAY_PER_QUERY, "sort": "date"}
        try:
            resp = requests.get(
                f"{BASE_URL}/news.json", headers=headers, params=params, timeout=10,
            )
            if resp.status_code == 429:
                # 레이트리밋 — 잠시 대기 후 1회만 재시도
                time.sleep(1.0)
                resp = requests.get(
                    f"{BASE_URL}/news.json", headers=headers, params=params, timeout=10,
                )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError):
            continue  # 개별 검색어 실패는 건너뛰고 계속

        for item in data.get("items", []):
            link = _clean_naver_news_link(item.get("link", ""))
            if not link:
                continue
            published = None
            try:
                published = parsedate_to_datetime(item.get("pubDate", ""))
            except (TypeError, ValueError):
                published = None
            title = _strip_html(item.get("title")) or ""
            if not title:
                continue
            articles.append({
                "title": title,
                "url": link,
                "originallink": item.get("originallink") or None,
                "source": _strip_html(item.get("originallink")).split("/")[2] if item.get("originallink", "").startswith("http") else None,
                "description": _strip_html(item.get("description")),
                "query_keyword": query,
                "published_at": published,
            })
        time.sleep(REQUEST_DELAY)
    return articles


def run(settings: Settings, conn: psycopg.Connection) -> dict:
    """뉴스 수집 + DB 적재. 파이프라인 공통 형태의 결과 dict 반환."""
    from collector import db  # 지연 import — 순환 참조 방지

    articles = collect_news(settings)
    inserted = db.upsert_news_articles(conn, articles)
    conn.commit()
    # URL 기준 중복 제거된 수집 수
    unique_count = len({a["url"] for a in articles})
    return {
        "target": "naver",
        "inserted": inserted,
        "updated": 0,
        "unchanged": unique_count - inserted,
        "errors": [] if articles else ["수집된 기사 없음 — API 키/네트워크 확인 필요"],
        "collected": unique_count,
        "skipped_duplicate": unique_count - inserted,
    }
