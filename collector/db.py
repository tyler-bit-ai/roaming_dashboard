"""DB 적재 레이어 — 중복 방지 업서트 + 버전 히스토리 스냅샷 + 실행 로그.

모든 쓰기는 content_hash(SHA-256) 로 변경을 판별하며, 데이터를 덮어쓰지 않고
roaming_item_versions 테이블에 append-only 로 히스토리를 쌓는다.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Json
from psycopg.rows import dict_row


def get_conn(database_url: str) -> psycopg.Connection:
    """Supabase/Neon 연결 — 서버리스에 안전한 옵션.

    prepare_threshold=None 필수: Supabase Transaction Pooler(포트 6543)에서는
    psycopg3 의 자동 prepared statement 가 풀러의 서버 연결 교체와 충돌해
    'prepared statement already exists' 오류가 발생한다.
    """
    return psycopg.connect(
        database_url,
        connect_timeout=10,
        application_name="roaming-dashboard-collector",
        prepare_threshold=None,
    )


def compute_hash(*parts: object) -> str:
    """정규화된 내용의 SHA-256 — 순서를 고정해 결정적으로 유지."""
    canonical = json.dumps(
        [str(p).strip() if p is not None else "" for p in parts],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_carrier_ids(conn: psycopg.Connection) -> dict[str, int]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id, code FROM carriers")
        return {row["code"]: row["id"] for row in cur.fetchall()}


def upsert_roaming_item(
    conn: psycopg.Connection,
    *,
    carrier_id: int,
    category: str,          # 'plan' | 'service' | 'promotion'
    name: str,
    url: str,
    region: str | None,
    price: str | None,
    raw: dict,
    content_hash: str,
) -> str:
    """요금제/부가서비스/프로모션 1건 적재. 반환값: 'inserted' | 'updated' | 'unchanged'."""
    now = datetime.now(timezone.utc)
    with conn.cursor(row_factory=dict_row) as cur:
        # 정체성 = (통신사, 카테고리, URL, 이름) — 같은 목록 페이지의 서로 다른
        # 상품들이 한 행으로 붕괴하지 않도록 이름까지 비교한다.
        cur.execute(
            """
            SELECT id, content_hash FROM roaming_items
            WHERE carrier_id = %s AND category = %s AND url = %s AND name = %s
            """,
            (carrier_id, category, url, name),
        )
        existing = cur.fetchone()

        if existing is None:
            # 신규 항목: 마스터 INSERT + 버전 v1 스냅샷
            cur.execute(
                """
                INSERT INTO roaming_items
                    (carrier_id, category, name, url, region, price, raw, content_hash,
                     is_active, first_seen_at, last_seen_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true, %s, %s, %s)
                RETURNING id
                """,
                (carrier_id, category, name, url, region, price, Json(raw),
                 content_hash, now, now, now),
            )
            item_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO roaming_item_versions
                    (item_id, version_no, name, region, price, raw, content_hash, captured_at)
                VALUES (%s, 1, %s, %s, %s, %s, %s, %s)
                """,
                (item_id, name, region, price, Json(raw), content_hash, now),
            )
            return "inserted"

        if existing["content_hash"] == content_hash:
            # 변화 없음: 확인 시각만 갱신 (사라지지 않았다는 증거)
            cur.execute(
                "UPDATE roaming_items SET last_seen_at = %s, is_active = true WHERE id = %s",
                (now, existing["id"]),
            )
            return "unchanged"

        # 내용 변경: 마스터 최신화 + 새 버전 스냅샷 append (과거 데이터 보존)
        cur.execute(
            """
            UPDATE roaming_items
            SET name = %s, region = %s, price = %s, raw = %s, content_hash = %s,
                is_active = true, last_seen_at = %s, updated_at = %s
            WHERE id = %s
            """,
            (name, region, price, Json(raw), content_hash, now, now, existing["id"]),
        )
        cur.execute(
            """
            INSERT INTO roaming_item_versions
                (item_id, version_no, name, region, price, raw, content_hash, captured_at)
            SELECT %s, COALESCE(MAX(version_no), 0) + 1, %s, %s, %s, %s, %s, %s
            FROM roaming_item_versions WHERE item_id = %s
            """,
            (existing["id"], name, region, price, Json(raw), content_hash, now, existing["id"]),
        )
        return "updated"


