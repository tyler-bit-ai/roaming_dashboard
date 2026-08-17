# 통신 3사 로밍 모니터링 대시보드

SKT·KT·LG유플러스의 로밍 요금제/부가서비스/공지사항/프로모션과 네이버 로밍 뉴스를
매일 자동 수집해 히스토리까지 추적하는 대시보드.

- **프론트엔드**: Next.js 15 (App Router, TypeScript) + Tailwind CSS v4 — `C:\Codex\Meta` 디자인 시스템 기반
- **수집**: Python (Vercel Serverless, Flask) + requests/BeautifulSoup + 네이버 Search API
- **DB**: Postgres (Supabase 권장) — append-only 버전 히스토리, `content_hash` 기반 변경 감지
- **스케줄**: Vercel Cron — 매일 **09:00 KST** (UTC 00:00)

> 상세 설계는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 참조.

---

## 1. 초기 설정

### 1) 데이터베이스 (Supabase)

1. https://supabase.com 에서 신규 프로젝트 생성 (리전: Seoul 권장)
2. **SQL Editor** 에 `db/schema.sql` 전체를 붙여넣고 실행 → 테이블 6종 + 인덱스 생성
   - 실행이 중간에 실패해 객체가 부분 생성된 경우: 먼저 `db/reset.sql` 실행으로 정리 후 재실행
3. 연결 문자열 복사: 프로젝트 대시보드 **상단 툴바의 `Connect` 버튼** → Connection string 항목에서
   **Transaction pooler** 방식의 URI 선택 (포트 `6543` — 서버리스 함수에 안전한 pooled 연결)
   - `[YOUR-PASSWORD]` 자리에는 프로젝트 생성 시 설정한 데이터베이스 비밀번호 입력
   - 비밀번호를 잊었다면 Connect 패널 또는 Project Settings → Database 에서 재설정
4. 이 값을 `DATABASE_URL` 로 사용

> Vercel Postgres(Neon)를 쓰는 경우에도 동일한 `schema.sql` 그대로 적용되고 `DATABASE_URL`만 바꾸면 된다.

### 2) 네이버 Search API

1. https://developers.naver.com/apps/#register 에서 애플리케이션 등록
   - API 유형: **검색 API** / 서비스 환경: **웹 애플리케이션**
2. 발급된 `Client ID` / `Client Secret` → `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`

### 3) 환경변수

**로컬 개발**: `.env.example`을 복사해 **`.env.local`**을 만들고 아래 5개를 모두 채웁니다
(`.env.local`은 `.gitignore`에 등록되어 커밋되지 않고, `.env.example`은 값 없는 템플릿으로 유지).

