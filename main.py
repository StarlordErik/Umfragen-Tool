from __future__ import annotations

import argparse
import csv
import html
import io
import json
import mimetypes
import os
import re
import socket
import sqlite3
import sys
import threading
import time
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
DB_PATH = DATA_DIR / "umfragen.sqlite3"
CONFIG_PATH = ROOT / "event_config.json"
STATIC_DIR = ROOT / "static"
COOKIE_NAME = "oil_tasting_participant"
DEFAULT_PORT = 8000
UPDATE_LOCK = threading.Lock()

STOPWORDS = {
    "aber",
    "alle",
    "alles",
    "als",
    "auch",
    "auf",
    "bei",
    "bin",
    "bis",
    "das",
    "dem",
    "den",
    "der",
    "die",
    "ein",
    "eine",
    "einem",
    "einen",
    "einer",
    "eines",
    "eher",
    "für",
    "ganz",
    "hab",
    "hat",
    "ich",
    "im",
    "ist",
    "mit",
    "noch",
    "oder",
    "sehr",
    "so",
    "und",
    "vom",
    "von",
    "war",
    "wie",
    "zu",
    "zum",
    "zur",
}


@dataclass
class Respondent:
    id: int
    token: str
    display_name: str | None
    ip: str
    user_agent: str
    is_new_cookie: bool


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug_lookup(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item["id"]): item for item in items}


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"Konfigurationsdatei fehlt: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    validate_config(config)
    return config


def validate_config(config: dict[str, Any]) -> None:
    if not isinstance(config.get("surveys"), list) or not config["surveys"]:
        raise ValueError("event_config.json braucht mindestens eine Umfrage in 'surveys'.")
    if not isinstance(config.get("oils"), list) or not config["oils"]:
        raise ValueError("event_config.json braucht mindestens ein Öl in 'oils'.")

    oil_ids = {oil.get("id") for oil in config["oils"]}
    if len(oil_ids) != len(config["oils"]):
        raise ValueError("Öl-IDs in event_config.json müssen eindeutig sein.")

    survey_ids: set[str] = set()
    for survey in config["surveys"]:
        survey_id = survey.get("id")
        if not survey_id or survey_id in survey_ids:
            raise ValueError("Umfrage-IDs in event_config.json müssen gesetzt und eindeutig sein.")
        survey_ids.add(survey_id)

        ciphers: set[str] = set()
        for sample in survey.get("samples", []):
            cipher = sample.get("cipher")
            oil_id = sample.get("oil_id")
            if not cipher or cipher in ciphers:
                raise ValueError(f"Chiffren in Umfrage '{survey_id}' müssen eindeutig sein.")
            if oil_id not in oil_ids:
                raise ValueError(f"Unbekannte oil_id '{oil_id}' in Umfrage '{survey_id}'.")
            ciphers.add(cipher)


