"""헬스체크 엔드포인트 — 배포/모니터링용. 파일 경로 = 요청 경로(/api/health)."""
from __future__ import annotations

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/api/health")
def health():
    return jsonify({"success": True, "service": "roaming-dashboard-collector"}), 200
