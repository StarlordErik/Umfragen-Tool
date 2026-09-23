from __future__ import annotations

import importlib.util
import ipaddress
import os
import sys
from functools import lru_cache

from .environment import ROOT, load_environment, project_database_path


@lru_cache(maxsize=1)
def load_legacy():
    load_environment()
    os.environ["UMFRAGEN_DB"] = str(project_database_path("olive-symposium"))
    pins = os.environ.get("OLIVE_PINS_PATH") or os.environ.get("UMFRAGEN_PINS")
    if pins:
        os.environ["UMFRAGEN_PINS"] = str((ROOT / pins).resolve())
    source = ROOT / "src/projects/olive-symposium/legacy/app.py"
    spec = importlib.util.spec_from_file_location("olive_legacy", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def handler_for(app):
    class MountedOliveHandler(app.OilSurveyHandler):
        def do_GET(self):
            if self.path == "/__health":
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", "2")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b"ok")
                return
            super().do_GET()

        def parse_request(self):
            parsed = super().parse_request()
            if parsed:
                # Backend listens only on loopback. The public Node server overwrites
                # this header from socket.remoteAddress; client input cannot spoof it.
                forwarded = self.headers.get("X-Olive-Client-IP")
                if forwarded:
                    try:
                        self.client_address = (str(ipaddress.ip_address(forwarded)), self.client_address[1])
                    except ValueError:
                        self.send_error(400, "Invalid client address")
                        return False
            return parsed
    return MountedOliveHandler


@lru_cache(maxsize=1)
def load_snapshot():
    source = ROOT / "src/projects/olive-symposium/legacy/snapshot.py"
    spec = importlib.util.spec_from_file_location("olive_snapshot", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
