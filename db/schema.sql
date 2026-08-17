-- ============================================================
-- 통신 3사 로밍 모니터링 대시보드 — 데이터베이스 스키마
-- 대상: Postgres (Supabase / Vercel Postgres(Neon) 호환)
-- 설계 원칙:
--   1. 히스토리 보존 — 데이터를 덮어쓰지 않고 append-only 스냅샷 저장
--   2. 중복 방지 — 출처 URL 기준 고유 제약 + content_hash 변경 감지
--   3. 변경 트래킹 — 요금제 내용이 바뀌면 버전 레코드를 새로 추가
-- ============================================================

-- ------------------------------------------------------------
-- 0. 공통 enum 타입
-- ------------------------------------------------------------
CREATE TYPE carrier_code AS ENUM ('SKT', 'KT', 'LGU');
CREATE TYPE item_category AS ENUM ('plan', 'service', 'promotion');  -- 요금제/부가서비스/프로모션

-- ------------------------------------------------------------
-- 1. 통신사 메타 (기준 코드 테이블)
-- ------------------------------------------------------------
CREATE TABLE carriers (
    id          SERIAL PRIMARY KEY,
    code        carrier_code UNIQUE NOT NULL,   -- 'SKT' | 'KT' | 'LGU'
    name        TEXT NOT NULL,                   -- 'SK텔레콤' 등 표시명
    color       TEXT NOT NULL,                   -- 대시보드 브랜드 컬러 (예: '#E60012')
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO carriers (code, name, color) VALUES
    ('SKT', 'SK텔레콤', '#E60012'),
    ('KT',  'KT',       '#FF5A00'),
    ('LGU', 'LG유플러스', '#EA1C00');

-- ------------------------------------------------------------
-- 2. 로밍 콘텐츠 마스터 (요금제 / 부가서비스 / 프로모션)
--    현재 상태를 나타내는 "최신 버전" 레코드.
--    실제 히스토리는 roaming_item_versions 에 append-only 로 쌓인다.
-- ------------------------------------------------------------
CREATE TABLE roaming_items (
    id              SERIAL PRIMARY KEY,
    carrier_id      INT NOT NULL REFERENCES carriers(id),
    category        item_category NOT NULL,
    name            TEXT NOT NULL,                -- 요금제/서비스명
    url             TEXT NOT NULL,                -- 출처 상세 페이지 URL (중복 판별 기준)
    region          TEXT,                         -- 대상 지역 (예: '전세계', '아시아', '미국')
    price           TEXT,                         -- 표시용 가격 (예: '월 9,900원', '무료')
    -- 스크래핑 원본 구조를 그대로 보존 (유연성 확보)
    raw             JSONB NOT NULL DEFAULT '{}',  -- 전체 원본 데이터 (가격/데이터량/옵션 등)
    content_hash    TEXT NOT NULL,                -- 정규화된 내용의 SHA-256 → 변경 감지
    is_active       BOOLEAN NOT NULL DEFAULT true, -- 출처에서 사라지면 false (단종 트래킹)
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(), -- 최초 수집 시각 (= New 뱃지 기준)
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(), -- 마지막으로 확인된 시각
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 내용이 실제로 바뀐 시각
    -- 업서트 중복 방지 키: URL 뿐 아니라 이름까지 포함.
    -- 이유: KT 등은 한 목록 페이지(URL 동일)에 여러 상품이 나열되므로 URL 만으로는
    -- 서로 다른 상품이 한 행으로 붕괴한다. 이름이 같고 내용(가격 등)이 바뀌면
    -- content_hash 변경으로 새 버전이 쌓인다(히스토리 보존).
    UNIQUE (carrier_id, category, url, name)
);

CREATE INDEX idx_roaming_items_lookup
    ON roaming_items (carrier_id, category, is_active, first_seen_at DESC);
-- New 뱃지 조회용: 단순 컬럼 인덱스.
-- 주의: 인덱스 predicate 에는 IMMUTABLE 함수만 사용 가능해 now()-24h 같은
-- 롤링 조건을 부분 인덱스로 만들 수 없다(42P17 오류). 조회 시 WHERE 절로 판정한다.
CREATE INDEX idx_roaming_items_first_seen
    ON roaming_items (first_seen_at DESC);

-- ------------------------------------------------------------
-- 3. 로밍 콘텐츠 버전 히스토리 (append-only)
--    매일 수집 시 content_hash 가 달라지면 새 스냅샷 INSERT.
--    → "이전 요금제 vs 신규 요금제" 비교 트래킹의 핵심 테이블.
-- ------------------------------------------------------------
CREATE TABLE roaming_item_versions (
    id              SERIAL PRIMARY KEY,
    item_id         INT NOT NULL REFERENCES roaming_items(id) ON DELETE CASCADE,
    version_no      INT NOT NULL,                 -- 1부터 증가 (항목별 순번)
    name            TEXT NOT NULL,
    region          TEXT,
    price           TEXT,
    raw             JSONB NOT NULL DEFAULT '{}',
    content_hash    TEXT NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 이 버전이 수집된 시각
    UNIQUE (item_id, version_no)
);

CREATE INDEX idx_item_versions_item ON roaming_item_versions (item_id, captured_at DESC);

-- ------------------------------------------------------------
-- 4. 공지사항 게시글 (SKT/KT/LGU+ 게시판)
-- ------------------------------------------------------------
CREATE TABLE notices (
    id              SERIAL PRIMARY KEY,
    carrier_id      INT NOT NULL REFERENCES carriers(id),
    title           TEXT NOT NULL,
    url             TEXT NOT NULL,                -- 게시글 고유 URL (중복 판별 기준)
    author          TEXT,                         -- 작성자/부서
    content_preview TEXT,                         -- 본문 요약 (첫 500자 등)
    content_hash    TEXT NOT NULL,                -- 제목+본문 해시 (수정 감지)
    published_at    TIMESTAMPTZ,                  -- 게시판에 표기된 원본 등록일
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (carrier_id, url)
);

CREATE INDEX idx_notices_lookup
    ON notices (carrier_id, first_seen_at DESC);

-- ------------------------------------------------------------
-- 5. 네이버 로밍 뉴스 아카이브
-- ------------------------------------------------------------
CREATE TABLE news_articles (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    url             TEXT NOT NULL,                -- 네이버 뉴스 링크 (고유)
    originallink    TEXT,                         -- 언론사 원문 링크
    source          TEXT,                         -- 언론사명
    description     TEXT,                         -- 기사 요약
    query_keyword   TEXT NOT NULL,                -- 수집에 사용된 검색어 (예: '로밍 요금')
    published_at    TIMESTAMPTZ,                  -- 기사 발행일 (naver pubDate)
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (url)
);

CREATE INDEX idx_news_lookup ON news_articles (published_at DESC NULLS LAST);
CREATE INDEX idx_news_keyword ON news_articles (query_keyword, published_at DESC NULLS LAST);

-- ------------------------------------------------------------
-- 6. 수집 실행 로그 (운영 모니터링)
--    크론잡이 매일 돌 때마다 실행 결과를 기록 → 실패 추적 가능
-- ------------------------------------------------------------
CREATE TABLE scrape_runs (
    id              SERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running',  -- running | success | partial | failed
    trigger         TEXT NOT NULL DEFAULT 'cron',     -- cron | manual
    target          TEXT NOT NULL,                     -- 'skt' | 'kt' | 'lgu' | 'naver_news' | 'all'
    items_inserted  INT NOT NULL DEFAULT 0,            -- 신규 추가 건수
    items_updated   INT NOT NULL DEFAULT 0,            -- 내용 변경 건수
    items_unchanged INT NOT NULL DEFAULT 0,
    error_message   TEXT
);

CREATE INDEX idx_scrape_runs ON scrape_runs (started_at DESC);
