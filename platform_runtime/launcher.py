from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import threading
import time
import urllib.request
import webbrowser
from http.server import ThreadingHTTPServer

from .environment import ROOT, load_environment
from .olive import handler_for, load_legacy


def run() -> None:
    load_environment()
    parser = argparse.ArgumentParser(description="Projektraum – Next.js und Oliven-Symposium gemeinsam starten.")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--production", action="store_true")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node or not (ROOT / "node_modules/next/package.json").is_file():
        parser.error("Node.js 24 LTS und npm install sind erforderlich. Siehe README.md.")
    if not os.environ.get("OLIVE_ADMIN_PASSWORD"):
        parser.error("Bitte OLIVE_ADMIN_PASSWORD in der lokalen .env setzen (Vorlage: .env.example).")
    if args.production and not (ROOT / ".next/BUILD_ID").is_file():
        parser.error("Vor dem Produktionsstart bitte npm run build ausführen.")
    app = load_legacy()
    app.init_db(app.load_config())
    backend = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(app))
    backend.daemon_threads = True
    thread = threading.Thread(target=backend.serve_forever, daemon=True)
    thread.start()
    port = app.find_open_port(args.host, args.port)
    environment = {
        **os.environ,
        "HOST": args.host,
        "PORT": str(port),
        "NODE_ENV": "production" if args.production else "development",
        "OLIVE_LEGACY_ORIGIN": f"http://127.0.0.1:{backend.server_port}",
        "PLATFORM_PARENT_PID": str(os.getpid()),
    }
    child = None
    try:
        child = subprocess.Popen([node, str(ROOT / "scripts/server.mjs")], cwd=ROOT, env=environment)
        print(f"Lokal: http://localhost:{port}/", flush=True)
        print(f"WLAN:  {app.network_home_url(port)}", flush=True)
        print(f"Oliven-Symposium: http://localhost:{port}/projects/olive-symposium", flush=True)
        if not args.no_browser:
            def open_when_ready():
                for _ in range(120):
                    if child.poll() is not None:
                        return
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1):
                            webbrowser.open(f"http://localhost:{port}/")
                            return
                    except (OSError, TimeoutError):
                        time.sleep(0.5)
            threading.Thread(target=open_when_ready, daemon=True).start()
        child.wait()
    except KeyboardInterrupt:
        print("\nProjektraum wird beendet.")
    finally:
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        backend.shutdown()
        backend.server_close()
    if child and child.returncode not in (0, None) and child.returncode > 0:
        raise SystemExit(child.returncode)
