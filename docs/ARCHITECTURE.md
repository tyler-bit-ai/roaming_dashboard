# 아키텍처 설계 — 통신 3사 로밍 모니터링 대시보드

## 1. 전체 시스템 흐름도

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Vercel Cron Job                             │
│              vercel.json → 매일 09:00 KST (00:00 UTC)               │
│              GET /api/cron/collect_all (CRON_SECRET 자동 첨부)       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 호출
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                Python Serverless Functions (Vercel)                 │
│                                                                     │
│  api/cron/collect_all.py ── Flask 진입점 (CRON_SECRET 검증)          │
│  api/manual/collect.py   ── 수동 트리거 (로컬 테스트/백필)           │
│  api/health.py           ── 헬스체크                                 │
│    └── collector/pipeline.py   오케스트레이터 (순차 실행 + 집계)      │
│        ├── collector/scrapers/skt.py        SKT 로밍 수집            │
│        ├── collector/scrapers/kt.py         KT 로밍 수집             │
│        ├── collector/scrapers/lgu.py        LG유플러스 로밍 수집      │
│        └── collector/scrapers/naver_news.py 네이버 뉴스 (Search API)  │
│                                                                     │
│  collector/http.py  → User-Agent 로테이션, 타임아웃, 재시도           │
│  collector/db.py    → 업서트/변경감지/버전 스냅샷 트랜잭션            │
│  (공유 모듈을 api/ 밖의 collector/ 패키지에 둠 — NewsCollectorVersel  │
│   참조: 프로젝트 루트 패키지 import 방식. 진입점은 파일 경로=요청    │
│   경로 원칙으로 api/cron/collect_all.py 등에 배치)                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ psycopg (Postgres wire protocol)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Postgres (Supabase / Neon)                      │
│  roaming_items / roaming_item_versions / notices / news_articles    │
│  scrape_runs (실행 로그)                                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ postgres.js (Node 드라이버)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js 15 대시보드 (TypeScript)                  │
│  SSR/RSC 로 DB 직접 조회 → 필터(날짜/통신사/카테고리) + New 뱃지      │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 기술 스택 및 선택 이유

| 레이어 | 기술 | 선택 이유 |
|---|---|---|
| 프론트엔드 | Next.js 15 (App Router) + TypeScript + Tailwind | RSC로 DB 직접 조회, 스트리밍 SSR. Meta 디자인 시스템(Tailwind 기반) 재사용 |
| 스크래핑 | Python 3.12 + requests + BeautifulSoup | 요구사항. Vercel `@vercel/python` 런타임으로 `api/**/*.py` 자동 배포 |
| DB | **Supabase Postgres** (권장) | 서버리스 친화적, 무료 tier 넉넉, connection pooling(pgbouncer) 내장. Vercel Postgres는 서비스가 Neon으로 이관되어 신규 프로젝트에는 Supabase가 안정적. 표준 `DATABASE_URL`로 추상화해 있어 Neon으로 갈아타도 코드 변경 불필요 |
| 스케줄링 | Vercel Cron Jobs (`vercel.json`) | 별도 인프라 불필요. KST 09:00 = UTC 00:00 |
| 펑션 간 통신 | 직접 Python 모듈 import | HTTP hop 최소화 (Vercel 함수→함수 콜은 콜드스타트 2배) |

## 3. 데이터 흐름 상세

### 3.1 수집 (매일 09:00 KST)
1. Vercel Cron이 `GET /api/cron/collect_all` 호출 (헤더에 `Authorization: Bearer ${CRON_SECRET}` 자동 첨부)
2. Python 함수가 `CRON_SECRET` 검증 후 4개 스크래퍼 순차 실행
3. 각 스크래퍼는 User-Agent 로테이션 + 재시도로 차단 방지
4. 수집 항목마다 정규화 후 `content_hash`(SHA-256) 계산

### 3.2 적재 (중복 방지 + 히스토리)
```
항목 1건마다:
  ├─ DB에 (carrier, category, url) 로 조회
  │   ├─ 없음            → roaming_items INSERT + versions v1 INSERT   [신규]
  │   ├─ 있음, hash 동일  → last_seen_at만 갱신                        [변경없음]
  │   └─ 있음, hash 다름  → items UPDATE + versions v(n+1) INSERT       [내용변경]
  └─ 이번 실행에서 발견 안 된 기존 항목 → is_active = false             [단종]
```
→ 데이터를 절대 덮어쓰지 않고, 변경 시점마다 버전이 쌓여 **과거 요금제 추적 가능**

### 3.3 조회 (대시보드)
- `first_seen_at`(최초 수집) 또는 `published_at`이 24시간 이내 → **New 뱃지**
- 필터: 통신사(SKT/KT/LGU/전체) × 카테고리(요금제/부가서비스/프로모션/공지/뉴스) × 날짜 범위
- 과거 데이터: `roaming_item_versions`의 버전 타임라인 UI로 "무엇이 언제 어떻게 바뀌었는지" 표시

## 4. 보안
- 모든 스크래핑/적재 엔드포인트는 `CRON_SECRET` Bearer 검증 (외부 무단 호출 차단)
- DB 인증 정보는 Vercel Environment Variables에만 존재 (`.env.local`은 git 제외)
- 뉴스는 네이버 공식 Search API 사용 (HTML 파싱 아님 → 차단 리스크 없음)

## 5. 디렉토리 구조
```
roaming_dashboard/
├── api/                          # Vercel Python Serverless (파일 경로 = 요청 경로)
│   ├── cron/collect_all.py       # 크론 진입점 (/api/cron/collect_all)
│   ├── manual/collect.py         # 수동 트리거 (/api/manual/collect)
│   └── health.py                 # 헬스체크 (/api/health)
├── collector/                    # 수집 공유 모듈 (api/ 밖 — 함수 라우팅에서 제외)
│   ├── config.py                 # 환경변수 설정
│   ├── http.py                   # UA 로테이션/도메인 딜레이/재시도
│   ├── db.py                     # 업서트/변경감지/버전 스냅샷/실행 로그
│   ├── pipeline.py               # 오케스트레이션
│   └── scrapers/
│       ├── base.py / skt.py / kt.py / lgu.py / naver_news.py
├── src/                          # Next.js 15 App Router
│   ├── app/
│   │   ├── page.tsx              # 대시보드 메인 (오버뷰 + New 하이라이트)
│   │   ├── plans/page.tsx        # 요금제/부가서비스/프로모션
│   │   ├── notices/page.tsx      # 공지사항
│   │   ├── news/page.tsx         # 로밍 뉴스
│   │   └── globals.css           # Meta 디자인 시스템 이식 (CSS 변수 + 컴포넌트 클래스)
│   ├── components/               # Meta 기반 UI 컴포넌트 (Sidebar/Header/KpiCard/...)
│   └── lib/db.ts                 # postgres.js 클라이언트 + 쿼리
├── db/schema.sql                 # 이 문서의 스키마
├── requirements.txt              # Python 의존성
├── vercel.json                   # Cron 09:00 KST 설정
└── .env.example                  # 환경변수 템플릿
```

## 6. 환경변수
| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | Postgres 연결 문자열 (Supabase pooled connection `?pgbouncer=true`) |
| `CRON_SECRET` | 크론 엔드포인트 보호 (Vercel이 자동 첨부) |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 Search API 자격증명 (X-Naver-Client-Id/Secret 헤더) |
