from __future__ import annotations

import argparse
import html
import json
import math
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
TEXTS_PATH = ROOT / "ui_texts.json"
STATIC_DIR = ROOT / "static"
COOKIE_NAME = "oil_tasting_participant"
DEFAULT_PORT = 8000
UPDATE_LOCK = threading.Lock()
OIL_SELECTION_PASSWORD = "Erik"
RESULTS_PASSWORD = "Öl"


@dataclass
class Respondent:
    id: int
    token: str
    ip: str
    user_agent: str
    display_name: str | None
    publish_name: bool
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


def load_texts() -> dict[str, Any]:
    if not TEXTS_PATH.exists():
        return {}
    texts = load_json_file(TEXTS_PATH)
    return texts


def text_at(texts: dict[str, Any], path: tuple[str, ...], fallback: str = "") -> str:
    node: Any = texts
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return fallback
        node = node[key]
    return node if isinstance(node, str) else fallback


def dict_at(texts: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    node: Any = texts
    for key in path:
        if not isinstance(node, dict):
            return {}
        node = node.get(key)
    return node if isinstance(node, dict) else {}


def format_text(template: str, **values: Any) -> str:
    result = template
    for key, value in values.items():
        result = result.replace("{" + key + "}", str(value))
    return result


def route_text(texts: dict[str, Any], route: str, key: str, fallback: str = "") -> str:
    return text_at(texts, (route, key), fallback)


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
    texts = load_texts()
    max_price = max_actual_price(decryption)
    surveys = []
    for survey in config["surveys"]:
        item = dict(survey)
        survey_texts = dict_at(texts, ("/umfrage/:id", "surveys", str(survey["id"])))
        if survey_texts:
            for key in ("title", "short_title", "series_label"):
                if isinstance(survey_texts.get(key), str):
                    item[key] = survey_texts[key]
        fields = []
        for field in survey.get("fields", []):
            field_item = dict(field)
            field_texts = dict_at(survey_texts, ("fields", str(field["id"])))
            for key in ("label", "summary_label", "placeholder", "left_label", "mid_label", "right_label", "yes_value", "no_value"):
                if isinstance(field_texts.get(key), str):
                    field_item[key] = field_texts[key]
            if field_item.get("id") == "price_guess":
                minimum = field_item.get("min", 1)
                field_item["max"] = max_price
                field_item["right_label"] = f"{max_price} €"
                field_item["tick_min"] = 0
                field_item["default"] = minimum
            fields.append(field_item)
        item["fields"] = fields
        item["samples"] = survey_samples(config, decryption, survey)
        surveys.append(item)
    return {
        "event": config.get("event", {}),
        "oil_type_options": config.get("oil_type_options", []),
        "surveys": surveys,
    }


def max_actual_price(decryption: dict[str, Any]) -> int:
    prices = [
        as_float(oil.get("actual_price_per_liter_eur"))
        for oil in active_oils(decryption)
        if as_float(oil.get("actual_price_per_liter_eur")) is not None
    ]
    return max(5, int(math.ceil(max(prices) / 5) * 5)) if prices else 50


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
                "is_olive_oil": bool(oil.get("is_olive_oil", oil.get("type") == "Olivenöl")),
                "actual_price_per_liter_eur": oil.get("actual_price_per_liter_eur"),
                "price_source": oil.get("price_source"),
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


def required_price(value: Any) -> int:
    price = as_float(value)
    if price is None or price <= 0:
        raise ValueError("Preis pro Liter fehlt.")
    return max(1, round(price))


def add_oil(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    is_olive_oil = bool(payload.get("is_olive_oil"))
    oil_type = "Olivenöl" if is_olive_oil else "Nicht-Olivenöl"
    price = required_price(payload.get("actual_price_per_liter_eur"))
    if not name:
        raise ValueError("Ölname fehlt.")
    if oil_type not in config.get("oil_type_options", []):
        raise ValueError("Öl-Kategorie ist nicht erlaubt.")

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
            "is_olive_oil": is_olive_oil,
            "actual_price_per_liter_eur": price,
            "price_source": "Öl-Auswahl",
            "implemented": True,
            "ciphers": ciphers,
        }
    )
    save_decryption(config, decryption)
    return oil_selection_payload(config, decryption)