| 변수 | 값 구하는 곳 | 비고 |
|---|---|---|
| `DATABASE_URL` | Supabase 대시보드 상단 **Connect** → Connection string → **Transaction pooler**(포트 6543) | 비밀번호의 `@`→`%40` 등 URI 인코딩 필수 |
| `CRON_SECRET` | 직접 생성: `python -c "import secrets; print(secrets.token_urlsafe(32))"` | 크론 엔드포인트 보호용 랜덤 문자열 |
| `NAVER_CLIENT_ID` | [네이버 개발자센터](https://developers.naver.com/apps/#register) 앱 등록 | 검색 API 유형 |
| `NAVER_CLIENT_SECRET` | 위와 동일 | |

```bash
cp .env.example .env.local   # 복사 후 위 표의 값으로 채우기
```

**프로덕션(Vercel)**: 같은 변수들을 `vercel env add`로 등록 (배포 절차는 아래 3장 참조).
Vercel Cron은 등록된 `CRON_SECRET`을 `Authorization: Bearer` 헤더로 자동 첨부하며,
수집 함수는 이 값이 일치할 때만 실행됩니다.

## 2. 로컬 실행

```bash
# 프론트엔드
npm install
npm run dev                    # http://localhost:3000

# 수집 함수 로컬 테스트 (Python) — 파일 경로 = 엔드포인트 경로
pip install -r requirements.txt
python -m flask --app api.manual.collect run    # → http://127.0.0.1:5000/api/manual/collect?target=all
```

수동 수집 엔드포인트:
- `GET /api/manual/collect?target=all|skt|kt|lgu|naver` — 개별 통신사 또는 전체
- `GET /api/health` — 헬스체크

## 3. Vercel 배포

```bash
npm i -g vercel
vercel                     # 프로젝트 연결 (framework: Next.js 자동 감지)
vercel env add DATABASE_URL
vercel env add CRON_SECRET
vercel env add NAVER_CLIENT_ID
vercel env add NAVER_CLIENT_SECRET
vercel --prod
```

배포 후 동작:
- `vercel.json` 의 cron이 **매일 09:00 KST**에 `GET /api/cron/collect_all` 호출
- Vercel이 `Authorization: Bearer ${CRON_SECRET}` 헤더를 자동 첨부 → 함수가 검증 후 수집 실행
- 실행 결과는 DB `scrape_runs` 테이블과 대시보드 오버뷰 페이지에서 확인

> Python 함수(`api/**/*.py`)는 Vercel이 루트 `requirements.txt` 를 읽어 자동으로 의존성을 설치한다.
> cron이 시간 초과로 실패하면 `vercel.json`의 functions에 `"maxDuration": 300`을 추가한다.

## 4. 수집 커버리지 (2026-08-17 라이브 검증)

| 통신사 | 소스 | 수집 내용 | 상태 |
|---|---|---|---|
| SKT | `m.tworld.co.kr/product/roaming/fee` | baro/OnePass/가족로밍 등 12종 (페이지 내 임베디드 제품 JSON) | ✅ 안정 |
| SKT | `sktelecom.com/customer/notice.do` | 공지 중 로밍/eSIM/해외/국제 키워드 해당 건 | ✅ 동작 (로밍 공지는 드물어 0건이 정상일 수 있음) |
| KT | `globalroaming.kt.com` + `/product/data/main` | 함께 쓰는 로밍 등 상품 11종 | ✅ 안정 |
| KT | `globalroaming.kt.com/news/list` | 로밍 공지 전체(SSR 게시판) | ✅ 안정 |
| LGU+ | `lguplus.com/plan/roaming` (데스크톱 UA) | 허브 서비스 링크 4종 | ✅ 안정 |
| LGU+ | `.../roaming/guide` (**모바일 UA 필수**) | 데이터 안심옵션/문자 건당 요금 4종 | ✅ 안정 |
| LGU+ | 요금제 목록 | CSR 렌더링 — HTML에 데이터 없음 | ⚠️ 미수집 (후속: 내부 API 역설계) |
| LGU+ | 공지사항 | 안정적 SSR 경로 미확인 | ⚠️ 미수집 |
| 네이버 | Search API (`news.json`) | 검색어 6종 × 30건, 중복 URL 스킵 | ✅ (API 키 필요) |

**알려진 사이트 특성**:
- LGU+는 UA별로 다른 페이지를 반환 — 데스크톱 UA엔 CSR 셸, iPhone UA엔 SSR 버전. 가이드 수집은 반드시 모바일 UA로 요청한다.
- SKT 구 공지 경로(`/kor/notice/list.do`)는 200을 반환하는 소프트 404 — 현재 경로는 `/customer/notice.do`.

**LGU+ 요금제 목록 미수집의 개선 옵션** (JS 번들 분석 결과 데이터 API는 미공개):
1. 외부 렌더링 API 연동(유료 서비스) — 크론에서 렌더링 요청 후 HTML 파싱
2. GitHub Actions + Playwright로 별도 크론이 JSON을 뽑아 같은 DB에 적재하는 하이브리드
3. 현행 유지 — 허브 링크/가이드 요금 변동만 추적 (요금제 가격 일부는 가이드에서 간접 커버)

## 5. 데이터 모델 요약

| 테이블 | 용도 |
|---|---|
| `roaming_items` | 요금제/부가서비스/프로모션 현재 상태 (활성/단종) |
| `roaming_item_versions` | 항목별 변경 스냅샷 append-only — 가격/내용 변경 히스토리 |
| `notices` | 통신사 공지사항 |
| `news_articles` | 네이버 로밍 뉴스 아카이브 |
| `scrape_runs` | 수집 실행 로그 (성공/부분/실패 + 통계) |

**중복 방지**: 통신사+카테고리+URL (또는 뉴스 URL) 고유 제약 + `content_hash`(SHA-256) 비교.
**변경 감지**: hash가 다르면 새 버전 레코드를 추가 저장(기존 데이터 보존)하고 `updated_at` 갱신.
**New 뱃지**: `first_seen_at`이 24시간 이내인 항목.

## 6. 대시보드 페이지

| 경로 | 내용 | 필터 |
|---|---|---|
| `/` | KPI 오버뷰 + 최근 수집 상태 + 신규 항목 하이라이트 | — |
| `/plans` | 요금제/부가서비스/프로모션 + 버전 히스토리 | 통신사·카테고리·날짜·검색어 |
| `/notices` | 공지사항 아카이브 | 통신사·날짜·검색어 |
| `/news` | 로밍 뉴스 아카이브 | 키워드·날짜 |
