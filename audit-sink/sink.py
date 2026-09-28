#!/usr/bin/env python3
"""
audit-sink : mini collecteur de journaux (simulation d'un SIEM).
Reçoit les événements d'audit envoyés en HTTP POST (webhook d'audit MinIO)
et les écrit, un JSON par ligne, dans /logs/minio/audit.jsonl.
"""
import json, os, sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT_DIR = os.environ.get("AUDIT_DIR", "/logs/minio")
TOKEN = os.environ.get("AUDIT_TOKEN", "")          # jeton partagé (en-tête Authorization)
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "audit.jsonl")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if TOKEN and self.headers.get("Authorization", "") not in (TOKEN, f"Bearer {TOKEN}"):
            self.send_response(401); self.end_headers(); return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        lines = []
        for raw in body.decode("utf-8", "replace").splitlines():
            raw = raw.strip()
            if not raw:
                continue
            try:
                evt = json.loads(raw)
            except json.JSONDecodeError:
                evt = {"raw": raw}
            for e in (evt if isinstance(evt, list) else [evt]):
                e.setdefault("_recu_le", datetime.now(timezone.utc).isoformat())
                e.setdefault("_source", self.path.strip("/") or "inconnue")
                lines.append(json.dumps(e, ensure_ascii=False))
        with open(OUT, "a", encoding="utf-8") as f:
            for l in lines:
                f.write(l + "\n")
        self.send_response(200); self.end_headers()

    def do_GET(self):  # sonde de santé
        self.send_response(200); self.end_headers(); self.wfile.write(b"audit-sink OK\n")

    def log_message(self, fmt, *args):
        sys.stderr.write("[audit-sink] " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"[audit-sink] écoute sur :8088 -> {OUT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8088), Handler).serve_forever()
