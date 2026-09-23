"""Real Node/Python lifecycle, WLAN and identity tests, on synthetic databases only."""
from __future__ import annotations

import json
from contextlib import closing
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from legacy_server import ROOT, load_app, seed

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def reachable(port: int) -> bool:
    with socket.socket() as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def get(url: str, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with OPENER.open(request, timeout=3) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as response:
        return response.code, response.read(), response.headers


def wait_for(check, description: str, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, TimeoutError):
            pass
        time.sleep(0.1)
    raise AssertionError(description)


def check_case(entry: str, *, production=True, crash=False, invalid_database=None):
    name = f"{entry}-{'production' if production else 'development'}"
    name += "-crash" if crash else ""
    name += f"-{invalid_database}" if invalid_database else ""
    with tempfile.TemporaryDirectory(prefix="platform-launcher-") as directory:
        app = load_app("current")
        app.CONFIG_PATH = app.LEGACY_ROOT / "event_config.json"
        seed(app, Path(directory))
        database = app.DB_PATH
        if invalid_database == "missing":
            database = Path(directory) / "does-not-exist.sqlite"
        elif invalid_database == "corrupt":
            database = Path(directory) / "invalid.sqlite"
            database.write_bytes(b"This is not a SQLite database.")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = {
            **os.environ, "OLIVE_ENABLED": "true", "OLIVE_LEGACY_ORIGIN": "",
            "OLIVE_DATABASE_PATH": str(database), "OLIVE_PINS_PATH": str(app.PINS_PATH),
            "OLIVE_ADMIN_PASSWORD": "fixture-admin", "OLIVE_PYTHON": sys.executable,
            "OLIVE_STARTUP_TIMEOUT_MS": "300" if invalid_database == "locked" else "15000",
            "PLATFORM_PARENT_PIPE": "0",
            "NODE_ENV": "production" if production else "development",
        }
        if not production:
            # Exercise the default .venv/system interpreter selection as well.
            environment.pop("OLIVE_PYTHON", None)
        locked = None
        if invalid_database == "locked":
            locked = sqlite3.connect(database)
            locked.execute("BEGIN EXCLUSIVE")
        command = ([shutil.which("node"), "scripts/server.ts"] if entry == "node" else [sys.executable, "main.py"])
        command += ["--host", "0.0.0.0", "--port", str(port), "--no-browser"]
        if production:
            command += ["--production"]
        log_path = ROOT / f".artifacts/runtime-{name}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=log)
            backend_port = None
            try:
                origin = f"http://127.0.0.1:{port}/"
                wait_for(lambda: get(origin + "api/health")[0] == 200, f"Platform did not start: {log_path}")
                if invalid_database:
                    if invalid_database == "locked":
                        wait_for(lambda: "Zeitlimit" in log_path.read_text(encoding="utf-8"), "Blocked startup did not time out", 10)
                    assert get(origin)[0] == 200
                    assert get(origin + "projects/olive-symposium")[0] == 503
                    assert get(origin + "api/health/projects/olive-symposium")[0] == 503
                    if invalid_database == "missing":
                        assert not database.exists(), "A missing database was silently created"
                    elif invalid_database == "corrupt":
                        assert database.read_bytes() == b"This is not a SQLite database."
                    print(f"{name}: platform stays available; no replacement database created.")
                    return
                health_url = origin + "api/health/projects/olive-symposium"
                wait_for(lambda: get(health_url)[0] == 200, f"Olive did not start: {log_path}")
                for _ in range(3):
                    status, body, headers = get(health_url)
                    assert status == 200 and json.loads(body) == {"status": "ok"}
                    assert headers["Cache-Control"] == "no-store"
                with closing(sqlite3.connect(database)) as db:
                    assert db.execute("SELECT count(*) FROM respondents").fetchone()[0] == 3, "Health probe created a participant"
                match = re.search(r"\[olive-symposium\] Bereit \(PID (\d+), Port (\d+)\)", log_path.read_text(encoding="utf-8"))
                assert match, "No child readiness event"
                backend_pid, backend_port = map(int, match.groups())
                for public_origin in [origin, app.network_home_url(port)]:
                    assert "Gemeinsam fragen." in get(public_origin)[1].decode("utf-8")
                    assert 'id="home-app"' in get(public_origin + "projects/olive-symposium")[1].decode("utf-8")
                    user_agent = "runtime-identity-" + public_origin
                    endpoint = public_origin + "projects/olive-symposium/api/participant"
                    first = get(endpoint, {"User-Agent": user_agent})
                    second = get(endpoint, {"User-Agent": user_agent, "X-Olive-Client-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.2"})
                    assert first[0] == second[0] == 200
                    assert first[2]["Set-Cookie"] == second[2]["Set-Cookie"], "Anonymous identity changed"
                    with closing(sqlite3.connect(database)) as db:
                        rows = db.execute("SELECT ip FROM respondents WHERE user_agent=?", (user_agent,)).fetchall()
                        assert rows == [(urllib.parse.urlparse(public_origin).hostname,)], "Client IP was spoofed or changed"
                if crash:
                    if os.name == "nt":
                        subprocess.run(["taskkill", "/PID", str(backend_pid), "/F"], check=True, capture_output=True)
                    else:
                        import signal
                        os.kill(backend_pid, signal.SIGKILL)
                    wait_for(lambda: get(health_url)[0] == 503, "Olive crash was not detected", 15)
                    assert get(origin)[0] == 200 and get(origin + "api/health")[0] == 200
                    assert get(origin + "projects/olive-symposium")[0] == 503
                print(f"{name}: homepage, Olive, localhost/WLAN, health and anonymous identity OK.")
            finally:
                process.kill()  # Hard IDE stop, including on Unix (no graceful signal).
                process.wait(timeout=10)
                wait_for(lambda: not reachable(port), "Public server survived parent termination", 15)
                if backend_port:
                    wait_for(lambda: not reachable(backend_port), "Python survived parent termination", 15)
                if locked:
                    locked.close()
        print(f"{name}: public and private ports closed after hard parent termination.")


if __name__ == "__main__":
    check_case("node")
    check_case("python")
    check_case("node", crash=True)
    check_case("node", invalid_database="missing")
    check_case("node", invalid_database="corrupt")
    check_case("node", invalid_database="locked")
    check_case("node", production=False)
