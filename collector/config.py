"""환경변수 기반 설정."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str        # Postgres 연결 문자열 (Supabase pooled 권장)
    cron_secret: str         # 크론 엔드포인트 보호 시크릿
    naver_client_id: str     # 네이버 Search API 자격증명
    naver_client_secret: str


def load_settings() -> Settings:
    return Settings(
        database_url=os.getenv("DATABASE_URL", ""),
        cron_secret=os.getenv("CRON_SECRET", "") or os.getenv("VERCEL_CRON_SECRET", ""),
        naver_client_id=os.getenv("NAVER_CLIENT_ID", ""),
        naver_client_secret=os.getenv("NAVER_CLIENT_SECRET", ""),
    )
