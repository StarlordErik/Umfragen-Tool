"""Production launcher/WLAN/shutdown smoke test, using only a synthetic database."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from legacy_server import ROOT, load_app, seed


def reachable(port: int) -> bool:
    with socket.socket() as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


with tempfile.TemporaryDirectory(prefix="platform-launcher-") as directory:
    app = load_app("current")
    seed(app, Path(directory))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {**os.environ, "OLIVE_DATABASE_PATH": str(app.DB_PATH), "OLIVE_PINS_PATH": str(app.PINS_PATH), "OLIVE_ADMIN_PASSWORD": "fixture-admin"}
    log_path = ROOT / ".artifacts/launcher-smoke.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "main.py", "--production", "--host", "0.0.0.0", "--port", str(port), "--no-browser"], cwd=ROOT, env=environment, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 60
            while not reachable(port):
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f"Launcher failed; inspect {log_path}")
                time.sleep(0.2)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for origin in [f"http://127.0.0.1:{port}/", app.network_home_url(port)]:
                with opener.open(origin, timeout=10) as response:
                    assert "Gemeinsam fragen." in response.read().decode("utf-8")
                with opener.open(origin + "projects/olive-symposium", timeout=10) as response:
                    assert 'id="home-app"' in response.read().decode("utf-8")
            print("Production launcher: homepage and legacy reachable via localhost and local network address.")
        finally:
            process.terminate()  # same hard parent shutdown as a Windows IDE stop
            process.wait(timeout=10)
            deadline = time.monotonic() + 15
            while reachable(port) and time.monotonic() < deadline:
                time.sleep(0.2)
            if reachable(port):
                raise RuntimeError("Node child survived termination of the launcher.")
    print("Parent termination: public Node server and Python backend stopped.")
