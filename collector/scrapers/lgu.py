"""LG유플러스 (lguplus.com) 스크래퍼.

검증된 구조 (2026-08-18 재검증 — 헤드리스 브라우저로 실제 네트워크 요청 캡처):
  - 요금제 목록(/plan/roaming/all-plans)은 화면 자체는 CSR 이지만, 화면이 호출하는
    공개 REST API 를 직접 부르면 인증/세션 없이 완전한 데이터가 내려온다:
      1) GET /uhdc/fo/prdv/abrm/prod/v1/rmng-catg           → 카테고리 목록(로밍패스 등 3종)
      2) GET /uhdc/fo/prdv/abrm/prod/v1/pp-grps/pps?catgCd=X → 카테고리별 상품 그룹+상품 상세
    (과거 코드는 이걸 몰라서 허브 페이지의 링크 텍스트를 휴리스틱으로 긁었고, 결과가
    거의 비어 있었다 — 이제는 통신사가 직접 내려주는 가격/용량/기간 원본을 그대로 쓴다.)
  - 이용 가이드(/plan/roaming/guide)는 모바일 UA 로 요청하면 SSR 되어 데이터 안심옵션 등
    부가서비스 가격이 HTML 에 포함된다 (기존에 검증된 그대로 유지).
  - 공지사항(/plan/roaming/support/notice)은 사실 데스크톱 UA 로 이미 SSR 되고 있었다
    (과거 코드가 "안정 경로 미확인"으로 잘못 판단해 빈 리스트를 반환했었음) — 테이블을
    파싱하면 된다. 페이지네이션은 ?pageNo=N 쿼리 파라미터.
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

GUIDE_PAGE = "https://www.lguplus.com/plan/roaming/guide?currentTab=TAB1"
CATEGORY_API = "https://www.lguplus.com/uhdc/fo/prdv/abrm/prod/v1/rmng-catg"
PRODUCTS_API = "https://www.lguplus.com/uhdc/fo/prdv/abrm/prod/v1/pp-grps/pps"
PLAN_DETAIL = "https://www.lguplus.com/plan/roaming/gnr/{code}"
NOTICE_PAGE = "https://www.lguplus.com/plan/roaming/support/notice"
NOTICE_DETAIL = "https://www.lguplus.com/plan/roaming/support/notice/{nid}"
NOTICE_PAGES = 3  # 페이지당 10건 — 최근 30건 수집

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
NOTICE_DATE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
NOTICE_ID = re.compile(r"/support/notice/(\d+)")


def _abs(base: str, href: str | None) -> str | None:
    if not href or href.startswith("#") or href.startswith("javascript"):
        return None
    url = urljoin(base, href.strip())
    return url.split("#")[0] or None


def _text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""


def collect_catalog_plans() -> list[ScrapedItem]:
    """공식 요금제 카탈로그 API — 카테고리(로밍패스/나눠쓰기/제로프리미엄) 전체 순회.

    catgCd 는 카테고리 API로 동적 조회(하드코딩 시 신규 카테고리 추가에 취약).
    상품 하나당 가격/용량(GB, KB 원본)/기간/통화조건/대상국가를 raw 에 그대로 보존한다.
    """
    try:
        resp = fetch(CATEGORY_API, headers=DESKTOP_HEADERS)
        categories = resp.json()
    except Exception:  # noqa: BLE001 — 카테고리 조회 실패 시 전체 스킵
        return []

    items: list[ScrapedItem] = []
    for cat in categories:
        catg_cd = cat.get("urcAbrdRmngProdCd")
        catg_name = cat.get("urcAbrdRmngProdNm") or ""
        if not catg_cd:
            continue
        try:
            resp = fetch(PRODUCTS_API, params={"catgCd": catg_cd}, headers=DESKTOP_HEADERS)
            groups = resp.json()
        except Exception:  # noqa: BLE001 — 카테고리 하나 실패해도 나머지는 계속
            continue
        for group in groups or []:
            grp = group.get("ppGrp") or {}
            grp_name = grp.get("urcAbrdRmngProdNm") or ""
            for entry in group.get("ppList") or []:
                prod = entry.get("prod") or {}
                code = prod.get("urcAbrdRmngProdCd")
                name = (prod.get("urcAbrdRmngProdNm") or "").strip()
                if not code or not name:
                    continue
                data_kb_raw = prod.get("rmngProdDataOfqnCntn")
                data_gb = None
                try:
                    data_gb = round(int(data_kb_raw) / 1024 / 1024, 2) if data_kb_raw else None
                except (TypeError, ValueError):
                    data_gb = None
                items.append(ScrapedItem(
                    name=name,
                    url=PLAN_DETAIL.format(code=code),
                    category="plan",
                    region=prod.get("rmngProdNatnCntn"),
                    price=prod.get("rmngTadvChrgCntn"),
                    raw={
                        "prodCode": code,
                        "category": catg_name,
                        "group": grp_name,
                        "term": prod.get("rmngTadvTermCntn"),
                        "voice": prod.get("rmngProdTelCntn"),
                        "data": prod.get("rmngProdDataCntn"),
                        "data_kb": data_kb_raw,
                        "data_gb": data_gb,
                    },
                ))
    unique: dict[tuple[str, str], ScrapedItem] = {}
    for item in items:
        unique.setdefault((item.url, item.name), item)
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
    """로밍 공지사항 게시판 (2026-08-18 재검증: 데스크톱 UA로 이미 SSR 되고 있었음).

    표 구조: tbody > tr[role=row] > td(유형) / td.c-cell-subject(제목+링크, 중요 플래그) /
    td.c-cell-date(등록일 YYYY-MM-DD). 상세 링크는 /plan/roaming/support/notice/{id}.
    """
    notices: list[ScrapedNotice] = []
    for page in range(1, NOTICE_PAGES + 1):
        try:
            resp = fetch(NOTICE_PAGE, params={"pageNo": page}, headers=DESKTOP_HEADERS)
        except Exception:  # noqa: BLE001 — 페이지 실패는 나머지 페이지로 계속
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("tbody tr[role='row']")
        if not rows:
            break
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            notice_type = _text(cells[0])
            subject_cell = cells[1]
            link = subject_cell.find("a", href=True)
            if link is None:
                continue
            title = _text(link)
            is_important = subject_cell.find("small", class_="c-flag") is not None
            if is_important and not title.startswith("[중요]"):
                title = f"[중요] {title}"
            if notice_type and notice_type not in title:
                title = f"[{notice_type}] {title}"
            # href 에 ?pageNo=N 이 섞여 있어(글 목록상 위치) 그대로 쓰면 게시글이 다음
            # 페이지로 밀릴 때마다 URL이 바뀌어 같은 글이 중복 저장된다 — id만 추출해
            # 안정적인 URL로 정규화한다.
            href = link.get("href") or ""
            id_m = NOTICE_ID.search(href)
            url = NOTICE_DETAIL.format(nid=id_m.group(1)) if id_m else _abs(NOTICE_PAGE, href)
            if not title or not url:
                continue
            date_text = _text(cells[2])
            date_m = NOTICE_DATE.search(date_text)
            published = None
            if date_m:
                try:
                    published = datetime(
                        int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3)), tzinfo=KST,
                    )
                except ValueError:
                    published = None
            notices.append(ScrapedNotice(title=title, url=url, published_at=published))
    unique: dict[str, ScrapedNotice] = {}
    for n in notices:
        unique.setdefault(n.url, n)
    return list(unique.values())


class LguScraper(BaseCarrierScraper):
    code = "LGU"
    target = "lgu"

    def collect_plans(self) -> list[ScrapedItem]:
        return collect_catalog_plans() + collect_guide_services()

    def collect_notices(self) -> list[ScrapedNotice]:
        return collect_notices()
