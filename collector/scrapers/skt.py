"""SKT (T로밍) 스크래퍼.

대상:
  - T로밍 포털 랜딩(https://troaming.tworld.co.kr/)과 그 하위 정적 상품 페이지(/poc/roaming/*.html)
  - T월드 모바일 로밍 요금 페이지(https://m.tworld.co.kr/product/roaming/fee)
  - SKT 공지사항(https://www.sktelecom.com/kor/notice/list.do) — '로밍' 키워드 필터

포털이 정적 HTML 하위페이지 구조이므로 requests+BS4 로 수집 가능하다.
셀렉터는 1차 구현이며 scrape_runs 오류 로그를 보고 조정한다.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from collector import http
from collector.scrapers.base import BaseCarrierScraper, ScrapedItem, ScrapedNotice

KST = ZoneInfo("Asia/Seoul")

M_FEE_PAGE = "https://m.tworld.co.kr/product/roaming/fee"
# 구 경로 /kor/notice/list.do 는 소프트 404 반환(2026-08-17 확인) — 실제 게시판은 아래 경로
NOTICE_LIST = "https://www.sktelecom.com/customer/notice.do"
NOTICE_PAGES = 3          # 수집할 페이지 수
NOTICE_KEYWORDS = ("로밍", "eSIM", "해외", "국제")

PRICE_PATTERN = re.compile(r"[\d,]+\s*원")
DATA_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|MB|무제한)", re.I)


def _abs(base: str, href: str | None) -> str | None:
    if not href:
        return None
    url = urljoin(base, href.strip())
    return url.split("#")[0] or None


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""


def collect_fee_page_products() -> list[ScrapedItem]:
    """T월드 모바일 로밍 요금 페이지 — 페이지에 임베드된 제품 JSON 에서 상품 추출.

    검증된 구조: 스크립트 내에 basFeeInfo/prodNm/prodId/price/data/duration 필드를 가진
    평탄한 JSON 객체들이 포함되어 있음 (라이브 테스트 2026-08-17, 42객체/유니크 12).
    상세 페이지 URL 패턴: /web/product/callplan/{prodId}
    """
    try:
        resp = http.fetch(M_FEE_PAGE)
    except Exception:  # noqa: BLE001 — 페이지 구조 변경/차단 시 스킵
        return []
    objects = re.findall(r"\{[^{}]*\"basFeeInfo\"[^{}]*\}", resp.text)
    items: list[ScrapedItem] = []
    for obj_text in objects:
        try:
            obj = json.loads(obj_text)
        except json.JSONDecodeError:
            continue
        name = (obj.get("prodNm") or "").strip()
        if not name:
            continue
        prod_id = obj.get("prodId") or ""
        item_url = (
            f"https://troaming.tworld.co.kr/web/product/callplan/{prod_id}"
            if prod_id else M_FEE_PAGE
        )
        benefit = obj.get("prodBasBenfCtt") or ""
        # 카테고리 분류: 할인/부가서비스형 → service, 프로모션 언급 → promotion, 나머지 → plan
        if re.search(r"할인|가족로밍|Wi-?Fi|기내", name):
            category = "service"
        elif "프로모션" in benefit:
            category = "promotion"
        else:
            category = "plan"
        items.append(ScrapedItem(
            name=name,
            url=item_url,
            category=category,
            price=obj.get("price"),
            raw={
                "prodId": prod_id,
                "data": obj.get("data"),
                "duration": obj.get("duration"),
                "benefit": benefit,
                "summary": obj.get("prodSmryDesc"),
                "basFeeInfo": obj.get("basFeeInfo"),
            },
        ))
    # 페이지에 동일 JSON이 2회 임베드되므로 prodId(URL) 기준 중복 제거
    unique: dict[str, ScrapedItem] = {}
    for item in items:
        unique.setdefault(item.url, item)
    return list(unique.values())


def collect_notices() -> list[ScrapedNotice]:
    """SKT 공지사항 게시판 (/customer/notice.do, SSR 확인됨 2026-08-17).

    구조: a[href*='notice_detail.do'] 링크 텍스트 = '제목 YYYY.MM.DD' 형태.
    로밍 관련 키워드가 제목에 포함된 게시글만 채택 (NOTICE_PAGES 페이지 순회).
    """
    notices: list[ScrapedNotice] = []
    for page in range(1, NOTICE_PAGES + 1):
        try:
            resp = http.fetch(NOTICE_LIST, params={"currentPage": page})
        except Exception:  # noqa: BLE001 — 페이지 실패는 나머지 페이지로 계속
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        page_links = [
            a for a in soup.find_all("a", href=True)
            if "notice_detail.do" in a.get("href", "")
        ]
        if not page_links:
            break  # 게시판 구조 변경 또는 마지막 페이지 도달
        for node in page_links:
            text = _text(node)
            if not text:
                continue
            # 링크 텍스트 = '제목 날짜' — 끝의 날짜 분리
            date_m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", text)
            title = text[: date_m.start()].strip() if date_m else text.strip()
            if not title or not any(k in title for k in NOTICE_KEYWORDS):
                continue
            url = _abs(NOTICE_LIST, node.get("href"))
            if not url:
                continue
            published = None
            if date_m:
                try:
                    published = datetime(
                        int(date_m.group(1)), int(date_m.group(2)),
                        int(date_m.group(3)), tzinfo=KST,
                    )
                except ValueError:
                    published = None
            notices.append(ScrapedNotice(title=title, url=url, published_at=published))
    unique: dict[str, ScrapedNotice] = {}
    for n in notices:
        unique.setdefault(n.url, n)
    return list(unique.values())


class SktScraper(BaseCarrierScraper):
    code = "SKT"
    target = "skt"

    def collect_plans(self) -> list[ScrapedItem]:
        # m요금 페이지의 임베디드 JSON 이 유일한 안정 소스 (2026-08-17 검증):
        # 포털/callplan 페이지는 JS 셸이라 데이터 없음. baro 프로모션 상품도
        # benefit 필드의 '프로모션' 키워드로 category=promotion 이 잡힌다.
        return collect_fee_page_products()

    def collect_notices(self) -> list[ScrapedNotice]:
        return collect_notices()
