"""LG유플러스 (lguplus.com) 스크래퍼.

검증된 구조 (2026-08-17 라이브 분석):
  - 핵심 사실: 데스크톱 UA → CSR 셸(데이터 없음), 모바일 UA → SSR 버전(데이터 포함).
    따라서 모든 LGU+ 요청은 MOBILE_HEADERS(iPhone UA)로 보낸다.
  - /plan/roaming (요금제 목록): 모바일 UA 로도 상품 가격은 CSR — 허브의
    링크/설명(부가서비스·가이드·상품권)만 SSR 되어 수집 가능.
  - /plan/roaming/guide (이용 가이드): 모바일 UA → SSR — 데이터 안심옵션/문자
    건당 요금 등 부가서비스 요금 정보가 HTML 에 포함됨.
  - 공지사항: 안정적인 SSR 경로 미확인 (v1 제외, scrape_runs 에 기록됨).

요금제 목록의 완전한 수집은 별도 렌더링 환경(헤드리스 브라우저 또는 내부 API
역설계)이 필요 — 후속 개선 과제. 현재는 아래 두 소스로 부가서비스/가이드 변경 추적.
"""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from collector.http import fetch
from collector.scrapers.base import BaseCarrierScraper, ScrapedItem, ScrapedNotice

KST = ZoneInfo("Asia/Seoul")

PLAN_PAGE = "https://www.lguplus.com/plan/roaming"
GUIDE_PAGE = "https://www.lguplus.com/plan/roaming/guide?currentTab=TAB1"

# LGU+ 검증 사실(2026-08-17): 반환 페이지가 UA 에 따라 갈린다.
#   - 허브(PLAN_PAGE): 데스크톱 UA 페이지(322KB)에만 링크 존재, 모바일 UA 는 링크 없는 셸
#   - 가이드(GUIDE_PAGE): 모바일 UA 에만 가격 포함 SSR 반환
# 따라서 각 소스에 맞는 UA 를 고정해 요청한다 (랜덤 로테이션 금지).
MOBILE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    ),
}
DESKTOP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}

PRICE_PATTERN = re.compile(r"[\d,]+\s*원")


def _abs(base: str, href: str | None) -> str | None:
    if not href or href.startswith("#") or href.startswith("javascript"):
        return None
    url = urljoin(base, href.strip())
    return url.split("#")[0] or None


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""


def collect_hub_services() -> list[ScrapedItem]:
    """로밍 허브 페이지의 링크형 콘텐츠(부가서비스/가이드/상품권)를 service 항목으로 수집."""
    resp = fetch(PLAN_PAGE, headers=DESKTOP_HEADERS)
    soup = BeautifulSoup(resp.text, "html.parser")
    items: list[ScrapedItem] = []
    for a in soup.find_all("a", href=True):
        url = _abs(PLAN_PAGE, a["href"])
        if not url or "lguplus.com" not in url and "uplus.co.kr" not in url:
            continue
        text = _text(a)
        # 로밍 관련 링크만, 링크 텍스트에 설명이 포함된 카드형만 채택
        if not text or "로밍" not in text or len(text) < 12 or len(text) > 200:
            continue
        if any(skip in text for skip in ("이용 현황", "로그인", "MY")):
            continue
        # 첫 텍스트 조각을 이름으로, 나머지를 설명으로
        parts = text.split(" ")
        name = parts[0] if len(parts) == 1 else " ".join(parts[:4])
        items.append(ScrapedItem(
            name=name[:60],
            url=url,
            category="service",
            raw={"text": text[:300]},
        ))
    unique: dict[str, ScrapedItem] = {}
    for item in items:
        unique.setdefault(item.url, item)
    return list(unique.values())


def collect_guide_services() -> list[ScrapedItem]:
    """이용 가이드 페이지의 요금 정보 수집.

    모바일 UA 로 요청하면 SSR 버전(가격 포함)이 결정적으로 반환된다.
    CDN 이슈 대비 가격 노드가 발견될 때까지 최대 3회 재시도.
    """
    items: list[ScrapedItem] = []
    for _attempt in range(3):
        resp = fetch(GUIDE_PAGE, headers=MOBILE_HEADERS)
        soup = BeautifulSoup(resp.text, "html.parser")
        items = _parse_guide_prices(soup)
        if items:
            return items
    return items


def _parse_guide_prices(soup: BeautifulSoup) -> list[ScrapedItem]:
    """가이드 페이지에서 가격 블록을 service 항목으로 변환."""
    items: list[ScrapedItem] = []
    seen: set[str] = set()
    for tag in soup.find_all(string=PRICE_PATTERN):
        block = tag.find_parent(["li", "div", "tr", "dd"])
        if block is None:
            continue
        text = _text(block)
        if not text or len(text) > 250 or "원" not in text:
            continue
        price_m = PRICE_PATTERN.search(text)
        # 이름 후보: 블록 내 강조/헤딩, 없으면 텍스트 앞부분
        name_node = block.find(["strong", "em", "h3", "h4", "b"])
        name = _text(name_node) or text[:40]
        if name in seen or len(name) < 4:
            continue
        seen.add(name)
        items.append(ScrapedItem(
            name=name[:60],
            url=GUIDE_PAGE,
            category="service",
            price=price_m.group(0) if price_m else None,
            raw={"text": text[:250]},
        ))
    return items


def collect_notices() -> list[ScrapedNotice]:
    """LG유플러스 공지 — 안정적인 SSR 게시판 경로 미확인으로 v1 에서는 미수집.

    scrape_runs 오류에 명시적으로 기록되도록 빈 리스트가 아니라
    안내성 항목 없이 그냥 반환하면 run 결과에 '공지 0건'으로 남는다.
    """
    return []


class LguScraper(BaseCarrierScraper):
    code = "LGU"
    target = "lgu"

    def collect_plans(self) -> list[ScrapedItem]:
        return collect_hub_services() + collect_guide_services()

    def collect_notices(self) -> list[ScrapedNotice]:
        return collect_notices()
