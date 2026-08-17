-- ============================================================
-- 스키마 완전 초기화 — 스키마 재적용 전 정리용 (기존 데이터 삭제 주의!)
-- 사용 시나리오: schema.sql 실행이 중간에 실패해 부분 생성된 경우,
-- 이 파일을 먼저 실행해 모든 객체를 정리한 뒤 schema.sql 을 다시 실행한다.
-- ============================================================

DROP TABLE IF EXISTS scrape_runs CASCADE;
DROP TABLE IF EXISTS news_articles CASCADE;
DROP TABLE IF EXISTS notices CASCADE;
DROP TABLE IF EXISTS roaming_item_versions CASCADE;
DROP TABLE IF EXISTS roaming_items CASCADE;
DROP TABLE IF EXISTS carriers CASCADE;
DROP TYPE IF EXISTS item_category;
DROP TYPE IF EXISTS carrier_code;