def deactivate_missing_items(
    conn: psycopg.Connection,
    *,
    carrier_id: int,
    categories: list[str],
    seen_urls: set[str],
) -> int:
    """이번 수집에서 발견되지 않은 항목을 is_active=false 처리 (단종 트래킹)."""
    if not seen_urls:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE roaming_items SET is_active = false, last_seen_at = %s
            WHERE carrier_id = %s AND category = ANY(%s)
              AND is_active = true AND NOT (url = ANY(%s))
            """,
            (datetime.now(timezone.utc), carrier_id, categories, list(seen_urls)),
        )
        return cur.rowcount


def upsert_notice(
    conn: psycopg.Connection,
    *,
    carrier_id: int,
    title: str,
    url: str,
    author: str | None,
    content_preview: str | None,
    published_at: datetime | None,
    content_hash: str,
) -> str:
    """공지사항 1건 적재 — URL 기준 중복 방지."""
    now = datetime.now(timezone.utc)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, content_hash FROM notices WHERE carrier_id = %s AND url = %s",
            (carrier_id, url),
        )
        existing = cur.fetchone()
        if existing is None:
            cur.execute(
                """
                INSERT INTO notices
                    (carrier_id, title, url, author, content_preview, content_hash,
                     published_at, first_seen_at, last_seen_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                """,
                (carrier_id, title, url, author, content_preview, content_hash,
                 published_at, now, now),
            )
            return "inserted"
        if existing["content_hash"] == content_hash:
            cur.execute(
                "UPDATE notices SET last_seen_at = %s, is_active = true WHERE id = %s",
                (now, existing["id"]),
            )
            return "unchanged"
        # 제목/본문 수정된 게시글 — 내용 갱신 (수정 이력은 content_hash 변화로 감지 가능)
        cur.execute(
            """
            UPDATE notices
            SET title = %s, author = %s, content_preview = %s, content_hash = %s,
                published_at = COALESCE(%s, published_at),
                last_seen_at = %s, is_active = true
            WHERE id = %s
            """,
            (title, author, content_preview, content_hash, published_at, now, existing["id"]),
        )
        return "updated"


def upsert_news_articles(
    conn: psycopg.Connection,
    articles: list[dict],
) -> int:
    """네이버 뉴스 일괄 적재 — URL 충돌 시 무시(중복 스킵). 신규 삽입 건수 반환."""
    inserted = 0
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        for a in articles:
            cur.execute(
                """
                INSERT INTO news_articles
                    (title, url, originallink, source, description, query_keyword,
                     published_at, first_seen_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (url) DO NOTHING
                """,
                (a["title"], a["url"], a.get("originallink"), a.get("source"),
                 a.get("description"), a["query_keyword"], a.get("published_at"), now),
            )
            inserted += cur.rowcount
    return inserted


def start_run(conn: psycopg.Connection, *, target: str, trigger: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO scrape_runs (status, trigger, target) VALUES ('running', %s, %s) RETURNING id",
            (trigger, target),
        )
        return cur.fetchone()[0]


def finish_run(
    conn: psycopg.Connection,
    run_id: int,
    *,
    status: str,             # 'success' | 'partial' | 'failed'
    inserted: int,
    updated: int,
    unchanged: int,
    error_message: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE scrape_runs
            SET finished_at = %s, status = %s,
                items_inserted = %s, items_updated = %s, items_unchanged = %s,
                error_message = %s
            WHERE id = %s
            """,
            (datetime.now(timezone.utc), status, inserted, updated, unchanged,
             error_message, run_id),
        )
