"""Private Oliven runtime. Node owns the process through a dedicated control pipe."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import threading
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from platform_runtime.olive import handler_for, load_legacy
from platform_runtime.environment import project_database_path


def run() -> int:
    server = None
    stopping = threading.Event()

    def control():
        while True:
            line = sys.stdin.buffer.readline()
            if not line:
                # EOF also occurs on Windows when JetBrains hard-kills Node.
                os._exit(0)
            if line == b"stop\n":
                stopping.set()
                if server is not None:
                    server.shutdown()
                # Keep watching EOF while initialization or shutdown is still running.

    threading.Thread(target=control, daemon=True).start()
    try:
        # A typo must never silently create a replacement for existing data.
        if not project_database_path("olive-symposium").is_file():
            print(json.dumps({"event": "error", "reason": "database-missing"}), flush=True)
            return 1
        app = load_legacy()
        app.init_db(app.load_config())

        class RuntimeHandler(handler_for(app)):
            def log_message(self, format, *args):
                pass  # Request URLs and tracebacks do not belong in lifecycle logs.

        server = ThreadingHTTPServer(("127.0.0.1", 0), RuntimeHandler)
        server.daemon_threads = True
        if stopping.is_set():
            return 0
        print(json.dumps({"event": "ready", "port": server.server_port, "pid": os.getpid()}), flush=True)
        server.serve_forever(poll_interval=0.2)
        return 0
    except Exception:
        print(json.dumps({"event": "error", "reason": "startup-failed"}), flush=True)
        return 1
    finally:
        if server is not None:
            server.server_close()


if __name__ == "__main__":
    raise SystemExit(run())
