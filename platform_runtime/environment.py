from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_environment() -> None:
    """Small dotenv subset: KEY=value, optionally quoted; no interpolation or execution."""
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.strip().replace("_", "").isalnum():
            raise ValueError("Ungültige Zeile in .env; erwartet KEY=value.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def project_database_path(project_id: str) -> Path:
    if project_id == "olive-symposium":
        value = os.environ.get("OLIVE_DATABASE_PATH") or os.environ.get("UMFRAGEN_DB") or "data/umfragen.sqlite3"
        return (ROOT / value).resolve()
    import re
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", project_id) or len(project_id) > 80:
        raise ValueError("Ungültige Projekt-ID.")
    return ROOT / "data" / "projects" / f"{project_id}.sqlite"