def update_oil(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    oil_id = str(payload.get("oil_id", ""))
    name = str(payload.get("name", "")).strip()
    price = required_price(payload.get("actual_price_per_liter_eur"))
    if not name:
        raise ValueError("Ölname fehlt.")
    oil = next((item for item in decryption["oils"] if item.get("id") == oil_id and item.get("implemented")), None)
    if not oil:
        raise ValueError("Öl nicht gefunden.")
    oil["name"] = name[:160]
    oil["actual_price_per_liter_eur"] = price
    oil["price_source"] = "Öl-Auswahl"
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


def require_results_password(value: Any) -> None:
    if value != RESULTS_PASSWORD:
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
                publish_name INTEGER NOT NULL DEFAULT 1,
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

            CREATE INDEX IF NOT EXISTS idx_respondents_display_name
                ON respondents(display_name COLLATE NOCASE, updated_at);

            CREATE INDEX IF NOT EXISTS idx_responses_updated
                ON survey_responses(updated_at);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(respondents)").fetchall()}
        if "publish_name" not in columns:
            db.execute("ALTER TABLE respondents ADD COLUMN publish_name INTEGER NOT NULL DEFAULT 1")
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_respondents_display_name
                ON respondents(display_name COLLATE NOCASE, updated_at)
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
                INSERT INTO respondents (token, ip, user_agent, publish_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token, ip, user_agent, 1, timestamp, timestamp),
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
        display_name=str(row["display_name"]) if row["display_name"] else None,
        publish_name=bool(row["publish_name"]) if "publish_name" in row.keys() else True,
        is_new_cookie=is_new_cookie,
    )


def participant_payload(respondent: Respondent) -> dict[str, Any]:
    return {
        "ok": True,
        "participant": {
            "display_name": respondent.display_name or "",
            "publish_name": respondent.publish_name if respondent.display_name else True,
        },
    }


def clean_display_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())[:80]


def save_participant(handler: BaseHTTPRequestHandler, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str] | None]:
    respondent = get_or_create_respondent(handler)
    display_name = clean_display_name(payload.get("display_name"))
    publish_name = bool(payload.get("publish_name"))
    timestamp = now_iso()

    with UPDATE_LOCK, connect_db() as db:
        target = None
        if display_name:
            target = db.execute(
                """
                SELECT * FROM respondents
                WHERE display_name = ? COLLATE NOCASE AND id != ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (display_name, respondent.id),
            ).fetchone()

        target_id = int(target["id"]) if target else respondent.id
        target_token = respondent.token

        if target and target_id != respondent.id:
            current_rows = db.execute(
                "SELECT * FROM survey_responses WHERE respondent_id = ?",
                (respondent.id,),
            ).fetchall()
            for current in current_rows:
                existing = db.execute(
                    """
                    SELECT updated_at
                    FROM survey_responses
                    WHERE respondent_id = ? AND survey_id = ? AND cipher = ?
                    """,
                    (target_id, current["survey_id"], current["cipher"]),
                ).fetchone()
                if existing is None or str(current["updated_at"]) >= str(existing["updated_at"]):
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
                            target_id,
                            current["survey_id"],
                            current["cipher"],
                            current["answers_json"],
                            current["created_at"],
                            current["updated_at"],
                        ),
                    )
            db.execute("DELETE FROM survey_responses WHERE respondent_id = ?", (respondent.id,))
            db.execute("DELETE FROM respondents WHERE id = ?", (respondent.id,))

        db.execute(
            """
            UPDATE respondents
            SET token = ?, ip = ?, user_agent = ?, display_name = ?, publish_name = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                target_token,
                respondent.ip,
                respondent.user_agent,
                display_name or None,
                1 if publish_name else 0,
                timestamp,
                target_id,
            ),
        )
        row = db.execute("SELECT * FROM respondents WHERE id = ?", (target_id,)).fetchone()

    updated = Respondent(
        id=int(row["id"]),
        token=str(row["token"]),
        ip=str(row["ip"]),
        user_agent=str(row["user_agent"]),
        display_name=str(row["display_name"]) if row["display_name"] else None,
        publish_name=bool(row["publish_name"]),
        is_new_cookie=False,
    )
    return participant_payload(updated), {"Set-Cookie": cookie_header(updated.token)}


