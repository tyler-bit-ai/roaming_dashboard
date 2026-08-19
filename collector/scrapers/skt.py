"""SKT (T로밍) 스크래퍼.

대상:
  - T월드 모바일 로밍 요금 페이지(https://m.tworld.co.kr/product/roaming/fee)
  - T로밍 전용 공지사항(https://www.tworld.co.kr/web/support/notice/roaming)

검증된 사실(2026-08-18):
  - 공지사항은 www.sktelecom.com 의 범용 게시판이 아니라 T로밍 전용 게시판이 따로 있다.
    페이지 자체는 CSR(BFF)이지만 실제 데이터는 공개 REST 엔드포인트
    (www.tworld.co.kr/core-modification/v1/notice-roaming)에서 내려오며, Referer 헤더만
    페이지 URL로 채워주면 인증 없이 200을 반환한다(수만 건 규모 게시판, 로밍 키워드 필터 불필요 —
    게시판 자체가 로밍 전용). 상세 URL 패턴: /web/support/notice/roaming/detail/{serNum}.
  - baro 요금제는 3/8/16/32/64GB, baro YT 는 4/9/17/33/65GB 로 총 10개 용량 티어가 존재하는데
    전부 동일한 prodId(NA00007668, T로밍 랜딩 상세페이지 하나에서 용량을 선택하는 구조)를 공유한다.
    과거 코드는 이 prodId로 만든 URL만으로 dedup 해서 9개 티어가 사라지는 버그가 있었다 —
    URL+이름 조합으로 dedup 해야 한다(DB 유니크 키 (carrier,category,url,name)와 동일한 기준).
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from html import unescape as html_unescape
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from collector import http
from collector.scrapers.base import BaseCarrierScraper, ScrapedItem, ScrapedNotice

KST = ZoneInfo("Asia/Seoul")

M_FEE_PAGE = "https://m.tworld.co.kr/product/roaming/fee"

NOTICE_PAGE_URL = "https://www.tworld.co.kr/web/support/notice/roaming"
NOTICE_API = "https://www.tworld.co.kr/core-modification/v1/notice-roaming"
NOTICE_DETAIL = "https://www.tworld.co.kr/web/support/notice/roaming/detail/{sernum}"
MAX_NOTICE_PAGES = 20     # 페이지당 10건 — 안전 상한(신규 배포 첫 실행 시 백필용)

PRICE_PATTERN = re.compile(r"[\d,]+\s*원")
DATA_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|MB|무제한)", re.I)
HTML_TAG = re.compile(r"<[^>]+>")


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
    # 페이지에 동일 JSON이 2회 임베드되고, baro 전체 티어가 prodId를 공유하므로
    # URL+이름 조합으로 중복 제거 (URL만 쓰면 baro 9개 티어가 사라짐)
    unique: dict[tuple[str, str], ScrapedItem] = {}
    for item in items:
        unique.setdefault((item.url, item.name), item)
    return list(unique.values())


def collect_notices(known_urls: set[str]) -> list[ScrapedNotice]:
    """T로밍 전용 공지사항 (2026-08-18 검증).

    페이지(/web/support/notice/roaming) 자체는 BFF 기반 CSR 이지만, 실제 목록은
    공개 REST 엔드포인트에서 내려온다. Referer 헤더만 채워주면 인증/쿠키 없이 200.
    이 게시판은 T로밍 전용이라 전체가 로밍 관련 — 키워드 필터가 필요 없다.

    등록일(rgstDt) 내림차순으로 정렬되어 있어(핀 고정 없음), 이미 DB에 있는 글을
    만나면 그 이후 페이지는 전부 기존 글이므로 조회를 멈춘다 — 매일 5페이지를
    통째로 다시 긁지 않고 신규 글만 확인하게 되어 실행시간이 크게 줄어든다.
    """
    notices: list[ScrapedNotice] = []
    headers = {"Accept": "application/json", "Referer": NOTICE_PAGE_URL}
    for page in range(MAX_NOTICE_PAGES):
        try:
            resp = http.fetch(
                NOTICE_API,
                params={"size": 10, "expsChnlCd": "O", "page": page, "srchKey": ""},
                headers=headers,
            )
            data = resp.json()
        except Exception:  # noqa: BLE001 — 페이지 실패는 나머지 페이지로 계속
            continue
        content = (data.get("result") or {}).get("content") or []
        if not content:
            break
        hit_known = False
        for row in content:
            sernum = row.get("serNum")
            title = (row.get("title") or "").strip()
            if not sernum or not title:
                continue
            raw_content = row.get("content") or ""
            preview = html_unescape(HTML_TAG.sub(" ", raw_content))
            preview = re.sub(r"\s+", " ", preview).strip()[:500]
            published = None
            rgst_dt = row.get("rgstDt") or ""
            if re.fullmatch(r"\d{8}", rgst_dt):
                try:
                    published = datetime(
                        int(rgst_dt[:4]), int(rgst_dt[4:6]), int(rgst_dt[6:8]), tzinfo=KST,
                    )
                except ValueError:
                    published = None
            url = NOTICE_DETAIL.format(sernum=sernum)
            notices.append(ScrapedNotice(
                title=title,
                url=url,
                content_preview=preview or None,
                published_at=published,
            ))
            if url in known_urls:
                hit_known = True
        if hit_known:
            break
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

    def collect_notices(self, known_urls: set[str]) -> list[ScrapedNotice]:
        return collect_notices(known_urls)
