"""차단 방지 HTTP 유틸 — User-Agent 로테이션 + 재시도 + 요청 간 딜레이."""
from __future__ import annotations

import random
import time

import requests

# 실제 브라우저 UA 풀 (요청마다 무작위 선택)
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv/126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
]

BASE_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

# 도메인별 최소 요청 간격 (초) — 같은 호스트 연속 요청 시 대기
# lguplus.com 은 연속 요청에 대해 콘텐츠 없는 응답을 내려주는 경향이 있어 넉넉히 설정
_DOMAIN_DELAYS: dict[str, float] = {
    "www.lguplus.com": 1.5,
    "m.lguplus.com": 1.5,
}
DEFAULT_DOMAIN_DELAY = 0.4
_last_request_at: dict[str, float] = {}


def _respect_domain_delay(url: str) -> None:
    """같은 도메인에 너무 빠르게 연속 요청하지 않도록 딜레이 유지."""
    host = requests.utils.urlparse(url).netloc
    delay = _DOMAIN_DELAYS.get(host, DEFAULT_DOMAIN_DELAY)
    last = _last_request_at.get(host, 0.0)
    elapsed = time.monotonic() - last
    if elapsed < delay:
        time.sleep(delay - elapsed)
    _last_request_at[host] = time.monotonic()


def fetch(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: int = 15,
    retries: int = 2,
) -> requests.Response:
    """GET 요청 — UA 로테이션, 도메인 딜레이, 429/5xx 지수 백오프 재시도."""
    merged = {**BASE_HEADERS, "User-Agent": random.choice(USER_AGENTS)}
    if headers:
        merged.update(headers)

    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        _respect_domain_delay(url)
        try:
            resp = requests.get(url, params=params, headers=merged, timeout=timeout)
            if resp.status_code == 200:
                # 한국 통신사 사이트 일부는 charset 미표기 → requests 가 latin-1 로
                # 잘못 추정해 모지브레이크 발생. 실제 인코딩으로 재추론.
                if "charset" not in resp.headers.get("content-type", "").lower():
                    resp.encoding = resp.apparent_encoding or "utf-8"
                return resp
            # 429(레이트리밋)/503(과부하)은 잠시 후 재시도, 그 외 4xx 는 즉시 포기
            if resp.status_code in (429, 502, 503, 504) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            raise
    raise last_exc or RuntimeError(f"요청 실패: {url}")
