"""Wienkunde: statische App aus site/ plus Lernfortschritt in data/state.json (geräteübergreifend).
Läuft auf 127.0.0.1:8230; erreichbar über Tailscale Serve https://debian-server.tail48ed7a.ts.net:8445
(HTTPS ist nötig, damit der Browser den Standort freigibt)."""
import json, pathlib, os, threading, gzip
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = pathlib.Path(__file__).resolve().parent
SITE = ROOT / "site"; STATE = ROOT / "data/state.json"
STATE.parent.mkdir(exist_ok=True)
lock = threading.Lock()

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(SITE), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        if self.path.startswith("/data/") or self.path.endswith((".js", ".css", ".html")) or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.endswith((".json", ".js", ".css")) and "gzip" in self.headers.get("Accept-Encoding", ""):
            f = SITE / path.lstrip("/")
            if f.is_file() and f.resolve().is_relative_to(SITE):
                gz = ROOT / "data/gz" / (path.lstrip("/").replace("/", "__") + ".gz")
                if not gz.exists() or gz.stat().st_mtime < f.stat().st_mtime:
                    gz.parent.mkdir(parents=True, exist_ok=True); gz.write_bytes(gzip.compress(f.read_bytes(), 6))
                b = gz.read_bytes()
                ct = "application/json" if path.endswith(".json") else "text/javascript" if path.endswith(".js") else "text/css"
                self.send_response(200); self.send_header("Content-Type", ct + "; charset=utf-8"); self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if self.path == "/api/state":
            with lock:
                return self.send_json(json.loads(STATE.read_text()) if STATE.exists() else {})
        return super().do_GET()
    def do_POST(self):
        if self.path != "/api/state": return self.send_error(404)
        n = int(self.headers.get("Content-Length", 0))
        if n > 5_000_000: return self.send_error(413)
        data = json.loads(self.rfile.read(n))
        with lock:
            tmp = STATE.with_suffix(".tmp"); tmp.write_text(json.dumps(data, ensure_ascii=False)); os.replace(tmp, STATE)
        self.send_json({"ok": True})

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("PORT", 8230))), H).serve_forever()