def save_config(config: dict[str, Any]) -> None:
    validate_config(config)
    with CONFIG_PATH.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def connect_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(exist_ok=True)
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
            row = db.execute(
                "SELECT * FROM respondents WHERE token = ?",
                (token,),
            ).fetchone()

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
            row = db.execute(
                "SELECT * FROM respondents WHERE token = ?",
                (token,),
            ).fetchone()
            is_new_cookie = True
        else:
            db.execute(
                """
                UPDATE respondents
                SET ip = ?, user_agent = ?, updated_at = ?
                WHERE id = ?
                """,
                (ip, user_agent, timestamp, row["id"]),
            )
            row = db.execute(
                "SELECT * FROM respondents WHERE id = ?",
                (row["id"],),
            ).fetchone()

    return Respondent(
        id=int(row["id"]),
        token=str(row["token"]),
        display_name=row["display_name"],
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


def error_response(handler: BaseHTTPRequestHandler, status: int, message: str) -> None:
    wants_json = handler.path.startswith("/api/") or "application/json" in handler.headers.get("Accept", "")
    if wants_json:
        send_json(handler, status, {"ok": False, "error": message})
    else:
        send_html(handler, status, page_shell("Fehler", f"<main class='page narrow'><h1>{html.escape(message)}</h1></main>"))


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


def render_home(handler: BaseHTTPRequestHandler, config: dict[str, Any]) -> str:
    port = handler.server.server_address[1]
    host_header = handler.headers.get("Host", f"localhost:{port}")
    current_origin = f"http://{host_header}"
    lan_origins = local_origins(port)
    preferred_origin = next((origin for origin in lan_origins if "127.0.0.1" not in origin and "localhost" not in origin), current_origin)

    survey_cards = []
    for survey in config["surveys"]:
        href = f"/umfrage/{survey['id']}"
        external_href = f"{preferred_origin}{href}"
        survey_cards.append(
            f"""
            <article class="link-card" style="--accent:{html.escape(survey.get('accent', '#277c61'))}">
              <div>
                <p class="eyebrow">{html.escape(survey.get('method', 'Umfrage'))}</p>
                <h2>{html.escape(survey.get('title', survey['id']))}</h2>
              </div>
              <a class="primary-link" href="{html.escape(href)}">Öffnen</a>
              <code>{html.escape(external_href)}</code>
            </article>
            """
        )

    origins_markup = "".join(f"<code>{html.escape(origin)}</code>" for origin in lan_origins)
    event_title = config.get("event", {}).get("title", "Ölverkostung")
    return page_shell(
        event_title,
        f"""
        <main class="page">
          <section class="topbar">
            <div>
              <p class="eyebrow">Lokale Umfragen</p>
              <h1>{html.escape(event_title)}</h1>
            </div>
            <div class="topbar-actions">
              <a class="ghost-button" href="/admin">Setup</a>
              <a class="primary-link" href="/ergebnisse">Ergebnisse</a>
            </div>
          </section>

          <section class="link-grid">
            {''.join(survey_cards)}
          </section>

          <section class="panel">
            <h2>Netzwerk-Adressen</h2>
            <div class="address-list">{origins_markup}</div>
          </section>
        </main>
        """,
    )


def render_survey_page(survey_id: str, config: dict[str, Any]) -> str:
    survey = next((item for item in config["surveys"] if item["id"] == survey_id), None)
    if not survey:
        return page_shell("Nicht gefunden", "<main class='page narrow'><h1>Diese Umfrage gibt es nicht.</h1></main>")

    title = f"{survey.get('short_title', survey.get('title', survey_id))} · {config.get('event', {}).get('title', 'Ölverkostung')}"
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
    title = f"Ergebnisse · {config.get('event', {}).get('title', 'Ölverkostung')}"
    return page_shell(
        title,
        """
        <main id="results-app" class="page results-page">
          <div class="loading-panel">Ergebnisse werden geladen...</div>
        </main>
        """,
        '<script src="/static/results.js" defer></script>',
    )


def render_admin_page(config: dict[str, Any]) -> str:
    title = f"Setup · {config.get('event', {}).get('title', 'Ölverkostung')}"
    return page_shell(
        title,
        """
        <main id="admin-app" class="page admin-page">
          <div class="loading-panel">Setup wird geladen...</div>
        </main>
        """,
        '<script src="/static/admin.js" defer></script>',
    )


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

    ordered = sorted(hosts, key=lambda value: (value in {"localhost", "127.0.0.1"}, value))
    return [f"http://{host}:{port}" for host in ordered]


def survey_by_id(config: dict[str, Any], survey_id: str) -> dict[str, Any] | None:
    return next((survey for survey in config["surveys"] if survey["id"] == survey_id), None)


def bootstrap_payload(config: dict[str, Any], respondent: Respondent, survey_id: str) -> dict[str, Any]:
    survey = survey_by_id(config, survey_id)
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

    public_config = {
        "event": config.get("event", {}),
        "oil_type_options": config.get("oil_type_options", []),
        "surveys": config.get("surveys", []),
    }
    return {
        "ok": True,
        "config": public_config,
        "survey": survey,
        "respondent": {
            "display_name": respondent.display_name,
            "ip": respondent.ip,
        },
        "responses": responses,
        "server_time": now_iso(),
    }


def upsert_response(config: dict[str, Any], respondent: Respondent, payload: dict[str, Any]) -> dict[str, Any]:
    survey_id = str(payload.get("survey_id", ""))
    cipher = str(payload.get("cipher", ""))
    answers = payload.get("answers")
    display_name = payload.get("display_name")

    survey = survey_by_id(config, survey_id)
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
        if key not in field_ids:
            continue
        sanitized_answers[key] = sanitize_answer(value)

    timestamp = now_iso()
    with UPDATE_LOCK, connect_db() as db:
        if isinstance(display_name, str):
            name = display_name.strip()[:80] or None
            db.execute(
                "UPDATE respondents SET display_name = ?, updated_at = ? WHERE id = ?",
                (name, timestamp, respondent.id),
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


def update_respondent(respondent: Respondent, payload: dict[str, Any]) -> dict[str, Any]:
    name = payload.get("display_name")
    if not isinstance(name, str):
        raise ValueError("Name fehlt.")
    timestamp = now_iso()
    clean_name = name.strip()[:80] or None
    with UPDATE_LOCK, connect_db() as db:
        db.execute(
            "UPDATE respondents SET display_name = ?, updated_at = ? WHERE id = ?",
            (clean_name, timestamp, respondent.id),
        )
    return {"ok": True, "display_name": clean_name, "updated_at": timestamp}


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


def result_payload(config: dict[str, Any]) -> dict[str, Any]:
    oils = slug_lookup(config["oils"])
    oil_order = [oil["id"] for oil in config["oils"]]
    survey_order = [survey["id"] for survey in config["surveys"]]
    survey_lookup = slug_lookup(config["surveys"])
    field_lookup = {
        survey["id"]: {field["id"]: field for field in survey.get("fields", [])}
        for survey in config["surveys"]
    }
    sample_lookup = {
        survey["id"]: {sample["cipher"]: sample for sample in survey.get("samples", [])}
        for survey in config["surveys"]
    }

    with connect_db() as db:
        respondent_rows = db.execute(
            "SELECT * FROM respondents ORDER BY updated_at DESC"
        ).fetchall()
        response_rows = db.execute(
            """
            SELECT sr.*, r.display_name, r.ip
            FROM survey_responses sr
            JOIN respondents r ON r.id = sr.respondent_id
            ORDER BY sr.updated_at DESC
            """
        ).fetchall()

    respondents = [
        {
            "id": row["id"],
            "display_name": row["display_name"] or f"Gast {row['id']}",
            "ip": row["ip"],
            "updated_at": row["updated_at"],
        }
        for row in respondent_rows
    ]

    metric_stats: dict[str, dict[str, dict[str, Any]]] = {}
    oil_stats = {
        oil_id: {
            "oil": oils[oil_id],
            "response_count": 0,
            "guess_correct": 0,
            "guess_total": 0,
            "metrics": {},
        }
        for oil_id in oil_order
    }
    survey_completion: dict[str, dict[str, int]] = {
        survey_id: {sample["cipher"]: 0 for sample in survey_lookup[survey_id].get("samples", [])}
        for survey_id in survey_order
    }
    word_counts: dict[str, int] = {}
    recent_entries = []

    for row in response_rows:
        survey_id = row["survey_id"]
        cipher = row["cipher"]
        survey = survey_lookup.get(survey_id)
        sample = sample_lookup.get(survey_id, {}).get(cipher)
        if not survey or not sample:
            continue

        oil_id = sample["oil_id"]
        oil = oils[oil_id]
        try:
            answers = json.loads(row["answers_json"])
        except json.JSONDecodeError:
            answers = {}

        oil_stats[oil_id]["response_count"] += 1
        survey_completion.setdefault(survey_id, {}).setdefault(cipher, 0)
        survey_completion[survey_id][cipher] += 1

        recent_entries.append(
            {
                "survey_id": survey_id,
                "survey_title": survey.get("short_title", survey.get("title", survey_id)),
                "cipher": cipher,
                "oil_name": oil["name"],
                "respondent": row["display_name"] or f"Gast {row['respondent_id']}",
                "ip": row["ip"],
                "updated_at": row["updated_at"],
                "answers": answers,
            }
        )

        for field_id, value in answers.items():
            field = field_lookup.get(survey_id, {}).get(field_id)
            if not field:
                continue

            if field_id == "oil_guess" and value:
                oil_stats[oil_id]["guess_total"] += 1
                if normalize_oil_type(value) == normalize_oil_type(oil.get("type", "")):
                    oil_stats[oil_id]["guess_correct"] += 1

            if field.get("kind") in {"rating", "range"}:
                numeric_value = as_float(value)
                if numeric_value is not None:
                    metric_key = field.get("metric_key", field_id)
                    metric_label = field.get("summary_label", field.get("label", field_id))
                    metric_stats.setdefault(metric_key, {"label": metric_label, "oils": {}})
                    metric_stats[metric_key]["oils"].setdefault(
                        oil_id,
                        {"sum": 0.0, "count": 0, "min": field.get("min"), "max": field.get("max")},
                    )
                    metric_stats[metric_key]["oils"][oil_id]["sum"] += numeric_value
                    metric_stats[metric_key]["oils"][oil_id]["count"] += 1

                    oil_stats[oil_id]["metrics"].setdefault(
                        metric_key,
                        {"label": metric_label, "sum": 0.0, "count": 0, "min": field.get("min"), "max": field.get("max")},
                    )
                    oil_stats[oil_id]["metrics"][metric_key]["sum"] += numeric_value
                    oil_stats[oil_id]["metrics"][metric_key]["count"] += 1

            if field.get("kind") == "textarea" or field_id in {"aroma_profile", "notes"}:
                for word in extract_words(str(value)):
                    word_counts[word] = word_counts.get(word, 0) + 1

    metrics = []
    metric_order = config.get(
        "result_metric_order",
        ["overall", "bitter", "sharp", "aroma_intensity", "fruity", "nutty", "harmony", "favorite"],
    )
    sorted_keys = sorted(
        metric_stats,
        key=lambda key: (metric_order.index(key) if key in metric_order else 999, key),
    )
    for metric_key in sorted_keys:
        item = metric_stats[metric_key]
        oils_payload = {}
        for oil_id in oil_order:
            stat = item["oils"].get(oil_id)
            if stat and stat["count"]:
                oils_payload[oil_id] = {
                    "avg": round(stat["sum"] / stat["count"], 2),
                    "sum": round(stat["sum"], 2),
                    "count": stat["count"],
                    "min": stat.get("min"),
                    "max": stat.get("max"),
                }
            else:
                oils_payload[oil_id] = None
        metrics.append({"key": metric_key, "label": item["label"], "oils": oils_payload})

    oil_payload = []
    for oil_id in oil_order:
        stat = oil_stats[oil_id]
        metric_payload = {}
        for metric_key, metric in stat["metrics"].items():
            metric_payload[metric_key] = {
                "label": metric["label"],
                "avg": round(metric["sum"] / metric["count"], 2) if metric["count"] else None,
                "sum": round(metric["sum"], 2),
                "count": metric["count"],
                "min": metric.get("min"),
                "max": metric.get("max"),
            }
        total = stat["guess_total"]
        oil_payload.append(
            {
                "id": oil_id,
                "name": stat["oil"]["name"],
                "type": stat["oil"].get("type", ""),
                "baseline": bool(stat["oil"].get("baseline")),
                "response_count": stat["response_count"],
                "guess_correct": stat["guess_correct"],
                "guess_total": total,
                "guess_accuracy": round(stat["guess_correct"] / total, 3) if total else None,
                "metrics": metric_payload,
            }
        )

    total_guesses = sum(item["guess_total"] for item in oil_stats.values())
    correct_guesses = sum(item["guess_correct"] for item in oil_stats.values())
    total_samples = sum(len(survey.get("samples", [])) for survey in config["surveys"])
    expected_responses = len(respondents) * total_samples if respondents else 0

    word_cloud = [
        {"word": word, "count": count}
        for word, count in sorted(word_counts.items(), key=lambda item: (-item[1], item[0]))[:80]
    ]

    return {
        "ok": True,
        "config": {
            "event": config.get("event", {}),
            "surveys": config.get("surveys", []),
            "oils": config.get("oils", []),
        },
        "summary": {
            "respondent_count": len(respondents),
            "response_count": len(response_rows),
            "expected_responses": expected_responses,
            "completion_ratio": round(len(response_rows) / expected_responses, 3) if expected_responses else None,
            "guess_accuracy": round(correct_guesses / total_guesses, 3) if total_guesses else None,
            "guess_correct": correct_guesses,
            "guess_total": total_guesses,
            "updated_at": response_rows[0]["updated_at"] if response_rows else None,
        },
        "respondents": respondents,
        "oils": oil_payload,
        "metrics": metrics,
        "survey_completion": survey_completion,
        "word_cloud": word_cloud,
        "recent_entries": recent_entries[:30],
        "server_time": now_iso(),
    }


def normalize_oil_type(value: Any) -> str:
    return re.sub(r"[^a-z0-9äöüß]+", "", str(value).casefold())


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


def extract_words(value: str) -> list[str]:
    words = []
    for raw in re.findall(r"[A-Za-zÄÖÜäöüß]{3,}", value.casefold()):
        word = raw.strip(".,;:!?()[]{}\"'")
        if len(word) >= 3 and word not in STOPWORDS:
            words.append(word)
    return words


def csv_export(config: dict[str, Any]) -> str:
    oils = slug_lookup(config["oils"])
    survey_lookup = slug_lookup(config["surveys"])
    sample_lookup = {
        survey["id"]: {sample["cipher"]: sample for sample in survey.get("samples", [])}
        for survey in config["surveys"]
    }

    with connect_db() as db:
        rows = db.execute(
            """
            SELECT sr.*, r.display_name, r.ip
            FROM survey_responses sr
            JOIN respondents r ON r.id = sr.respondent_id
            ORDER BY sr.updated_at ASC
            """
        ).fetchall()

    entries = []
    for row in rows:
        survey = survey_lookup.get(row["survey_id"])
        sample = sample_lookup.get(row["survey_id"], {}).get(row["cipher"])
        if not survey or not sample:
            continue
        oil = oils.get(sample["oil_id"], {"name": sample["oil_id"]})
        try:
            answers = json.loads(row["answers_json"])
        except json.JSONDecodeError:
            answers = {}
        entries.append(
            {
                "updated_at": row["updated_at"],
                "survey_title": survey.get("short_title", survey.get("title", row["survey_id"])),
                "cipher": row["cipher"],
                "oil_name": oil["name"],
                "respondent": row["display_name"] or f"Gast {row['respondent_id']}",
                "ip": row["ip"],
                "answers": answers,
            }
        )

    fields = set()
    for entry in entries:
        fields.update(entry["answers"].keys())
    ordered_fields = sorted(fields)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Zeit", "Umfrage", "Chiffre", "Öl", "Gast", "IP", *ordered_fields])
    for entry in entries:
        writer.writerow(
            [
                entry["updated_at"],
                entry["survey_title"],
                entry["cipher"],
                entry["oil_name"],
                entry["respondent"],
                entry["ip"],
                *[entry["answers"].get(field, "") for field in ordered_fields],
            ]
        )
    return output.getvalue()


class OilSurveyHandler(BaseHTTPRequestHandler):
    server_version = "OilSurvey/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))

    def do_GET(self) -> None:
        try:
            self.route_get()
        except Exception as exc:  # noqa: BLE001 - boundary for request handler
            error_response(self, 500, str(exc))

    def do_POST(self) -> None:
        try:
            self.route_post()
        except json.JSONDecodeError:
            error_response(self, 400, "Ungültiges JSON.")
        except ValueError as exc:
            error_response(self, 400, str(exc))
        except Exception as exc:  # noqa: BLE001 - boundary for request handler
            error_response(self, 500, str(exc))

    def route_get(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        config = load_config()

        if path == "/":
            send_html(self, 200, render_home(self, config))
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

        if path == "/admin":
            send_html(self, 200, render_admin_page(config))
            return

        if path == "/api/bootstrap":
            respondent = get_or_create_respondent(self)
            survey_id = query.get("survey_id", [""])[0]
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_json(self, 200, bootstrap_payload(config, respondent, survey_id), headers)
            return

        if path == "/api/results":
            send_json(self, 200, result_payload(config))
            return

        if path == "/api/config":
            send_json(self, 200, {"ok": True, "config": config})
            return

        if path == "/api/export.csv":
            data = csv_export(config).encode("utf-8-sig")
            send_bytes(
                self,
                200,
                data,
                "text/csv; charset=utf-8",
                {"Content-Disposition": 'attachment; filename="oelverkostung-export.csv"'},
            )
            return

        error_response(self, 404, "Nicht gefunden.")

    def route_post(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        config = load_config()

        if path == "/api/response":
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            payload = read_json_body(self)
            send_json(self, 200, upsert_response(config, respondent, payload), headers)
            return

        if path == "/api/respondent":
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            payload = read_json_body(self)
            send_json(self, 200, update_respondent(respondent, payload), headers)
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
    actual_port = find_open_port(host, port)
    server = ThreadingHTTPServer((host, actual_port), OilSurveyHandler)
    origins = local_origins(actual_port)

    print("\nÖlverkostungs-Tool läuft.")
    print("Zum Verteilen im lokalen Netzwerk:")
    for survey in load_config()["surveys"]:
        print(f"  {survey.get('short_title', survey['id'])}: {origins[0]}/umfrage/{survey['id']}")
    print(f"  Ergebnisse: {origins[0]}/ergebnisse")
    print(f"  Setup:      {origins[0]}/admin")
    print("\nAlle gefundenen Adressen:")
    for origin in origins:
        print(f"  {origin}")
    print("\nBeenden mit Strg+C.\n")

    if open_browser:
        threading.Timer(0.75, lambda: webbrowser.open(f"http://localhost:{actual_port}/ergebnisse")).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer wird beendet.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lokales Umfragen-Tool für Ölverkostungen.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind-Adresse, Standard: 0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Start-Port, Standard: {DEFAULT_PORT}")
    parser.add_argument("--no-browser", action="store_true", help="Ergebnis-Seite nicht automatisch öffnen")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_server(args.host, args.port, not args.no_browser)
