"""KT (globalroaming.kt.com) 스크래퍼.

검증된 구조 (2026-08-17 라이브 분석):
  - 홈: '함께 쓰는 로밍' 등 상품 카드가 SSR 됨 (그룹 링크 /product/data/gasam 등)
  - 상품 목록 /product/data/main: 그룹 섹션 안에 '4GB 33,000 원/15일' / '33,000 원/4GB'
    양방향 순서의 가격 행이 나열
  - 공지 게시판 /news/list: a[href*='/news/view'] SSR 목록
  - 홈 div.notice > ul#notice: 최신 공지 1건 (em=날짜 MM-DD, span=제목)
"""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

from collector.http import fetch as http_fetch
from collector.scrapers.base import BaseCarrierScraper, ScrapedItem, ScrapedNotice

KST = ZoneInfo("Asia/Seoul")

HOME = "https://globalroaming.kt.com/"
DATA_PRODUCTS = "https://globalroaming.kt.com/product/data/main"
NEWS_BOARD = "https://globalroaming.kt.com/news/list"
MAX_NOTICE_PAGES = 15  # 안전 상한 — 게시판 전체는 라이브 검증 시 14페이지(2026-08-19)
PREVIEW_FETCH_LIMIT = 20  # 신규 글 상세 미리보기는 최대 이 건수까지만(최초 백필 폭주 방지)

PRICE_PATTERN = re.compile(r"[\d,]+\s*원")
DATA_PATTERN = re.compile(r"(\d+(?:\.\d+)?\s*GB(?:\s*\+\s*\d+\s*분)?|무제한)", re.I)
# 가격+단위: '33,000 원/4GB', '11,000 원/일'
PRICE_WITH_UNIT = re.compile(r"([\d,]+)\s*원\s*(?:/\s*(\S{1,10}))?")
DATE_FULL = re.compile(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})")

def _abs(base: str, href: str | None) -> str | None:
    if not href or href.startswith("#") or href.startswith("javascript"):
        return None
    url = urljoin(base, href.strip())
    return url.split("#")[0] or None

def _text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)) if node else ""

def _is_plausible_name(name: str) -> bool:
    """상품명 후보 판별 — 노이즈(용량/기간/이용조건 텍스트) 제거."""
    name = name.strip()
    if len(name) < 2 or len(name) > 60:
        return False
    if not re.search(r"[가-힣A-Za-z]", name):
        return False
    if re.fullmatch(r"[\d,.~]+", name):
        return False
    noise_keywords = (
        "이용 가능", "이용가능", "개월", "일 이용", "지원 국가", "부가세 포함",
        "가능속도로", "이용 속도제어", "고객만 신청", "세 이하", "지원국가",
        "가능 속도", "지속 이용",
    )
    return not any(k in name for k in noise_keywords)

def _find_group_link(row):
    """가격 행에서 위로 올라가며 상품 그룹 anchor 탐지 (그룹 링크 안에 행이 있는 구조)."""
    node = row.parent
    while node is not None and getattr(node, "name", None) not in (None, "body", "[document]"):
        if node.name == "a" and node.get("href"):
            text = _text(node)
            if _is_plausible_name(text) and len(text) <= 40:
                return text, _abs(DATA_PRODUCTS, node["href"]) or DATA_PRODUCTS
        node = node.parent
    return None, None

def _parse_products(html: str, page_url: str) -> list[ScrapedItem]:
    """상품 카드/가격 행 파싱 — 검증된 두 가지 레이아웃 모두 지원."""
    soup = BeautifulSoup(html, "html.parser")
    items: list[ScrapedItem] = []

    # 1) 홈 카드: strong 상품명, 최대 3단계 위 부모에서 가격 탐색
    for strong in soup.find_all("strong"):
        name = _text(strong)
        if not _is_plausible_name(name):
            continue
        block = None
        node = strong
        for _ in range(3):
            node = node.parent
            if node is None:
                break
            if PRICE_PATTERN.search(_text(node)):
                block = node
                break
        if block is None:
            continue
        text = _text(block)
        if len(text) > 250:
            continue
        link = block if block.name == "a" and block.get("href") else block.find("a", href=True)
        item_url = _abs(page_url, link["href"] if link else None) or page_url
        price_m = PRICE_WITH_UNIT.search(text)
        items.append(ScrapedItem(
            name=name,
            url=item_url,
            category="service" if "할인" in name else "plan",
            price=price_m.group(0) if price_m else PRICE_PATTERN.search(text).group(0),
            raw={"text": text[:200]},
        ))

    # 2) 목록 가격 행: '4GB 33,000 원/15일' 또는 '33,000 원/4GB' (짧은 텍스트 요소)
    for row in soup.find_all(["li", "tr", "dd", "em", "span"]):
        text = _text(row)
        if not text or len(text) > 30:
            continue
        data_m = DATA_PATTERN.search(text)
        price_m = PRICE_WITH_UNIT.search(text)
        if not (data_m and price_m):
            continue
        group_name, group_url = _find_group_link(row)
        name = f"{group_name} {data_m.group(1)}".strip() if group_name else f"데이터로밍 {data_m.group(1)}"
        url = group_url or page_url
        items.append(ScrapedItem(
            name=name,
            url=url,
            category="plan",
            price=price_m.group(0),
            raw={"data": data_m.group(1), "text": text[:80]},
        ))

    unique: dict[str, ScrapedItem] = {}
    for item in items:
        unique.setdefault(f"{item.url}|{item.name}", item)
    return list(unique.values())