def read_json_body(handler: BaseHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return None
    if length > 1_000_000:
        raise ValueError("Request ist zu groß.")
    raw = handler.rfile.read(length)
    charset = handler.headers.get_content_charset() or "utf-8"
    encodings = dict.fromkeys([charset, "utf-8-sig", "utf-8", "cp1252", "latin-1"])
    for encoding in encodings:
        try:
            return json.loads(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
        except LookupError:
            continue
    raise ValueError("Request-Body konnte nicht gelesen werden.")


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


def inline_json_script(name: str, payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    return f"<script>window.{name} = {encoded};</script>"


def page_shell(title: str, body: str, scripts: str = "", head_extra: str = "") -> str:
    escaped_title = html.escape(title)
    texts_script = inline_json_script("UI_TEXTS", load_texts())
    return f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#121417">
  <title>{escaped_title}</title>
  <link rel="stylesheet" href="/static/styles.css">
  {head_extra}
</head>
<body>
  {body}
  {texts_script}
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


def render_home(handler: BaseHTTPRequestHandler, config: dict[str, Any], decryption: dict[str, Any], respondent: Respondent) -> str:
    texts = load_texts()
    can_open_surveys = bool(respondent.display_name)
    publish_checked = respondent.publish_name if respondent.display_name else True
    survey_cards = []
    for survey in public_runtime_config(config, decryption)["surveys"]:
        href = f"/umfrage/{survey['id']}"
        link_class = "primary-link survey-entry-link" if can_open_surveys else "primary-link survey-entry-link locked-link"
        aria_disabled = "false" if can_open_surveys else "true"
        survey_cards.append(
            f"""
            <article class="link-card" style="--accent:{html.escape(survey.get('accent', '#277c61'))}">
              <div>
                <p class="eyebrow">{html.escape(survey.get('short_title', route_text(texts, '/', 'survey_fallback_eyebrow', 'Testreihe')))}</p>
                <h2>{html.escape(survey.get('title', survey['id']))}</h2>
              </div>
              <a class="{link_class}" href="{html.escape(href)}" aria-disabled="{aria_disabled}">{html.escape(text_at(texts, ('global', 'open_button'), 'Öffnen'))}</a>
            </article>
            """
        )

    page_title = route_text(texts, "/", "page_title", "Studie des Oliven-Symposiums")
    return page_shell(
        page_title,
        f"""
        <main id="home-app" class="page">
          <section class="topbar">
            <div>
              <h1>{html.escape(route_text(texts, '/', 'heading', page_title))}</h1>
            </div>
          </section>

          <section class="setup-editor participant-panel">
            <div class="participant-panel-heading">
              <h2>{html.escape(route_text(texts, '/', 'registration_title', 'Anmeldung'))}</h2>
              <div class="participant-info">
                <button
                  id="participant-info-button"
                  class="info-button"
                  type="button"
                  aria-expanded="false"
                  aria-label="{html.escape(route_text(texts, '/', 'participant_info_label', 'Hinweis zur Anmeldung'))}"
                >{html.escape(route_text(texts, '/', 'participant_info_button', 'i'))}</button>
                <div id="participant-info-popover" class="info-popover" role="status">
                  {html.escape(route_text(texts, '/', 'participant_info', ''))}
                </div>
              </div>
            </div>
            <div class="participant-form">
              <label class="participant-name-field">
                <input
                  id="participant-name"
                  type="text"
                  maxlength="80"
                  autocomplete="name"
                  aria-label="{html.escape(route_text(texts, '/', 'participant_name_label', 'Name'))}"
                  placeholder="{html.escape(route_text(texts, '/', 'participant_name_placeholder', 'Name eingeben'))}"
                >
              </label>
              <label class="check-option publish-option">
                <input id="participant-publish" type="checkbox" {"checked" if publish_checked else ""}>
                <span>{html.escape(route_text(texts, '/', 'publish_label', 'Name bei Aromaprofil-Kommentaren veröffentlichen'))}</span>
              </label>
            </div>
            <p class="notice" id="participant-state"> </p>
          </section>

          <section class="link-grid result-link-grid">
            <article class="link-card result-link-card" style="--accent:#f3f5f7;--accent-contrast:#111827;--accent-hover-contrast:#111827">
              <div>
                <p class="eyebrow">{html.escape(route_text(texts, '/', 'results_eyebrow', 'Live-Auswertung'))}</p>
                <h2>{html.escape(route_text(texts, '/', 'results_title', 'Ergebnisse'))}</h2>
              </div>
              <a class="primary-link" href="/ergebnisse">{html.escape(text_at(texts, ('global', 'open_button'), 'Öffnen'))}</a>
            </article>
          </section>

          <section class="link-grid survey-link-grid">
            {''.join(survey_cards)}
          </section>

          <section class="admin-link-section">
            <a class="ghost-button" href="/oel-auswahl">{html.escape(route_text(texts, '/', 'admin_link', 'Öl-Auswahl'))}</a>
          </section>
        </main>
        """,
        '<script src="/static/home.js" defer></script>',
    )


def render_survey_page(survey_id: str, config: dict[str, Any]) -> str:
    texts = load_texts()
    survey = survey_by_id(config, survey_id)
    if not survey:
        missing = route_text(texts, "/umfrage/:id", "missing", "Diese Umfrage gibt es nicht.")
        return page_shell("Nicht gefunden", f"<main class='page narrow'><h1>{html.escape(missing)}</h1></main>")

    survey_texts = dict_at(texts, ("/umfrage/:id", "surveys", survey_id))
    visible_title = survey_texts.get("short_title") or survey_texts.get("title") or survey.get("short_title") or survey.get("title") or survey_id
    title = f"{visible_title} · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        f"""
        <main id="survey-app" class="page survey-page">
          <div class="loading-panel">{html.escape(route_text(texts, "/umfrage/:id", "loading", "Umfrage wird geladen..."))}</div>
        </main>
        """,
        f"""
        <script>window.SURVEY_ID = {json.dumps(survey_id)};</script>
        <script src="/static/survey.js" defer></script>
        """,
    )


def render_results_page(config: dict[str, Any], mode: str = "rankings") -> str:
    texts = load_texts()
    route = "/einzelne-oel-wertungen" if mode == "oils" else "/ergebnisse"
    page_title = route_text(texts, route, "page_title", "Aufschlüsselung je Öl" if mode == "oils" else "Ergebnisse")
    title = f"{page_title} · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        f"""
        <main id="results-app" class="page results-page">
          <div class="loading-panel">{html.escape(route_text(texts, route, "loading", "Ergebnisse werden geladen..."))}</div>
        </main>
        """,
        f"""
        <script>window.RESULTS_MODE = {json.dumps(mode)};</script>
        <script src="/static/results.js" defer></script>
        """,
    )


def render_oil_selection_page(config: dict[str, Any]) -> str:
    texts = load_texts()
    page_title = route_text(texts, "/oel-auswahl", "page_title", "Öl-Auswahl")
    title = f"{page_title} · {config.get('event', {}).get('title', 'Oliven-Symposium')}"
    return page_shell(
        title,
        f"""
        <main id="oil-selection-app" class="page oil-selection-page">
          <div class="loading-panel">{html.escape(route_text(texts, "/oel-auswahl", "loading", "Öl-Auswahl wird geladen..."))}</div>
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
        "respondent": {
            "display_name": respondent.display_name or "",
            "publish_name": respondent.publish_name,
        },
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
    if not respondent.display_name:
        raise ValueError("Bitte zuerst einen Namen auf der Startseite speichern.")

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


def olive_oil_flag(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = normalize_oil_type(value)
    if normalized in {"olivenöl", "ja", "yes", "true", "1"}:
        return True
    if normalized in {"nichtolivenöl", "nein", "no", "false", "0", "rapsöl", "sesamöl"}:
        return False
    return None


def oil_is_olive_oil(oil: dict[str, Any]) -> bool:
    if "is_olive_oil" in oil:
        return bool(oil.get("is_olive_oil"))
    return normalize_oil_type(oil.get("type", "")) == "olivenöl"


def guess_matches_oil(guess: Any, oil: dict[str, Any]) -> bool:
    guessed_olive = olive_oil_flag(guess)
    if guessed_olive is not None:
        return guessed_olive == oil_is_olive_oil(oil)
    return normalize_oil_type(guess) == normalize_oil_type(oil.get("type", ""))


def rank_sort_key(
    oil_id: str,
    value: float,
    reverse: bool,
    distributions: dict[str, list[float]] | None = None,
) -> tuple[float, float, float, str]:
    samples = (distributions or {}).get(oil_id, [])
    med = median(samples)
    spread = population_stdev(samples)
    oriented_value = -value if reverse else value
    oriented_median = -(med if med is not None else value) if reverse else (med if med is not None else value)
    return (oriented_value, oriented_median, spread if spread is not None else 0, oil_id)


def rank_map(
    values: dict[str, float | None],
    reverse: bool = True,
    distributions: dict[str, list[float]] | None = None,
) -> dict[str, int | None]:
    ranked = sorted(
        ((oil_id, value) for oil_id, value in values.items() if value is not None),
        key=lambda item: rank_sort_key(item[0], item[1], reverse, distributions),
    )
    ranks: dict[str, int | None] = {oil_id: None for oil_id in values}
    previous_key: tuple[float, float, float] | None = None
    previous_rank = 0
    for index, (oil_id, value) in enumerate(ranked, start=1):
        current_key = rank_sort_key(oil_id, value, reverse, distributions)[:3]
        if previous_key is not None and current_key == previous_key:
            rank = previous_rank
        else:
            rank = index
            previous_rank = rank
            previous_key = current_key
        ranks[oil_id] = rank
    return ranks


def stat_block(values: list[float], rank: int | None = None) -> dict[str, Any]:
    avg = average(values)
    return {
        "avg": round(avg, 2) if avg is not None else None,
        "count": len(values),
        "rank": rank,
    }


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def box_plot(values: list[float]) -> dict[str, Any] | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    lower = ordered[:middle]
    upper = ordered[middle + 1 :] if len(ordered) % 2 else ordered[middle:]
    q1 = median(lower) if lower else ordered[0]
    q3 = median(upper) if upper else ordered[-1]
    med = median(ordered)
    avg = average(ordered)
    return {
        "min": round(ordered[0], 2),
        "q1": round(q1, 2) if q1 is not None else None,
        "median": round(med, 2) if med is not None else None,
        "avg": round(avg, 2) if avg is not None else None,
        "q3": round(q3, 2) if q3 is not None else None,
        "max": round(ordered[-1], 2),
        "count": len(ordered),
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
    color: str | None = None,
    distributions: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    oil_lookup = slug_lookup(oils)
    ordered = sorted(
        [
            {
                "oil_id": oil_id,
                "name": oil_lookup[oil_id]["name"],
                "value": round(value, 2) if value is not None else None,
                "rank": ranks.get(oil_id),
                "box": box_plot((distributions or {}).get(oil_id, [])),
            }
            for oil_id, value in values.items()
            if value is not None and oil_id in oil_lookup
        ],
        key=lambda item: item["rank"] or 999,
        reverse=False,
    )
    if not reverse:
        ordered = sorted(ordered, key=lambda item: item["rank"] or 999)
    return {"key": key or slugify(title), "title": title, "subtitle": subtitle, "unit": unit, "color": color, "items": ordered}


def result_payload(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    texts = load_texts()
    ranking_texts = dict_at(texts, ("/ergebnisse", "rankings"))
    no_comment_value = text_at(texts, ("/umfrage/:id", "no_comment_value"), "kein Kommentar").casefold()
    oils = active_oils(decryption)
    oil_order = [oil["id"] for oil in oils]
    oil_lookup = slug_lookup(oils)
    surveys = public_runtime_config(config, decryption)["surveys"]
    survey_lookup = slug_lookup(surveys)
    survey_numbers = {survey["id"]: index + 1 for index, survey in enumerate(surveys)}
    comment_series_labels = {
        survey["id"]: survey.get("series_label") or survey.get("short_title") or survey.get("title") or f"Testreihe {survey_numbers.get(survey['id'], '?')}"
        for survey in surveys
    }
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
            "overall_by_respondent": {},
            "bitter": [],
            "price_guess": [],
            "price_deviation": [],
            "price_deviation_percent": [],
            "guess_correct": 0,
            "guess_total": 0,
            "response_count": 0,
            "comments": [],
        }

    with connect_db() as db:
        response_rows = db.execute(
            """
            SELECT sr.*, r.display_name, r.publish_name
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
            oil_stats[oil_id]["overall_by_respondent"].setdefault(int(row["respondent_id"]), []).append(overall)

        bitter = as_float(answers.get("bitter"))
        if bitter is not None and "bitter" in field_lookup.get(survey_id, {}):
            oil_stats[oil_id]["bitter"].append(bitter)

        price_guess = as_float(answers.get("price_guess"))
        if price_guess is not None and "price_guess" in field_lookup.get(survey_id, {}):
            oil_stats[oil_id]["price_guess"].append(price_guess)
            actual_price = as_float(oil.get("actual_price_per_liter_eur"))
            if actual_price is not None:
                deviation = price_guess - actual_price
                oil_stats[oil_id]["price_deviation"].append(deviation)
                if actual_price > 0:
                    oil_stats[oil_id]["price_deviation_percent"].append((deviation / actual_price) * 100)

        guess = answers.get("oil_guess")
        if guess:
            oil_stats[oil_id]["guess_total"] += 1
            if guess_matches_oil(guess, oil):
                oil_stats[oil_id]["guess_correct"] += 1

        comment = str(answers.get("aroma_profile") or "").strip()
        if comment and comment.casefold() != no_comment_value:
            oil_stats[oil_id]["comments"].append(
                {
                    "survey_id": survey_id,
                    "survey_title": survey.get("short_title", survey.get("title", survey_id)),
                    "series_label": comment_series_labels.get(survey_id, f"Testreihe {survey_numbers.get(survey_id, '?')}"),
                    "cipher": cipher,
                    "author": str(row["display_name"] or "").strip() if row["publish_name"] else "",
                    "text": comment,
                    "updated_at": row["updated_at"],
                }
            )

    overall_distributions = {oil_id: oil_stats[oil_id]["overall"] for oil_id in oil_order}
    overall_values = {oil_id: average(overall_distributions[oil_id]) for oil_id in oil_order}
    overall_ranks = rank_map(overall_values, reverse=True, distributions=overall_distributions)
    spread_values = {oil_id: population_stdev(oil_stats[oil_id]["overall"]) for oil_id in oil_order}
    spread_ranks = rank_map(spread_values, reverse=False, distributions=overall_distributions)
    own_spread_values: dict[str, float | None] = {}
    own_spread_distributions: dict[str, list[float]] = {}
    own_spread_counts: dict[str, int] = {}
    for oil_id in oil_order:
        own_spreads = []
        for values in oil_stats[oil_id]["overall_by_respondent"].values():
            spread = population_stdev(values)
            if spread is not None:
                own_spreads.append(spread)
        own_spread_values[oil_id] = average(own_spreads)
        own_spread_distributions[oil_id] = own_spreads
        own_spread_counts[oil_id] = len(own_spreads)
    own_spread_ranks = rank_map(own_spread_values, reverse=False, distributions=own_spread_distributions)
    bitter_values = {oil_id: average(oil_stats[oil_id]["bitter"]) for oil_id in oil_order}
    bitter_distributions = {oil_id: oil_stats[oil_id]["bitter"] for oil_id in oil_order}
    bitter_ranks = rank_map(bitter_values, reverse=False, distributions=bitter_distributions)
    price_guess_values = {oil_id: average(oil_stats[oil_id]["price_guess"]) for oil_id in oil_order}
    price_guess_distributions = {oil_id: oil_stats[oil_id]["price_guess"] for oil_id in oil_order}
    price_guess_ranks = rank_map(price_guess_values, reverse=True, distributions=price_guess_distributions)
    price_deviation_values = {oil_id: average(oil_stats[oil_id]["price_deviation"]) for oil_id in oil_order}
    price_deviation_distributions = {oil_id: oil_stats[oil_id]["price_deviation"] for oil_id in oil_order}
    price_deviation_percent_values = {oil_id: average(oil_stats[oil_id]["price_deviation_percent"]) for oil_id in oil_order}
    price_deviation_percent_distributions = {oil_id: oil_stats[oil_id]["price_deviation_percent"] for oil_id in oil_order}
    price_deviation_ranks = rank_map(
        price_deviation_percent_values,
        reverse=True,
        distributions=price_deviation_percent_distributions,
    )
    accuracy_values = {
        oil_id: (
            oil_stats[oil_id]["guess_correct"] / oil_stats[oil_id]["guess_total"]
            if oil_stats[oil_id]["guess_total"]
            else None
        )
        for oil_id in oil_order
    }
    accuracy_ranks = rank_map(accuracy_values, reverse=False)

    overall_by_survey_values: dict[str, dict[str, float | None]] = {}
    overall_by_survey_ranks: dict[str, dict[str, int | None]] = {}
    for survey in surveys:
        survey_id = survey["id"]
        distributions = {oil_id: oil_stats[oil_id]["overall_by_survey"][survey_id] for oil_id in oil_order}
        values = {oil_id: average(distributions[oil_id]) for oil_id in oil_order}
        overall_by_survey_values[survey_id] = values
        overall_by_survey_ranks[survey_id] = rank_map(values, reverse=True, distributions=distributions)

    rankings = []
    for survey in surveys:
        survey_id = survey["id"]
        series = comment_series_labels.get(survey_id, f"Testreihe {survey_numbers.get(survey_id, '?')}")
        rankings.append(
            ranking_payload(
                format_text(ranking_texts.get("overall_survey_title", "Gesamteindruck: {series}"), series=series),
                overall_by_survey_values[survey_id],
                oils,
                overall_by_survey_ranks[survey_id],
                "Punkte",
                survey.get("short_title", survey["title"]),
                key=f"overall_{survey_id}",
                color=survey.get("accent"),
                distributions={
                    oil_id: oil_stats[oil_id]["overall_by_survey"][survey_id]
                    for oil_id in oil_order
                },
            )
        )
    rankings.append(
        ranking_payload(
            ranking_texts.get("overall_all_title", "Gesamteindruck gesamt"),
            overall_values,
            oils,
            overall_ranks,
            "Punkte",
            ranking_texts.get("overall_all_subtitle", "Mittel über alle Gesamteindrücke"),
            key="overall_all",
            color="var(--overall-ranking-color)",
            distributions=overall_distributions,
        )
    )
    price_deviation_ranking = ranking_payload(
        ranking_texts.get("price_deviation_title", "Abweichung vom realen Preis"),
        price_deviation_percent_values,
        oils,
        price_deviation_ranks,
        "%±",
        ranking_texts.get("price_deviation_subtitle", "höchste Überschätzung zuerst"),
        key="price_deviation",
        distributions=price_deviation_percent_distributions,
    )
    price_domain_max = max_actual_price(decryption)
    price_deviation_ranking["graph"] = "price_deviation"
    price_scatter_values = [price_domain_max]
    for item in price_deviation_ranking["items"]:
        actual = as_float(oil_lookup[item["oil_id"]].get("actual_price_per_liter_eur"))
        guess_avg = price_guess_values.get(item["oil_id"])
        item["actual_price_per_liter_eur"] = round(actual, 2) if actual is not None else None
        item["price_guess_avg"] = round(guess_avg, 2) if guess_avg is not None else None
        deviation = price_deviation_values.get(item["oil_id"])
        item["price_deviation_eur"] = round(deviation, 2) if deviation is not None else None
        percent = price_deviation_percent_values.get(item["oil_id"])
        item["price_deviation_percent"] = round(percent, 2) if percent is not None else None
        if actual is not None:
            price_scatter_values.append(actual)
        if guess_avg is not None:
            price_scatter_values.append(guess_avg)

    price_scatter_max = max(5, int(math.ceil(max(price_scatter_values) / 5) * 5)) if price_scatter_values else price_domain_max
    price_deviation_ranking["price_domain"] = {"min": 0, "max": price_scatter_max}
    price_scatter_points = []
    for oil in oils:
        oil_id = oil["id"]
        actual = as_float(oil.get("actual_price_per_liter_eur"))
        guess_avg = price_guess_values.get(oil_id)
        if actual is None or actual <= 0 or guess_avg is None:
            continue
        price_scatter_points.append(
            {
                "oil_id": oil_id,
                "name": oil["name"],
                "actual_price_per_liter_eur": round(actual, 2),
                "price_guess_avg": round(guess_avg, 2),
                "price_deviation": round(guess_avg - actual, 2),
                "price_deviation_percent": round(((guess_avg - actual) / actual) * 100, 2),
                "rank": price_deviation_ranks.get(oil_id),
            }
        )

    rankings.extend(
        [
            ranking_payload(
                ranking_texts.get("spread_title", "Streuung"),
                spread_values,
                oils,
                spread_ranks,
                "σ",
                ranking_texts.get("spread_subtitle", "niedrigste Streuung im Gesamteindruck zuerst"),
                key="spread",
                distributions={oil_id: oil_stats[oil_id]["overall"] for oil_id in oil_order},
            ),
            ranking_payload(
                ranking_texts.get("own_spread_title", "individuelle Streuung"),
                own_spread_values,
                oils,
                own_spread_ranks,
                "Zahl",
                ranking_texts.get("own_spread_subtitle", "niedrigste Abweichung desselben Probanden über Testreihen zuerst"),
                key="own_spread",
                distributions=own_spread_distributions,
            ),
            ranking_payload(
                ranking_texts.get("accuracy_title", "Trefferquote"),
                accuracy_values,
                oils,
                accuracy_ranks,
                "%",
                ranking_texts.get("accuracy_subtitle", "niedrigste Quote zuerst"),
                key="guess_accuracy",
            ),
            ranking_payload(
                ranking_texts.get("bitter_title", "Bitterkeit"),
                bitter_values,
                oils,
                bitter_ranks,
                "Punkte",
                ranking_texts.get("bitter_subtitle", "nicht bitter zuerst"),
                key="bitter",
                distributions=bitter_distributions,
            ),
            ranking_payload(
                ranking_texts.get("price_guess_title", "Geschätzter Preis"),
                price_guess_values,
                oils,
                price_guess_ranks,
                "€",
                ranking_texts.get("price_guess_subtitle", "höchste Preisschätzung pro Liter zuerst"),
                key="price_guess",
                distributions=price_guess_distributions,
            ),
            price_deviation_ranking,
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
                "is_olive_oil": oil_is_olive_oil(oil),
                "actual_price_per_liter_eur": oil.get("actual_price_per_liter_eur"),
                "price_source": oil.get("price_source"),
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
                "price_guess": stat_block(stat["price_guess"], price_guess_ranks.get(oil_id)),
                "price_deviation": {
                    **stat_block(stat["price_deviation_percent"], price_deviation_ranks.get(oil_id)),
                    "eur_avg": round(price_deviation_values[oil_id], 2) if price_deviation_values[oil_id] is not None else None,
                },
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
        "price_scatter": {
            "domain": {"min": 0, "max": price_scatter_max},
            "points": price_scatter_points,
        },
        "oils": oil_payload,
        "server_time": now_iso(),
    }


class OilSurveyHandler(BaseHTTPRequestHandler):
    server_version = "OilSurvey/2.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write("- - [%s] %s\n" % (self.log_date_time_string(), format % args))

    def do_GET(self) -> None:
        try:
            self.route_get()
        except ValueError as exc:
            error_response(self, 400, str(exc))
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
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_html(self, 200, render_home(self, config, decryption, respondent), headers)
            return

        if path.startswith("/static/"):
            self.serve_static(path)
            return

        if path.startswith("/umfrage/"):
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            if not respondent.display_name:
                send_html(self, 200, render_home(self, config, decryption, respondent), headers)
                return
            survey_id = path.rsplit("/", 1)[-1]
            send_html(self, 200, render_survey_page(survey_id, config), headers)
            return

        if path == "/ergebnisse":
            send_html(self, 200, render_results_page(config))
            return

        if path == "/einzelne-oel-wertungen":
            send_html(self, 200, render_results_page(config, "oils"))
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

        if path == "/api/participant":
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_json(self, 200, participant_payload(respondent), headers)
            return

        if path == "/api/results":
            require_results_password(query.get("password", [""])[0])
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

        if path == "/api/oils/update":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, update_oil(config, decryption, payload))
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

        if path == "/api/participant":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            body, headers = save_participant(self, payload)
            send_json(self, 200, body, headers)
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
    origin = f"http://localhost:{actual_port}"

    print("\nOliven-Symposium läuft.")
    print("Seiten:")
    for survey in public_runtime_config(config, decryption)["surveys"]:
        print(f"  {survey.get('short_title', survey['id'])}: {origin}/umfrage/{survey['id']}")
    print(f"  Startseite: {origin}/")
    print(f"  Ergebnisse: {origin}/ergebnisse")
    print(f"  Aufschlüsselung je Öl: {origin}/einzelne-oel-wertungen")
    print(f"  Öl-Auswahl: {origin}/oel-auswahl")
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
