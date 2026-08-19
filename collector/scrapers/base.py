"""통신사 스크래퍼 공통 기반 — 수집 → 해시 → 업서트 공통 파이프라인."""
from __future__ import annotations

import traceback
from dataclasses import dataclass, field

import psycopg

from collector import db


@dataclass
class ScrapedItem:
    """요금제/부가서비스/프로모션 1건의 정규화된 형태."""
    name: str
    url: str
    category: str            # 'plan' | 'service' | 'promotion'
    region: str | None = None
    price: str | None = None
    raw: dict = field(default_factory=dict)


@dataclass
class ScrapedNotice:
    """공지사항 1건."""
    title: str
    url: str
    author: str | None = None
    content_preview: str | None = None
    published_at: object | None = None   # tz-aware datetime


@dataclass
class ScrapeResult:
    target: str
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: list[str] = field(default_factory=list)

    def merge(self, other: "ScrapeResult") -> None:
        self.inserted += other.inserted
        self.updated += other.updated
        self.unchanged += other.unchanged
        self.errors.extend(other.errors)


class BaseCarrierScraper:
    """템플릿 메서드 패턴 — collect_*() 만 각 통신사가 구현하면 적재는 공통 처리."""
    code: str = ""            # 'SKT' | 'KT' | 'LGU'
    target: str = ""          # 'skt' | 'kt' | 'lgu'

    def collect_plans(self) -> list[ScrapedItem]:
        """요금제/부가서비스/프로모션 수집 (각 통신사가 구현)."""
        raise NotImplementedError

    def collect_notices(self, known_urls: set[str]) -> list[ScrapedNotice]:
        """공지사항 수집 (각 통신사가 구현). known_urls는 이미 DB에 있는 이 통신사의
        공지 URL 집합 — 조기 페이지네이션 종료 및 신규 글 판별에 사용한다."""
        raise NotImplementedError

    def run(self, conn: psycopg.Connection, carrier_id: int) -> ScrapeResult:
        result = ScrapeResult(target=self.target)

        # 1) 로밍 상품 수집 + 적재
        try:
            items = self.collect_plans()
            inserted = updated = unchanged = 0
            seen_urls: set[str] = set()
            categories: set[str] = set()
            for item in items:
                content_hash = db.compute_hash(
                    item.name, item.category, item.region, item.price, item.raw,
                )
                outcome = db.upsert_roaming_item(
                    conn,
                    carrier_id=carrier_id,
                    category=item.category,
                    name=item.name,
                    url=item.url,
                    region=item.region,
                    price=item.price,
                    raw=item.raw,
                    content_hash=content_hash,
                )
                if outcome == "inserted":
                    inserted += 1
                elif outcome == "updated":
                    updated += 1
                else:
                    unchanged += 1
                seen_urls.add(item.url)
                categories.add(item.category)
            conn.commit()
            # 2) 이번에 발견 안 된 항목은 단종(is_active=false) 처리
            deactivated = db.deactivate_missing_items(
                conn, carrier_id=carrier_id, categories=sorted(categories), seen_urls=seen_urls,
            )
            conn.commit()
            # 커밋 성공 후에만 통계 반영 (롤백 시 카운터가 실제와 어긋나지 않도록)
            result.inserted, result.updated, result.unchanged = inserted, updated, unchanged
            if deactivated:
                result.errors.append(f"단종 처리: {deactivated}건 is_active=false")
        except Exception as exc:  # noqa: BLE001 — 개별 스크래퍼 실패가 전체를 죽이지 않도록
            conn.rollback()
            result.errors.append(f"상품 수집 실패: {exc}")
            traceback.print_exc()

        # 3) 공지사항 수집 + 적재
        try:
            known_urls = db.get_known_notice_urls(conn, carrier_id)
            notices = self.collect_notices(known_urls)
            n_inserted = n_updated = n_unchanged = 0
            for notice in notices:
                content_hash = db.compute_hash(notice.title, notice.content_preview)
                outcome = db.upsert_notice(
                    conn,
                    carrier_id=carrier_id,
                    title=notice.title,
                    url=notice.url,
                    author=notice.author,
                    content_preview=notice.content_preview,
                    published_at=notice.published_at,
                    content_hash=content_hash,
                )
                if outcome == "inserted":
                    n_inserted += 1
                elif outcome == "updated":
                    n_updated += 1
                else:
                    n_unchanged += 1
            conn.commit()
            result.inserted += n_inserted
            result.updated += n_updated
            result.unchanged += n_unchanged
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            result.errors.append(f"공지 수집 실패: {exc}")
            traceback.print_exc()

        return result
