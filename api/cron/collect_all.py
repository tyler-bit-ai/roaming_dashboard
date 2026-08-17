"""Vercel 크론 진입점 — 매일 09:00 KST (vercel.json) 에 자동 호출.

파일 경로 = 요청 경로(/api/cron/collect_all) 원칙으로 배치해 Vercel 파일 기반
라우팅과 Flask 내부 라우팅이 항상 일치한다.
"""
from __future__ import annotations

import traceback

from flask import Flask, jsonify, request

from collector.config import load_settings
from collector.pipeline import run_collection

app = Flask(__name__)


@app.get("/api/cron/collect_all")
def cron_collect_all():
    settings = load_settings()
    # Vercel Cron 은 Authorization: Bearer ${CRON_SECRET} 를 자동 첨부한다
    auth_header = request.headers.get("Authorization", "")
    if not settings.cron_secret or auth_header != f"Bearer {settings.cron_secret}":
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    try:
        summary = run_collection(settings=settings, target="all", trigger="cron")
        return jsonify({"success": True, "summary": summary}), 200
    except Exception as exc:  # noqa: BLE001 — 서버리스에서는 전체 스택을 로그로 남김
        traceback.print_exc()
        return jsonify({"success": False, "message": str(exc)}), 500
