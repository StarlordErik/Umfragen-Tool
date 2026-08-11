from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import socket
import sqlite3
import sys
import threading
import uuid
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = Path(os.environ.get("UMFRAGEN_DB", str(DATA_DIR / "umfragen.sqlite3")))
CONFIG_PATH = ROOT / "event_config.json"
DECRYPTION_PATH = ROOT / "decryption.json"
STATIC_DIR = ROOT / "static"
COOKIE_NAME = "oil_tasting_participant"
DEFAULT_PORT = 8000
UPDATE_LOCK = threading.Lock()
OIL_SELECTION_PASSWORD = "Erik"


@dataclass
class Respondent:
    id: int
    token: str
    ip: str
    user_agent: str
    is_new_cookie: bool


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug_lookup(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item["id"]): item for item in items}


def load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"Datei fehlt: {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} muss ein JSON-Objekt enthalten.")
    return payload


def load_config() -> dict[str, Any]:
    config = load_json_file(CONFIG_PATH)
    validate_config(config)
    return config


def load_decryption(config: dict[str, Any]) -> dict[str, Any]:
    decryption = load_json_file(DECRYPTION_PATH)
    validate_decryption(config, decryption)
    return decryption


def validate_config(config: dict[str, Any]) -> None:
    if not isinstance(config.get("surveys"), list) or not config["surveys"]:
        raise ValueError("event_config.json braucht mindestens eine Umfrage in 'surveys'.")
    if not isinstance(config.get("oil_type_options"), list) or not config["oil_type_options"]:
        raise ValueError("event_config.json braucht 'oil_type_options'.")

    survey_ids: set[str] = set()
    for survey in config["surveys"]:
        survey_id = survey.get("id")
        if not survey_id or survey_id in survey_ids:
            raise ValueError("Umfrage-IDs müssen gesetzt und eindeutig sein.")
        survey_ids.add(survey_id)
        if not survey.get("cipher_set"):
            raise ValueError(f"Umfrage '{survey_id}' braucht ein cipher_set.")

        field_ids: set[str] = set()
        for field in survey.get("fields", []):
            field_id = field.get("id")
            if not field_id or field_id in field_ids:
                raise ValueError(f"Felder in Umfrage '{survey_id}' brauchen eindeutige IDs.")
            field_ids.add(field_id)


def validate_decryption(config: dict[str, Any], decryption: dict[str, Any]) -> None:
    oils = decryption.get("oils")
    cipher_sets = decryption.get("cipher_sets")
    if not isinstance(oils, list) or len(oils) != 24:
        raise ValueError("decryption.json braucht genau 24 Öl-/Platzhalter-Einträge.")
    if not isinstance(cipher_sets, dict):
        raise ValueError("decryption.json braucht 'cipher_sets'.")

    oil_ids = {oil.get("id") for oil in oils}
    if len(oil_ids) != len(oils):
        raise ValueError("IDs in decryption.json müssen eindeutig sein.")

    for survey in config["surveys"]:
        survey_id = survey["id"]
        cipher_set = survey["cipher_set"]
        allowed = cipher_sets.get(cipher_set)
        if not isinstance(allowed, list) or len(allowed) != 24:
            raise ValueError(f"cipher_set '{cipher_set}' braucht 24 Einträge.")

        seen: set[str] = set()
        for oil in oils:
            cipher = oil.get("ciphers", {}).get(survey_id)
            if not cipher:
                raise ValueError(f"Öl '{oil.get('id')}' braucht eine Chiffre für '{survey_id}'.")
            if cipher not in allowed:
                raise ValueError(f"Chiffre '{cipher}' ist nicht im cipher_set '{cipher_set}'.")
            if cipher in seen:
                raise ValueError(f"Chiffre '{cipher}' ist in '{survey_id}' doppelt vergeben.")
            seen.add(cipher)


