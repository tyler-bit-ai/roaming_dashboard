"""수동 수집 트리거 — 로컬 테스트/초기 백필용.

파일 경로 = 요청 경로(/api/manual/collect) 원칙.
사용법: GET /api/manual/collect?target=all|skt|kt|lgu|naver
"""
from __future__ import annotations

import traceback

from flask import Flask, jsonify, request

from collector.config import load_settings
from collector.pipeline import run_collection

app = Flask(__name__)

VALID_TARGETS = {"all", "skt", "kt", "lgu", "naver"}


@app.get("/api/manual/collect")
def manual_collect():
    settings = load_settings()
    # 수동 트리거: CRON_SECRET 이 설정돼 있으면 검증, 없으면 로컬 개발 모드로 허용
    auth_header = request.headers.get("Authorization", "")
    if settings.cron_secret and auth_header != f"Bearer {settings.cron_secret}":
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    target = request.args.get("target", "all")
    if target not in VALID_TARGETS:
        return jsonify({"success": False, "message": "target 은 all|skt|kt|lgu|naver 중 하나여야 합니다."}), 400
    try:
        summary = run_collection(settings=settings, target=target, trigger="manual")
        return jsonify({"success": True, "summary": summary}), 200
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return jsonify({"success": False, "message": str(exc)}), 500