def collect_products() -> list[ScrapedItem]:
    """홈 + 데이터 상품 목록 수집 — 홈 결과 우선 병합."""
    merged: dict[str, ScrapedItem] = {}
    for page_url in (HOME, DATA_PRODUCTS):
        try:
            resp = http_fetch(page_url)
            for item in _parse_products(resp.text, page_url):
                merged.setdefault(f"{item.url}|{item.name}", item)
        except Exception:  # noqa: BLE001 — 페이지 실패는 나머지 페이지로 계속
            continue
    return list(merged.values())

def _parse_date(row_text: str, default_year: int) -> datetime | None:
    """행 텍스트에서 날짜 추출 — YYYY-MM-DD 우선, MM-DD 는 올해로 가정."""
    m = DATE_FULL.search(row_text)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=KST)
        except ValueError:
            return None
    m2 = re.search(r"(?<![\d/.-])(\d{1,2})-(\d{1,2})(?![\d/.-])", row_text)
    if m2:
        try:
            return datetime(default_year, int(m2.group(1)), int(m2.group(2)), tzinfo=KST)
        except ValueError:
            return None
    return None

def _extract_notice_preview(url: str) -> str | None:
    """공지 상세 페이지(div.cont article)에서 본문 앞부분을 추출."""
    try:
        resp = http_fetch(url)
    except Exception:  # noqa: BLE001 — 상세 조회 실패해도 목록 자체는 유효
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    body = soup.select_one("div.cont article") or soup.select_one("div.cont")
    if body is None:
        return None
    text = _text(body)[:300]
    return text or None


def collect_notices(known_urls: set[str]) -> list[ScrapedNotice]:
    """KT 로밍 공지 — /news/list 전체 게시판(페이지네이션) + 홈 최신 공지 섹션.

    게시판은 상단 고정 "공지"(class=notice) 행 몇 건 + 등록일 내림차순 일반 행으로
    구성된다(2026-08-19 라이브 검증, 총 14페이지/136건). 고정 행은 날짜 순서를
    따르지 않으므로 조기 종료 판단에서 제외하고, 일반 행 중 이미 DB에 있는 글을
    만나면 그 이후 페이지는 전부 기존 글이라 조회를 멈춘다.
    신규 글(known_urls에 없는 글)만 상세 페이지를 추가로 열어 본문 미리보기를 채운다 —
    매일 136건 전부를 상세 조회하면 실행시간이 감당할 수 없이 커지기 때문이다.
    """
    notices: list[ScrapedNotice] = []
    year_now = datetime.now(KST).year

    # 1) 전체 게시판 (SSR 확인됨) — 신규 글이 나올 때까지 페이지 순회
    for page in range(1, MAX_NOTICE_PAGES + 1):
        try:
            resp = http_fetch(NEWS_BOARD, params={"gp": page, "sp": 1, "type": "", "val": ""})
        except Exception:  # noqa: BLE001 — 페이지 실패는 나머지 페이지로 계속
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = soup.select("table tbody tr")
        if not rows:
            break
        hit_known_regular = False
        for row in rows:
            link = row.select_one("a[href*='/news/view']")
            if link is None:
                continue
            title = _text(link)
            if not title or len(title) < 6:
                continue
            url = _abs(NEWS_BOARD, link.get("href"))
            if not url:
                continue
            cells = row.find_all("td")
            published = _parse_date(_text(cells[-2]), year_now) if len(cells) >= 2 else None
            is_pinned = "notice" in (row.get("class") or [])
            notices.append(ScrapedNotice(title=title, url=url, published_at=published))
            if not is_pinned and url in known_urls:
                hit_known_regular = True
        if hit_known_regular:
            break

    # 2) 홈 최신 공지 (ul#notice: em=날짜, span=제목) — 게시판에 없는 경우 대비 보조 소스
    try:
        resp = http_fetch(HOME)
        soup = BeautifulSoup(resp.text, "html.parser")
        for li in soup.select("ul#notice li a"):
            em = li.find("em")
            span = li.find("span")
            title = _text(span)
            if not title:
                continue
            date = _parse_date(_text(em), year_now) if em else None
            href = _abs(HOME, li.get("href"))
            notices.append(ScrapedNotice(
                title=title,
                url=href or NEWS_BOARD,
                published_at=date,
            ))
    except Exception:  # noqa: BLE001
        pass

    unique: dict[str, ScrapedNotice] = {}
    for n in notices:
        unique.setdefault(n.url, n)
    result = list(unique.values())

    # 3) 신규 글만 상세 페이지에서 본문 미리보기 추출 (건수 상한으로 폭주 방지 —
    #    신규 배포 직후 첫 백필처럼 신규 글이 대량으로 잡히는 경우를 대비)
    new_count = 0
    for n in result:
        if n.url not in known_urls and new_count < PREVIEW_FETCH_LIMIT:
            n.content_preview = _extract_notice_preview(n.url)
            new_count += 1
    return result

class KtScraper(BaseCarrierScraper):
    code = "KT"
    target = "kt"

    def collect_plans(self) -> list[ScrapedItem]:
        return collect_products()

    def collect_notices(self, known_urls: set[str]) -> list[ScrapedNotice]:
        return collect_notices(known_urls)