def save_config(config: dict[str, Any]) -> None:
    validate_config(config)
    with CONFIG_PATH.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def save_decryption(config: dict[str, Any], decryption: dict[str, Any]) -> None:
    validate_decryption(config, decryption)
    with DECRYPTION_PATH.open("w", encoding="utf-8") as handle:
        json.dump(decryption, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def active_oils(decryption: dict[str, Any]) -> list[dict[str, Any]]:
    return [oil for oil in decryption["oils"] if oil.get("implemented") is True]


def survey_by_id(config: dict[str, Any], survey_id: str) -> dict[str, Any] | None:
    return next((survey for survey in config["surveys"] if survey["id"] == survey_id), None)


def survey_samples(config: dict[str, Any], decryption: dict[str, Any], survey: dict[str, Any]) -> list[dict[str, str]]:
    order = decryption["cipher_sets"][survey["cipher_set"]]
    order_index = {cipher: index for index, cipher in enumerate(order)}
    samples = [
        {"cipher": oil["ciphers"][survey["id"]]}
        for oil in active_oils(decryption)
        if oil.get("ciphers", {}).get(survey["id"])
    ]
    return sorted(samples, key=lambda item: order_index.get(item["cipher"], 999))


def public_runtime_config(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    surveys = []
    for survey in config["surveys"]:
        item = dict(survey)
        item["samples"] = survey_samples(config, decryption, survey)
        surveys.append(item)
    return {
        "event": config.get("event", {}),
        "oil_type_options": config.get("oil_type_options", []),
        "surveys": surveys,
    }


def cipher_to_oil(config: dict[str, Any], decryption: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for oil in active_oils(decryption):
        for survey in config["surveys"]:
            cipher = oil.get("ciphers", {}).get(survey["id"])
            if cipher:
                lookup[(survey["id"], cipher)] = oil
    return lookup


def all_cipher_to_oil(config: dict[str, Any], decryption: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for oil in decryption["oils"]:
        for survey in config["surveys"]:
            cipher = oil.get("ciphers", {}).get(survey["id"])
            if cipher:
                lookup[(survey["id"], cipher)] = oil
    return lookup


def oil_response_counts(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, int]:
    lookup = all_cipher_to_oil(config, decryption)
    counts = {oil["id"]: 0 for oil in decryption["oils"]}
    with connect_db() as db:
        rows = db.execute("SELECT survey_id, cipher, COUNT(*) AS count FROM survey_responses GROUP BY survey_id, cipher").fetchall()
    for row in rows:
        oil = lookup.get((row["survey_id"], row["cipher"]))
        if oil:
            counts[oil["id"]] = counts.get(oil["id"], 0) + int(row["count"])
    return counts


def oil_selection_payload(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    counts = oil_response_counts(config, decryption)
    oils = []
    for oil in decryption["oils"]:
        count = counts.get(oil["id"], 0)
        oils.append(
            {
                "id": oil["id"],
                "name": oil.get("name", ""),
                "type": oil.get("type", ""),
                "implemented": bool(oil.get("implemented")),
                "baseline": bool(oil.get("baseline")),
                "ciphers": oil.get("ciphers", {}),
                "response_count": count,
                "can_remove": bool(oil.get("implemented")) and count == 0,
            }
        )
    return {
        "ok": True,
        "oils": oils,
        "active_count": sum(1 for oil in oils if oil["implemented"]),
        "placeholder_count": sum(1 for oil in oils if not oil["implemented"]),
        "oil_type_options": config.get("oil_type_options", []),
    }


def slugify(value: str) -> str:
    normalized = value.casefold()
    replacements = {
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "ß": "ss",
        "ł": "l",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return slug or "oel"


def unique_oil_id(base: str, decryption: dict[str, Any]) -> str:
    existing = {oil["id"] for oil in decryption["oils"]}
    candidate = slugify(base)
    if candidate not in existing:
        return candidate
    suffix = 2
    while f"{candidate}-{suffix}" in existing:
        suffix += 1
    return f"{candidate}-{suffix}"


def add_oil(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    oil_type = str(payload.get("type", "")).strip()
    if not name:
        raise ValueError("Ölname fehlt.")
    if oil_type not in config.get("oil_type_options", []):
        raise ValueError("Öl-Sorte ist nicht erlaubt.")

    slot = next((oil for oil in decryption["oils"] if not oil.get("implemented")), None)
    if slot is None:
        raise ValueError("Es gibt keinen ungenutzten Platzhalter mehr.")

    ciphers = slot.get("ciphers", {})
    new_id = unique_oil_id(name, decryption)
    slot.clear()
    slot.update(
        {
            "id": new_id,
            "name": name[:160],
            "type": oil_type,
            "implemented": True,
            "ciphers": ciphers,
        }
    )
    save_decryption(config, decryption)
    return oil_selection_payload(config, decryption)


def placeholder_id_for(index: int, decryption: dict[str, Any]) -> str:
    existing = {oil["id"] for oil in decryption["oils"]}
    candidate = f"platzhalter-frei-{index + 1:02d}"
    if candidate not in existing:
        return candidate
    suffix = 2
    while f"{candidate}-{suffix}" in existing:
        suffix += 1
    return f"{candidate}-{suffix}"


def remove_oil(config: dict[str, Any], decryption: dict[str, Any], oil_id: str) -> dict[str, Any]:
    counts = oil_response_counts(config, decryption)
    if counts.get(oil_id, 0):
        raise ValueError("Dieses Öl hat bereits Wertungen und kann nicht entfernt werden.")
    for index, oil in enumerate(decryption["oils"]):
        if oil["id"] == oil_id and oil.get("implemented"):
            ciphers = oil.get("ciphers", {})
            placeholder_id = placeholder_id_for(index, decryption)
            oil.clear()
            oil.update(
                {
                    "id": placeholder_id,
                    "name": f"Platzhalter frei {index + 1:02d}",
                    "type": "Platzhalter",
                    "implemented": False,
                    "ciphers": ciphers,
                }
            )
            save_decryption(config, decryption)
            return oil_selection_payload(config, decryption)
    raise ValueError("Öl nicht gefunden.")


def delete_oil_responses(config: dict[str, Any], decryption: dict[str, Any], oil_id: str) -> dict[str, Any]:
    oil = next((item for item in decryption["oils"] if item["id"] == oil_id), None)
    if not oil:
        raise ValueError("Öl nicht gefunden.")

    pairs = [(survey["id"], oil.get("ciphers", {}).get(survey["id"])) for survey in config["surveys"]]
    with UPDATE_LOCK, connect_db() as db:
        for survey_id, cipher in pairs:
            if cipher:
                db.execute("DELETE FROM survey_responses WHERE survey_id = ? AND cipher = ?", (survey_id, cipher))
        db.execute(
            """
            DELETE FROM respondents
            WHERE id NOT IN (SELECT DISTINCT respondent_id FROM survey_responses)
            """
        )
    return oil_selection_payload(config, decryption)


def reset_database() -> dict[str, Any]:
    with UPDATE_LOCK, connect_db() as db:
        db.execute("DELETE FROM survey_responses")
        db.execute("DELETE FROM respondents")
    return {"ok": True, "updated_at": now_iso()}


def require_oil_password(value: Any) -> None:
    if value != OIL_SELECTION_PASSWORD:
        raise ValueError("Passwort ist falsch.")


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db() -> None:
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS respondents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                ip TEXT NOT NULL,
                user_agent TEXT NOT NULL,
                display_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS survey_responses (
                respondent_id INTEGER NOT NULL,
                survey_id TEXT NOT NULL,
                cipher TEXT NOT NULL,
                answers_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (respondent_id, survey_id, cipher),
                FOREIGN KEY (respondent_id) REFERENCES respondents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_respondents_ip_agent
                ON respondents(ip, user_agent, updated_at);

            CREATE INDEX IF NOT EXISTS idx_responses_updated
                ON survey_responses(updated_at);
            """
        )


def parse_cookie(header: str | None) -> dict[str, str]:
    if not header:
        return {}
    jar = cookies.SimpleCookie()
    try:
        jar.load(header)
    except cookies.CookieError:
        return {}
    return {key: morsel.value for key, morsel in jar.items()}


def cookie_header(token: str) -> str:
    return f"{COOKIE_NAME}={token}; Path=/; SameSite=Lax; Max-Age=31536000"


def get_or_create_respondent(handler: BaseHTTPRequestHandler) -> Respondent:
    request_cookies = parse_cookie(handler.headers.get("Cookie"))
    token = request_cookies.get(COOKIE_NAME)
    ip = handler.client_address[0]
    user_agent = handler.headers.get("User-Agent", "")[:500]
    timestamp = now_iso()

    with UPDATE_LOCK, connect_db() as db:
        row = None
        is_new_cookie = False
        if token:
            row = db.execute("SELECT * FROM respondents WHERE token = ?", (token,)).fetchone()

        if row is None:
            row = db.execute(
                """
                SELECT * FROM respondents
                WHERE ip = ? AND user_agent = ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (ip, user_agent),
            ).fetchone()
            if row:
                token = row["token"]
                is_new_cookie = True

        if row is None:
            token = uuid.uuid4().hex
            db.execute(
                """
                INSERT INTO respondents (token, ip, user_agent, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (token, ip, user_agent, timestamp, timestamp),
            )
            row = db.execute("SELECT * FROM respondents WHERE token = ?", (token,)).fetchone()
            is_new_cookie = True
        else:
            db.execute(
                "UPDATE respondents SET ip = ?, user_agent = ?, updated_at = ? WHERE id = ?",
                (ip, user_agent, timestamp, row["id"]),
            )
            row = db.execute("SELECT * FROM respondents WHERE id = ?", (row["id"],)).fetchone()

    return Respondent(
        id=int(row["id"]),
        token=str(row["token"]),
        ip=str(row["ip"]),
        user_agent=str(row["user_agent"]),
        is_new_cookie=is_new_cookie,
    )


def read_json_body(handler: BaseHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return None
    if length > 1_000_000:
        raise ValueError("Request ist zu groß.")
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def send_bytes(
    handler: BaseHTTPRequestHandler,
    status: int,
    payload: bytes,
    content_type: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Cache-Control", "no-store")
    for key, value in (extra_headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(payload)


def send_json(
    handler: BaseHTTPRequestHandler,
    status: int,
    payload: Any,
    extra_headers: dict[str, str] | None = None,
) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    send_bytes(handler, status, data, "application/json; charset=utf-8", extra_headers)


def send_html(
    handler: BaseHTTPRequestHandler,
    status: int,
    markup: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    send_bytes(handler, status, markup.encode("utf-8"), "text/html; charset=utf-8", extra_headers)


def page_shell(title: str, body: str, scripts: str = "", head_extra: str = "") -> str:
    escaped_title = html.escape(title)
    return f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f8fa">
  <title>{escaped_title}</title>
  <link rel="stylesheet" href="/static/styles.css">
  {head_extra}
</head>
<body>
  {body}
  {scripts}
</body>
</html>"""


def error_response(handler: BaseHTTPRequestHandler, status: int, message: str) -> None:
    wants_json = handler.path.startswith("/api/") or "application/json" in handler.headers.get("Accept", "")
    if wants_json:
        send_json(handler, status, {"ok": False, "error": message})
    else:
        send_html(handler, status, page_shell("Fehler", f"<main class='page narrow'><h1>{html.escape(message)}</h1></main>"))


def local_origins(port: int) -> list[str]:
    hosts = {"localhost", "127.0.0.1"}
    try:
        hostname = socket.gethostname()
        hosts.add(hostname)
        for item in socket.gethostbyname_ex(hostname)[2]:
            if item and not item.startswith("127."):
                hosts.add(item)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            hosts.add(sock.getsockname()[0])
    except OSError:
        pass

    ordered = sorted(hosts, key=host_score)
    return [f"http://{host}:{port}" for host in ordered]


def host_score(host: str) -> tuple[int, str]:
    if host.startswith("192.168."):
        return (0, host)
    if host.startswith("10."):
        return (1, host)
    if re.match(r"^172\.(1[6-9]|2[0-9]|3[0-1])\.", host):
        return (2, host)
    if host not in {"localhost", "127.0.0.1"} and not re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
        return (3, host)
    if host not in {"localhost", "127.0.0.1"}:
        return (4, host)
    return (5, host)


def render_home(handler: BaseHTTPRequestHandler, config: dict[str, Any], decryption: dict[str, Any]) -> str:
    port = handler.server.server_address[1]
    host_header = handler.headers.get("Host", f"localhost:{port}")
    current_origin = f"http://{host_header}"
    lan_origins = local_origins(port)
    preferred_origin = lan_origins[0] if lan_origins else current_origin

    survey_cards = []
    for survey in public_runtime_config(config, decryption)["surveys"]:
        href = f"/umfrage/{survey['id']}"
        external_href = f"{preferred_origin}{href}"
        survey_cards.append(
            f"""
            <article class="link-card" style="--accent:{html.escape(survey.get('accent', '#277c61'))}">
              <div>
                <p class="eyebrow">{html.escape(survey.get('short_title', 'Testreihe'))}</p>
                <h2>{html.escape(survey.get('title', survey['id']))}</h2>
              </div>
              <a class="primary-link" href="{html.escape(href)}">Öffnen</a>
              <code>{html.escape(external_href)}</code>
            </article>
            """
        )

    return page_shell(
        "Linktree zum Oliven-Symposium",
        f"""
        <main class="page">
          <section class="topbar">
            <div>
              <p class="eyebrow">{html.escape(config.get('event', {}).get('title', 'Oliven-Symposium'))}</p>
              <h1>Linktree zum Oliven-Symposium</h1>
            </div>
            <div class="topbar-actions">
              <a class="ghost-button" href="/oel-auswahl">Öl-Auswahl</a>
              <a class="primary-link" href="/ergebnisse">Ergebnisse</a>
            </div>
          </section>

          <section class="link-grid">
            {''.join(survey_cards)}
          </section>
        </main>
        """,
    )


def render_survey_page(survey_id: str, config: dict[str, Any]) -> str:
    survey = survey_by_id(config, survey_id)
    if not survey:
        return page_shell("Nicht gefunden", "<main class='page narrow'><h1>Diese Umfrage gibt es nicht.</h1></main>")

    title = f"{survey.get('short_title', survey.get('title', survey_id))} · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        """
        <main id="survey-app" class="page survey-page">
          <div class="loading-panel">Umfrage wird geladen...</div>
        </main>
        """,
        f"""
        <script>window.SURVEY_ID = {json.dumps(survey_id)};</script>
        <script src="/static/survey.js" defer></script>
        """,
    )


def render_results_page(config: dict[str, Any]) -> str:
    title = f"Ergebnisse · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        """
        <main id="results-app" class="page results-page">
          <div class="loading-panel">Ergebnisse werden geladen...</div>
        </main>
        """,
        '<script src="/static/results.js" defer></script>',
    )


def render_oil_selection_page(config: dict[str, Any]) -> str:
    title = f"Öl-Auswahl · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        """
        <main id="oil-selection-app" class="page oil-selection-page">
          <div class="loading-panel">Öl-Auswahl wird geladen...</div>
        </main>
        """,
        '<script src="/static/oils.js" defer></script>',
    )


def bootstrap_payload(config: dict[str, Any], decryption: dict[str, Any], respondent: Respondent, survey_id: str) -> dict[str, Any]:
    runtime_config = public_runtime_config(config, decryption)
    survey = survey_by_id(runtime_config, survey_id)
    if survey is None:
        raise ValueError("Unbekannte Umfrage.")

    with connect_db() as db:
        rows = db.execute(
            """
            SELECT cipher, answers_json, updated_at
            FROM survey_responses
            WHERE respondent_id = ? AND survey_id = ?
            """,
            (respondent.id, survey_id),
        ).fetchall()

    responses = {
        row["cipher"]: {
            "answers": json.loads(row["answers_json"]),
            "updated_at": row["updated_at"],
        }
        for row in rows
    }

    return {
        "ok": True,
        "config": runtime_config,
        "survey": survey,
        "respondent": {"anonymous": True},
        "responses": responses,
        "server_time": now_iso(),
    }


def sanitize_answer(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value.strip()[:2000]
    if isinstance(value, list):
        return [sanitize_answer(item) for item in value[:50]]
    return str(value)[:2000]


def upsert_response(
    config: dict[str, Any],
    decryption: dict[str, Any],
    respondent: Respondent,
    payload: dict[str, Any],
) -> dict[str, Any]:
    survey_id = str(payload.get("survey_id", ""))
    cipher = str(payload.get("cipher", ""))
    answers = payload.get("answers")

    runtime_config = public_runtime_config(config, decryption)
    survey = survey_by_id(runtime_config, survey_id)
    if survey is None:
        raise ValueError("Unbekannte Umfrage.")

    ciphers = {sample["cipher"] for sample in survey.get("samples", [])}
    if cipher not in ciphers:
        raise ValueError("Unbekannte Chiffre.")

    if not isinstance(answers, dict):
        raise ValueError("Antworten müssen ein Objekt sein.")

    field_ids = {field["id"] for field in survey.get("fields", [])}
    sanitized_answers: dict[str, Any] = {}
    for key, value in answers.items():
        if key in field_ids:
            sanitized_answers[key] = sanitize_answer(value)

    timestamp = now_iso()
    with UPDATE_LOCK, connect_db() as db:
        db.execute(
            "UPDATE respondents SET ip = ?, user_agent = ?, updated_at = ? WHERE id = ?",
            (respondent.ip, respondent.user_agent, timestamp, respondent.id),
        )
        db.execute(
            """
            INSERT INTO survey_responses (
                respondent_id, survey_id, cipher, answers_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(respondent_id, survey_id, cipher)
            DO UPDATE SET answers_json = excluded.answers_json, updated_at = excluded.updated_at
            """,
            (
                respondent.id,
                survey_id,
                cipher,
                json.dumps(sanitized_answers, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )

    return {"ok": True, "updated_at": timestamp}


def as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip().replace(",", ".")
        if not normalized:
            return None
        try:
            return float(normalized)
        except ValueError:
            return None
    return None


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def population_stdev(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    return (sum((value - mean) ** 2 for value in values) / len(values)) ** 0.5


def normalize_oil_type(value: Any) -> str:
    return re.sub(r"[^a-z0-9äöüß]+", "", str(value).casefold())


def rank_map(values: dict[str, float | None], reverse: bool = True) -> dict[str, int | None]:
    ranked = sorted(
        ((oil_id, value) for oil_id, value in values.items() if value is not None),
        key=lambda item: item[1],
        reverse=reverse,
    )
    ranks: dict[str, int | None] = {oil_id: None for oil_id in values}
    previous_value: float | None = None
    previous_rank = 0
    for index, (oil_id, value) in enumerate(ranked, start=1):
        if previous_value is not None and value == previous_value:
            rank = previous_rank
        else:
            rank = index
            previous_rank = rank
            previous_value = value
        ranks[oil_id] = rank
    return ranks


def stat_block(values: list[float], rank: int | None = None) -> dict[str, Any]:
    avg = average(values)
    return {
        "avg": round(avg, 2) if avg is not None else None,
        "count": len(values),
        "rank": rank,
    }


def ranking_payload(
    title: str,
    values: dict[str, float | None],
    oils: list[dict[str, Any]],
    ranks: dict[str, int | None],
    unit: str,
    subtitle: str = "",
    reverse: bool = True,
    key: str | None = None,
) -> dict[str, Any]:
    oil_lookup = slug_lookup(oils)
    ordered = sorted(
        [
            {
                "oil_id": oil_id,
                "name": oil_lookup[oil_id]["name"],
                "value": round(value, 2) if value is not None else None,
                "rank": ranks.get(oil_id),
            }
            for oil_id, value in values.items()
            if value is not None and oil_id in oil_lookup
        ],
        key=lambda item: item["rank"] or 999,
        reverse=False,
    )
    if not reverse:
        ordered = sorted(ordered, key=lambda item: item["rank"] or 999)
    return {"key": key or slugify(title), "title": title, "subtitle": subtitle, "unit": unit, "items": ordered}


def result_payload(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    oils = active_oils(decryption)
    oil_order = [oil["id"] for oil in oils]
    oil_lookup = slug_lookup(oils)
    surveys = public_runtime_config(config, decryption)["surveys"]
    survey_lookup = slug_lookup(surveys)
    survey_numbers = {survey["id"]: index + 1 for index, survey in enumerate(surveys)}
    field_lookup = {
        survey["id"]: {field["id"]: field for field in survey.get("fields", [])}
        for survey in surveys
    }
    sample_lookup = cipher_to_oil(config, decryption)

    oil_stats: dict[str, dict[str, Any]] = {}
    for oil in oils:
        oil_stats[oil["id"]] = {
            "overall": [],
            "overall_by_survey": {survey["id"]: [] for survey in surveys},
            "overall_by_ip": {},
            "bitter": [],
            "guess_correct": 0,
            "guess_total": 0,
            "response_count": 0,
            "comments": [],
        }

    with connect_db() as db:
        response_rows = db.execute(
            """
            SELECT sr.*, r.ip
            FROM survey_responses sr
            JOIN respondents r ON r.id = sr.respondent_id
            ORDER BY sr.updated_at DESC
            """
        ).fetchall()
        session_count = db.execute("SELECT COUNT(*) AS count FROM respondents").fetchone()["count"]

    tester_ids: set[int] = set()
    for row in response_rows:
        survey_id = row["survey_id"]
        cipher = row["cipher"]
        oil = sample_lookup.get((survey_id, cipher))
        survey = survey_lookup.get(survey_id)
        if not oil or not survey:
            continue

        oil_id = oil["id"]
        tester_ids.add(int(row["respondent_id"]))
        oil_stats[oil_id]["response_count"] += 1
        try:
            answers = json.loads(row["answers_json"])
        except json.JSONDecodeError:
            answers = {}

        overall = as_float(answers.get("overall"))
        if overall is not None:
            oil_stats[oil_id]["overall"].append(overall)
            oil_stats[oil_id]["overall_by_survey"][survey_id].append(overall)
            oil_stats[oil_id]["overall_by_ip"].setdefault(row["ip"], []).append(overall)

        bitter = as_float(answers.get("bitter"))
        if bitter is not None and "bitter" in field_lookup.get(survey_id, {}):
            oil_stats[oil_id]["bitter"].append(bitter)

        guess = answers.get("oil_guess")
        if guess:
            oil_stats[oil_id]["guess_total"] += 1
            if normalize_oil_type(guess) == normalize_oil_type(oil.get("type", "")):
                oil_stats[oil_id]["guess_correct"] += 1

        comment = str(answers.get("aroma_profile") or "").strip()
        if comment:
            oil_stats[oil_id]["comments"].append(
                {
                    "survey_id": survey_id,
                    "survey_title": survey.get("short_title", survey.get("title", survey_id)),
                    "series_label": f"Testreihe {survey_numbers.get(survey_id, '?')}",
                    "cipher": cipher,
                    "text": comment,
                    "updated_at": row["updated_at"],
                }
            )

    overall_values = {oil_id: average(oil_stats[oil_id]["overall"]) for oil_id in oil_order}
    overall_ranks = rank_map(overall_values, reverse=True)
    spread_values = {oil_id: population_stdev(oil_stats[oil_id]["overall"]) for oil_id in oil_order}
    spread_ranks = rank_map(spread_values, reverse=True)
    own_spread_values: dict[str, float | None] = {}
    own_spread_counts: dict[str, int] = {}
    for oil_id in oil_order:
        own_spreads = []
        for values in oil_stats[oil_id]["overall_by_ip"].values():
            spread = population_stdev(values)
            if spread is not None:
                own_spreads.append(spread)
        own_spread_values[oil_id] = average(own_spreads)
        own_spread_counts[oil_id] = len(own_spreads)
    own_spread_ranks = rank_map(own_spread_values, reverse=True)
    bitter_values = {oil_id: average(oil_stats[oil_id]["bitter"]) for oil_id in oil_order}
    bitter_ranks = rank_map(bitter_values, reverse=True)
    accuracy_values = {
        oil_id: (
            oil_stats[oil_id]["guess_correct"] / oil_stats[oil_id]["guess_total"]
            if oil_stats[oil_id]["guess_total"]
            else None
        )
        for oil_id in oil_order
    }
    accuracy_ranks = rank_map(accuracy_values, reverse=True)

    overall_by_survey_values: dict[str, dict[str, float | None]] = {}
    overall_by_survey_ranks: dict[str, dict[str, int | None]] = {}
    for survey in surveys:
        survey_id = survey["id"]
        values = {oil_id: average(oil_stats[oil_id]["overall_by_survey"][survey_id]) for oil_id in oil_order}
        overall_by_survey_values[survey_id] = values
        overall_by_survey_ranks[survey_id] = rank_map(values, reverse=True)

    rankings = [
        ranking_payload("Gesamteindruck gesamt", overall_values, oils, overall_ranks, "Punkte"),
    ]
    for survey in surveys:
        survey_id = survey["id"]
        rankings.append(
            ranking_payload(
                f"Gesamteindruck: {survey.get('short_title', survey['title'])}",
                overall_by_survey_values[survey_id],
                oils,
                overall_by_survey_ranks[survey_id],
                "Punkte",
            )
        )
    rankings.extend(
        [
            ranking_payload("eigene Streuung", own_spread_values, oils, own_spread_ranks, "Zahl", "Abweichung derselben IP über Testreihen", key="own_spread"),
            ranking_payload("Streuung", spread_values, oils, spread_ranks, "σ", "höchste Streuung im Gesamteindruck"),
            ranking_payload("Bitterkeit", bitter_values, oils, bitter_ranks, "Punkte", "bitterstes Öl zuerst"),
            ranking_payload("Trefferquote", accuracy_values, oils, accuracy_ranks, "%", "korrekte Öl-Sorte"),
        ]
    )

    oil_payload = []
    for oil_id in oil_order:
        oil = oil_lookup[oil_id]
        stat = oil_stats[oil_id]
        overall_by_survey = {}
        for survey in surveys:
            survey_id = survey["id"]
            overall_by_survey[survey_id] = stat_block(
                stat["overall_by_survey"][survey_id],
                overall_by_survey_ranks[survey_id].get(oil_id),
            )

        spread_value = spread_values[oil_id]
        guess_total = stat["guess_total"]
        oil_payload.append(
            {
                "id": oil_id,
                "name": oil["name"],
                "type": oil.get("type", ""),
                "baseline": bool(oil.get("baseline")),
                "ciphers": oil.get("ciphers", {}),
                "response_count": stat["response_count"],
                "overall": {
                    "all": stat_block(stat["overall"], overall_ranks.get(oil_id)),
                    "by_survey": overall_by_survey,
                },
                "spread": {
                    "value": round(spread_value, 2) if spread_value is not None else None,
                    "count": len(stat["overall"]),
                    "rank": spread_ranks.get(oil_id),
                },
                "own_spread": {
                    "value": round(own_spread_values[oil_id], 2) if own_spread_values[oil_id] is not None else None,
                    "count": own_spread_counts[oil_id],
                    "rank": own_spread_ranks.get(oil_id),
                },
                "bitter": stat_block(stat["bitter"], bitter_ranks.get(oil_id)),
                "guess": {
                    "accuracy": round(stat["guess_correct"] / guess_total, 3) if guess_total else None,
                    "correct": stat["guess_correct"],
                    "total": guess_total,
                    "rank": accuracy_ranks.get(oil_id),
                },
                "comments": stat["comments"],
            }
        )

    total_guesses = sum(oil_stats[oil_id]["guess_total"] for oil_id in oil_order)
    correct_guesses = sum(oil_stats[oil_id]["guess_correct"] for oil_id in oil_order)
    total_samples = sum(len(survey.get("samples", [])) for survey in surveys)
    response_count = sum(oil_stats[oil_id]["response_count"] for oil_id in oil_order)
    expected_responses = len(tester_ids) * total_samples if tester_ids else 0

    return {
        "ok": True,
        "config": {
            "event": config.get("event", {}),
            "surveys": surveys,
        },
        "summary": {
            "tester_count": len(tester_ids),
            "session_count": session_count,
            "response_count": response_count,
            "expected_responses": expected_responses,
            "completion_ratio": round(response_count / expected_responses, 3) if expected_responses else None,
            "guess_accuracy": round(correct_guesses / total_guesses, 3) if total_guesses else None,
            "guess_correct": correct_guesses,
            "guess_total": total_guesses,
            "updated_at": response_rows[0]["updated_at"] if response_rows else None,
        },
        "rankings": rankings,
        "oils": oil_payload,
        "server_time": now_iso(),
    }


class OilSurveyHandler(BaseHTTPRequestHandler):
    server_version = "OilSurvey/2.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))

    def do_GET(self) -> None:
        try:
            self.route_get()
        except Exception as exc:  # noqa: BLE001 - HTTP boundary
            error_response(self, 500, str(exc))

    def do_POST(self) -> None:
        try:
            self.route_post()
        except json.JSONDecodeError:
            error_response(self, 400, "Ungültiges JSON.")
        except ValueError as exc:
            error_response(self, 400, str(exc))
        except Exception as exc:  # noqa: BLE001 - HTTP boundary
            error_response(self, 500, str(exc))

    def route_get(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        config = load_config()

        if path == "/":
            decryption = load_decryption(config)
            send_html(self, 200, render_home(self, config, decryption))
            return

        if path.startswith("/static/"):
            self.serve_static(path)
            return

        if path.startswith("/umfrage/"):
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            survey_id = path.rsplit("/", 1)[-1]
            send_html(self, 200, render_survey_page(survey_id, config), headers)
            return

        if path == "/ergebnisse":
            send_html(self, 200, render_results_page(config))
            return

        if path == "/oel-auswahl":
            send_html(self, 200, render_oil_selection_page(config))
            return

        if path == "/api/bootstrap":
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            survey_id = query.get("survey_id", [""])[0]
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_json(self, 200, bootstrap_payload(config, decryption, respondent, survey_id), headers)
            return

        if path == "/api/results":
            decryption = load_decryption(config)
            send_json(self, 200, result_payload(config, decryption))
            return

        if path == "/api/oils":
            require_oil_password(query.get("password", [""])[0])
            decryption = load_decryption(config)
            send_json(self, 200, oil_selection_payload(config, decryption))
            return

        if path == "/api/config":
            send_json(self, 200, {"ok": True, "config": config})
            return

        error_response(self, 404, "Nicht gefunden.")

    def route_post(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        config = load_config()

        if path == "/api/response":
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            payload = read_json_body(self)
            send_json(self, 200, upsert_response(config, decryption, respondent, payload), headers)
            return

        if path == "/api/oils/add":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, add_oil(config, decryption, payload))
            return

        if path == "/api/oils/remove":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, remove_oil(config, decryption, str(payload.get("oil_id", ""))))
            return

        if path == "/api/oils/clear":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, delete_oil_responses(config, decryption, str(payload.get("oil_id", ""))))
            return

        if path == "/api/oils/reset-db":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            reset_database()
            decryption = load_decryption(config)
            send_json(self, 200, oil_selection_payload(config, decryption))
            return

        if path == "/api/config":
            payload = read_json_body(self)
            if not isinstance(payload, dict) or "config" not in payload:
                raise ValueError("Payload braucht 'config'.")
            save_config(payload["config"])
            send_json(self, 200, {"ok": True, "updated_at": now_iso()})
            return

        error_response(self, 404, "Nicht gefunden.")

    def serve_static(self, path: str) -> None:
        relative = path.removeprefix("/static/").replace("/", os.sep)
        requested = (STATIC_DIR / relative).resolve()
        static_root = STATIC_DIR.resolve()
        if static_root not in requested.parents and requested != static_root:
            error_response(self, 403, "Ungültiger Pfad.")
            return
        if not requested.is_file():
            error_response(self, 404, "Datei nicht gefunden.")
            return
        content_type = mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
        with requested.open("rb") as handle:
            send_bytes(self, 200, handle.read(), content_type)


def find_open_port(host: str, preferred: int) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"Kein freier Port ab {preferred} gefunden.")


def run_server(host: str, port: int, open_browser: bool) -> None:
    init_db()
    config = load_config()
    decryption = load_decryption(config)
    actual_port = find_open_port(host, port)
    server = ThreadingHTTPServer((host, actual_port), OilSurveyHandler)
    origins = local_origins(actual_port)

    print("\nOliven-Symposium läuft.")
    print("Zum Verteilen im lokalen Netzwerk:")
    for survey in public_runtime_config(config, decryption)["surveys"]:
        print(f"  {survey.get('short_title', survey['id'])}: {origins[0]}/umfrage/{survey['id']}")
    print(f"  Linktree:   {origins[0]}/")
    print(f"  Ergebnisse: {origins[0]}/ergebnisse")
    print(f"  Öl-Auswahl: {origins[0]}/oel-auswahl")
    print("\nAlle gefundenen Adressen:")
    for origin in origins:
        print(f"  {origin}")
    print("\nBeenden mit Strg+C.\n")

    if open_browser:
        threading.Timer(0.75, lambda: webbrowser.open(f"http://localhost:{actual_port}/")).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer wird beendet.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lokales Umfragen-Tool für das Oliven-Symposium.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind-Adresse, Standard: 0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Start-Port, Standard: {DEFAULT_PORT}")
    parser.add_argument("--no-browser", action="store_true", help="Browser nicht automatisch öffnen")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_server(args.host, args.port, not args.no_browser)
