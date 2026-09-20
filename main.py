from __future__ import annotations

import argparse
import hashlib
import html
import hmac
import json
import math
import mimetypes
import os
import random
import re
import secrets
import socket
import sqlite3
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
PINS_PATH = Path(os.environ.get("UMFRAGEN_PINS", str(ROOT / "Oliven-Symposium-Momentaufnahme-PINs.txt")))
COOKIE_NAME = "oil_tasting_participant"
DEFAULT_PORT = 8000
UPDATE_LOCK = threading.RLock()
DEFAULT_OIL_SLOT_COUNT = 24
OIL_SELECTION_PASSWORD = "Erik"
EVENT_MODE_PREPARATION = "preparation"
EVENT_MODE_EXECUTION = "execution"
EVENT_MODE_EVALUATION = "evaluation"
EVENT_MODES = {EVENT_MODE_PREPARATION, EVENT_MODE_EXECUTION, EVENT_MODE_EVALUATION}
PIN_HASH_ITERATIONS = 160_000


class ClosingSQLiteConnection(sqlite3.Connection):
    """SQLite-Kontextmanager, der nach Commit/Rollback auch wirklich schließt."""

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> bool:
        try:
            return bool(super().__exit__(exc_type, exc_value, traceback))
        finally:
            self.close()


DUMMY_COMMENTS = [
    "frisch und klar im Auftakt",
    "mild mit kurzem Nachklang",
    "grasig und leicht herb",
    "rund und angenehm ausgewogen",
    "etwas flach, aber sauber",
    "fruchtig mit pfeffriger Spitze",
    "zurückhaltend und weich",
    "markant bitter im Finale",
    "nussig und warm",
    "grün, frisch und lebendig",
    "leichte Schärfe am Ende",
    "wirkt reif und voll",
    "sanft, fast cremig",
    "kräutrig und trocken",
    "fruchtig, aber nicht laut",
    "leicht metallischer Eindruck",
    "duftet frisch geschnitten",
    "schmeckt solide und direkt",
    "breit und etwas schwer",
    "angenehm pikant",
    "zart süßlicher Eindruck",
    "stark kräuterbetont",
    "eher neutral gehalten",
    "sehr weicher Gesamteindruck",
    "bitterer als erwartet",
    "klarer Olivencharakter",
    "wirkt jung und grün",
    "kurzer, sauberer Abgang",
    "leichte Mandelnoten",
    "würzig und präsent",
    "wenig Tiefe, aber harmonisch",
    "kräftig im Nachhall",
    "dezente Fruchtigkeit",
    "etwas stumpf auf der Zunge",
    "frisch, aber schnell weg",
    "angenehme Balance",
    "dominante Schärfe",
    "mild und unkompliziert",
    "sauberer, grüner Duft",
    "füllig und rund",
    "leicht kratzig im Abgang",
    "aromatisch und hell",
    "wirkt recht hochwertig",
    "eher alltäglich",
    "fein bitter, nicht störend",
    "deutlich grasige Note",
    "fruchtig mit Tiefe",
    "trocken und herb",
    "neutraler Geruch",
    "samtig und weich",
    "leicht unreifer Eindruck",
    "angenehm frisch",
    "etwas ölig und schwer",
    "pfeffrig, aber ausgewogen",
    "kurze grüne Spitze",
    "mild, fast süß",
    "deutlich würzig",
    "sauber, aber wenig komplex",
    "frischer Kräuterton",
    "kräftige Bitterkeit",
    "runder Nachgeschmack",
    "leichter Apfelton",
    "wirkt sehr natürlich",
    "etwas dumpf",
    "elegant und zurückhaltend",
    "klare Schärfe",
    "weiches Mundgefühl",
    "kräftig grün",
    "zarte Nussigkeit",
    "flacher Mittelteil",
    "schöne Frische",
    "bisschen zu bitter",
    "aromatisch dicht",
    "milder Start, würziges Ende",
    "grüne Tomatennote",
    "ausgewogen und sauber",
    "leicht rau im Finale",
    "fruchtiger Duft",
    "recht neutraler Geschmack",
    "pfeffriger Nachhall",
    "sanfte Kräuternote",
    "voll und rund",
    "etwas künstlicher Eindruck",
    "frisch und herb",
    "angenehm nussig",
    "starkes Aroma",
    "dezent und sauber",
    "kräftige grüne Frucht",
    "wenig Schärfe",
    "ausdrucksstark, aber harmonisch",
    "leicht säuerlicher Eindruck",
    "mildes Alltagsöl",
    "markanter Geruch",
    "langer Nachklang",
    "eher streng",
    "fruchtig und pfeffrig",
    "sanfter Geruch",
    "viel Bitterkeit",
    "klar und frisch",
    "schwer einzuordnen",
]


@dataclass
class Respondent:
    id: int
    token: str
    ip: str
    user_agent: str
    display_name: str | None
    publish_name: bool
    publish_competitive_name: bool
    is_participant: bool
    is_new_cookie: bool


def event_mode(db: sqlite3.Connection | None = None) -> str:
    own_connection = db is None
    connection = db or connect_db()
    try:
        row = connection.execute("SELECT value FROM event_settings WHERE key = 'mode'").fetchone()
        if row and str(row["value"]) in EVENT_MODES:
            return str(row["value"])

        # Bestehende Datenbanken hatten nur den booleschen Schalter `finished`.
        legacy = connection.execute("SELECT value FROM event_settings WHERE key = 'finished'").fetchone()
        if legacy:
            return EVENT_MODE_EVALUATION if str(legacy["value"]) == "1" else EVENT_MODE_EXECUTION
        return EVENT_MODE_PREPARATION
    finally:
        if own_connection:
            connection.close()


def event_is_finished(db: sqlite3.Connection | None = None) -> bool:
    return event_mode(db) == EVENT_MODE_EVALUATION


def set_event_mode(mode: str) -> None:
    normalized = str(mode or "").strip().lower()
    if normalized not in EVENT_MODES:
        raise ValueError("Unbekannter Veranstaltungsmodus.")
    with UPDATE_LOCK, connect_db() as db:
        db.execute(
            """
            INSERT INTO event_settings (key, value, updated_at)
            VALUES ('mode', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (normalized, now_iso()),
        )
        # Der alte Wert bleibt für ältere Snapshots und Werkzeuge synchron.
        db.execute(
            """
            INSERT INTO event_settings (key, value, updated_at)
            VALUES ('finished', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            ("1" if normalized == EVENT_MODE_EVALUATION else "0", now_iso()),
        )


def set_event_finished(finished: bool) -> None:
    """Kompatibilität für ältere Aufrufer des früheren Zwei-Phasen-Schalters."""
    set_event_mode(EVENT_MODE_EVALUATION if finished else EVENT_MODE_EXECUTION)


def require_event_mode(required: str, message: str) -> None:
    if event_mode() != required:
        raise ValueError(message)


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
    source = load_json_file(DECRYPTION_PATH)
    validate_cipher_sets(config, source)
    with UPDATE_LOCK, connect_db() as db:
        ensure_database_schema(db)
        migrate_legacy_oils(db, config, source)
        oils = load_oils_from_db(db, config)
    decryption = {
        "note": source.get("note", ""),
        "cipher_sets": source["cipher_sets"],
        "oils": oils,
    }
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


def validate_cipher_sets(config: dict[str, Any], decryption: dict[str, Any]) -> None:
    cipher_sets = decryption.get("cipher_sets")
    if not isinstance(cipher_sets, dict):
        raise ValueError("decryption.json braucht 'cipher_sets'.")

    for survey in config["surveys"]:
        cipher_set = survey["cipher_set"]
        allowed = cipher_sets.get(cipher_set)
        if not isinstance(allowed, list) or len(allowed) != DEFAULT_OIL_SLOT_COUNT:
            raise ValueError(f"cipher_set '{cipher_set}' braucht {DEFAULT_OIL_SLOT_COUNT} Einträge.")


def validate_decryption(config: dict[str, Any], decryption: dict[str, Any]) -> None:
    validate_cipher_sets(config, decryption)
    oils = decryption.get("oils")
    if not isinstance(oils, list) or len(oils) != DEFAULT_OIL_SLOT_COUNT:
        raise ValueError(f"Die Datenbank braucht genau {DEFAULT_OIL_SLOT_COUNT} Öl-/Platzhalter-Einträge.")

    oil_ids = {oil.get("id") for oil in oils}
    if len(oil_ids) != len(oils):
        raise ValueError("Öl-IDs in der Datenbank müssen eindeutig sein.")

    cipher_sets = decryption["cipher_sets"]

    for survey in config["surveys"]:
        survey_id = survey["id"]
        cipher_set = survey["cipher_set"]
        allowed = cipher_sets[cipher_set]
        seen: set[str] = set()
        for oil in oils:
            cipher = oil.get("ciphers", {}).get(survey_id)
            if not cipher:
                raise ValueError(f"Öl-Slot '{oil.get('id')}' braucht eine Chiffre für '{survey_id}'.")
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


def active_oils(decryption: dict[str, Any]) -> list[dict[str, Any]]:
    return [oil for oil in decryption["oils"] if oil.get("implemented") is True]


def generated_placeholder_oils(config: dict[str, Any], decryption: dict[str, Any]) -> list[dict[str, Any]]:
    cipher_sets = decryption["cipher_sets"]
    oils = []
    for index in range(DEFAULT_OIL_SLOT_COUNT):
        ciphers = {}
        for survey in config["surveys"]:
            allowed = cipher_sets[survey["cipher_set"]]
            ciphers[survey["id"]] = allowed[index]
        oils.append(
            {
                "slot_index": index,
                "id": f"platzhalter-{index + 1:02d}",
                "name": f"Platzhalter {index + 1:02d}",
                "type": "Platzhalter",
                "implemented": False,
                "ciphers": ciphers,
            }
        )
    return oils


def normalize_oil_row(slot_index: int, oil: dict[str, Any]) -> dict[str, Any]:
    implemented = bool(oil.get("implemented"))
    return {
        "slot_index": slot_index,
        "id": str(oil.get("id") or f"platzhalter-{slot_index + 1:02d}")[:180],
        "name": str(oil.get("name") or f"Platzhalter {slot_index + 1:02d}")[:160],
        "type": str(oil.get("type") or ("Olivenöl" if oil.get("is_olive_oil") else "Platzhalter"))[:80],
        "is_olive_oil": bool(oil.get("is_olive_oil", oil.get("type") == "Olivenöl")),
        "actual_price_per_liter_eur": as_float(oil.get("actual_price_per_liter_eur")),
        "price_source": str(oil.get("price_source") or "")[:500] or None,
        "baseline": bool(oil.get("baseline")),
        "implemented": implemented,
        "brought_by_respondent_id": as_int(oil.get("brought_by_respondent_id")),
        "submitted_by_respondent_id": as_int(oil.get("submitted_by_respondent_id")),
        "ciphers": dict(oil.get("ciphers") or {}),
    }


def load_oils_from_db(db: sqlite3.Connection, config: dict[str, Any]) -> list[dict[str, Any]]:
    rows = db.execute("SELECT * FROM oils ORDER BY slot_index").fetchall()
    owner_rows = db.execute(
        """
        SELECT oo.slot_index, oo.respondent_id, r.display_name
        FROM oil_owners oo
        JOIN respondents r ON r.id = oo.respondent_id
        ORDER BY oo.slot_index, oo.position, r.display_name COLLATE NOCASE
        """
    ).fetchall()
    owners_by_slot: dict[int, list[dict[str, Any]]] = {}
    for row in owner_rows:
        owners_by_slot.setdefault(int(row["slot_index"]), []).append(
            {
                "id": int(row["respondent_id"]),
                "display_name": str(row["display_name"] or ""),
            }
        )
    cipher_rows = db.execute(
        """
        SELECT slot_index, survey_id, cipher
        FROM oil_ciphers
        ORDER BY slot_index, survey_id
        """
    ).fetchall()
    ciphers_by_slot: dict[int, dict[str, str]] = {}
    for row in cipher_rows:
        ciphers_by_slot.setdefault(int(row["slot_index"]), {})[str(row["survey_id"])] = str(row["cipher"])

    oils = []
    for row in rows:
        owners = owners_by_slot.get(int(row["slot_index"]), [])
        owner_id = owners[0]["id"] if owners else row["brought_by_respondent_id"]
        owner_names = [owner["display_name"] for owner in owners if owner["display_name"]]
        oils.append(
            {
                "slot_index": int(row["slot_index"]),
                "id": str(row["id"]),
                "name": str(row["name"]),
                "type": str(row["type"]),
                "is_olive_oil": bool(row["is_olive_oil"]),
                "actual_price_per_liter_eur": row["actual_price_per_liter_eur"],
                "price_source": row["price_source"],
                "baseline": bool(row["baseline"]),
                "implemented": bool(row["implemented"]),
                "brought_by_respondent_id": int(owner_id) if owner_id is not None else None,
                "brought_by_name": " & ".join(owner_names),
                "brought_by_names": owner_names,
                "owner_ids": [owner["id"] for owner in owners],
                "owners": owners,
                "submitted_by_respondent_id": (
                    int(row["submitted_by_respondent_id"])
                    if "submitted_by_respondent_id" in row.keys() and row["submitted_by_respondent_id"] is not None
                    else None
                ),
                "ciphers": {
                    survey["id"]: ciphers_by_slot.get(int(row["slot_index"]), {}).get(survey["id"], "")
                    for survey in config["surveys"]
                },
            }
        )
    return oils


def survey_by_id(config: dict[str, Any], survey_id: str) -> dict[str, Any] | None:
    return next((survey for survey in config["surveys"] if survey["id"] == survey_id), None)


def survey_samples(config: dict[str, Any], decryption: dict[str, Any], survey: dict[str, Any]) -> list[dict[str, str]]:
    order = decryption["cipher_sets"][survey["cipher_set"]]
    order_index = {cipher: index for index, cipher in enumerate(order)}
    finished = event_is_finished()
    samples = [
        {
            "cipher": oil["ciphers"][survey["id"]],
            **({"oil_name": str(oil.get("name") or "")} if finished else {}),
        }
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
        "event_mode": event_mode(),
        "event_finished": event_is_finished(),
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


def participant_admin_rows(db: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    own_connection = db is None
    connection = db or connect_db()
    try:
        rows = connection.execute(
            """
            SELECT
                r.id,
                r.display_name,
                r.publish_name,
                r.publish_competitive_name,
                r.is_participant,
                r.pin_hash,
                r.pin_reset_required,
                COUNT(sr.survey_id) AS response_count
            FROM respondents r
            LEFT JOIN survey_responses sr ON sr.respondent_id = r.id
            WHERE r.display_name IS NOT NULL AND TRIM(r.display_name) != ''
            GROUP BY r.id
            ORDER BY r.display_name COLLATE NOCASE
            """
        ).fetchall()
        default_pins = load_default_pins()
        return [
            {
                "id": int(row["id"]),
                "display_name": str(row["display_name"] or ""),
                "publish_name": bool(row["publish_name"]),
                "publish_competitive_name": bool(row["publish_competitive_name"]),
                "is_participant": bool(row["is_participant"]),
                "response_count": int(row["response_count"] or 0),
                "pin_status": participant_pin_status(row, default_pins),
            }
            for row in rows
        ]
    finally:
        if own_connection:
            connection.close()


def participant_name_lookup(db: sqlite3.Connection | None = None) -> dict[str, str]:
    return {str(item["id"]): item["display_name"] for item in participant_admin_rows(db)}


def require_existing_participant(db: sqlite3.Connection, participant_id: Any) -> int | None:
    normalized_id = as_int(participant_id)
    if normalized_id is None:
        return None
    row = db.execute(
        """
        SELECT id
        FROM respondents
        WHERE id = ? AND display_name IS NOT NULL AND TRIM(display_name) != ''
        """,
        (normalized_id,),
    ).fetchone()
    if row is None:
        raise ValueError("Proband nicht gefunden.")
    return normalized_id


def owner_ids_from_payload(payload: dict[str, Any]) -> list[int]:
    raw_ids = payload.get("owner_ids")
    if not isinstance(raw_ids, list):
        raw_ids = [payload.get("brought_by_respondent_id")]
    owner_ids: list[int] = []
    for value in raw_ids:
        normalized = as_int(value)
        if normalized is not None and normalized not in owner_ids:
            owner_ids.append(normalized)
    return owner_ids[:24]


def require_existing_participants(db: sqlite3.Connection, participant_ids: list[int]) -> list[int]:
    validated: list[int] = []
    for participant_id in participant_ids:
        existing = require_existing_participant(db, participant_id)
        if existing is not None:
            validated.append(existing)
    return validated


def replace_oil_owners(db: sqlite3.Connection, slot_index: int, owner_ids: list[int]) -> None:
    db.execute("DELETE FROM oil_owners WHERE slot_index = ?", (slot_index,))
    timestamp = now_iso()
    for position, participant_id in enumerate(owner_ids):
        db.execute(
            """
            INSERT INTO oil_owners (slot_index, respondent_id, position, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (slot_index, participant_id, position, timestamp),
        )
    db.execute(
        "UPDATE oils SET brought_by_respondent_id = ? WHERE slot_index = ?",
        (owner_ids[0] if owner_ids else None, slot_index),
    )


def oil_selection_payload(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    counts = oil_response_counts(config, decryption)
    with connect_db() as db:
        participants = participant_admin_rows(db)
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
                "brought_by_respondent_id": oil.get("brought_by_respondent_id"),
                "brought_by_name": oil.get("brought_by_name", ""),
                "brought_by_names": oil.get("brought_by_names", []),
                "owner_ids": oil.get("owner_ids", []),
                "owners": oil.get("owners", []),
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
        "participants": participants,
        "event_mode": event_mode(),
        "event_finished": event_is_finished(),
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


def placeholder_id_for(index: int, decryption: dict[str, Any]) -> str:
    existing = {oil["id"] for oil in decryption["oils"]}
    candidate = f"platzhalter-frei-{index + 1:02d}"
    if candidate not in existing:
        return candidate
    suffix = 2
    while f"{candidate}-{suffix}" in existing:
        suffix += 1
    return f"{candidate}-{suffix}"


def deranged_ciphers(current: list[str], allowed: list[str]) -> list[str]:
    if len(current) != len(allowed):
        raise ValueError("Chiffre-Satz passt nicht zur Öl-Auswahl.")
    if len(current) < 2:
        return allowed[:]

    rng = random.SystemRandom()
    shuffled = allowed[:]
    for _ in range(200):
        rng.shuffle(shuffled)
        if all(old != new for old, new in zip(current, shuffled)):
            return shuffled[:]

    fixed_indexes = [index for index, (old, new) in enumerate(zip(current, shuffled)) if old == new]
    if len(fixed_indexes) == 1:
        fixed = fixed_indexes[0]
        swap_with = 0 if fixed != 0 else 1
        shuffled[fixed], shuffled[swap_with] = shuffled[swap_with], shuffled[fixed]
    elif fixed_indexes:
        first_value = shuffled[fixed_indexes[0]]
        for left, right in zip(fixed_indexes, fixed_indexes[1:]):
            shuffled[left] = shuffled[right]
        shuffled[fixed_indexes[-1]] = first_value
    return shuffled


def delete_oil_responses(config: dict[str, Any], decryption: dict[str, Any], oil_id: str) -> dict[str, Any]:
    oil = next((item for item in decryption["oils"] if item["id"] == oil_id), None)
    if not oil:
        raise ValueError("Öl nicht gefunden.")

    pairs = [(survey["id"], oil.get("ciphers", {}).get(survey["id"])) for survey in config["surveys"]]
    with UPDATE_LOCK, connect_db() as db:
        for survey_id, cipher in pairs:
            if cipher:
                db.execute("DELETE FROM survey_responses WHERE survey_id = ? AND cipher = ?", (survey_id, cipher))
    return oil_selection_payload(config, decryption)


def reset_database() -> dict[str, Any]:
    with UPDATE_LOCK, connect_db() as db:
        db.execute("DELETE FROM survey_responses")
        db.execute("DELETE FROM respondents")
    return {"ok": True, "updated_at": now_iso()}


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

    new_id = unique_oil_id(name, decryption)
    with UPDATE_LOCK, connect_db() as db:
        owner_ids = require_existing_participants(db, owner_ids_from_payload(payload))
        owner_id = owner_ids[0] if owner_ids else None
        submitted_by_id = require_existing_participant(db, payload.get("submitted_by_respondent_id"))
        db.execute(
            """
            UPDATE oils
            SET id = ?, name = ?, type = ?, is_olive_oil = ?, actual_price_per_liter_eur = ?,
                price_source = ?, baseline = 0, implemented = 1, brought_by_respondent_id = ?,
                submitted_by_respondent_id = ?, updated_at = ?
            WHERE slot_index = ?
            """,
            (
                new_id,
                name[:160],
                oil_type,
                1 if is_olive_oil else 0,
                price,
                str(payload.get("price_source") or "Öl-Auswahl")[:500],
                owner_id,
                submitted_by_id,
                now_iso(),
                int(slot["slot_index"]),
            ),
        )
        replace_oil_owners(db, int(slot["slot_index"]), owner_ids)
    return oil_selection_payload(config, load_decryption(config))


def submit_oil_from_home(
    config: dict[str, Any],
    decryption: dict[str, Any],
    respondent: Respondent,
    payload: dict[str, Any],
) -> dict[str, Any]:
    require_event_mode(
        EVENT_MODE_PREPARATION,
        "Öle können nur während der Vorbereitung eingereicht werden.",
    )
    if not respondent.display_name:
        raise ValueError("Bitte zuerst mit Name und PIN anmelden.")
    submitted = dict(payload)
    if "owner_ids" not in submitted:
        submitted["owner_ids"] = [respondent.id]
    owner_ids = owner_ids_from_payload(submitted)
    if not owner_ids:
        raise ValueError("Bitte mindestens eine Person auswählen, von der das Öl ist.")
    submitted["owner_ids"] = owner_ids
    submitted["submitted_by_respondent_id"] = respondent.id
    submitted["price_source"] = f"Einreichung von {respondent.display_name}"
    add_oil(config, decryption, submitted)
    return home_state_payload(config, load_decryption(config), respondent)


def update_oil(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    oil_id = str(payload.get("oil_id", ""))
    name = str(payload.get("name", "")).strip()
    price = required_price(payload.get("actual_price_per_liter_eur"))
    is_olive_oil = bool(payload.get("is_olive_oil"))
    oil_type = "Olivenöl" if is_olive_oil else "Nicht-Olivenöl"
    if not name:
        raise ValueError("Ölname fehlt.")
    oil = next((item for item in decryption["oils"] if item.get("id") == oil_id and item.get("implemented")), None)
    if not oil:
        raise ValueError("Öl nicht gefunden.")

    with UPDATE_LOCK, connect_db() as db:
        owner_ids = require_existing_participants(db, owner_ids_from_payload(payload))
        owner_id = owner_ids[0] if owner_ids else None
        db.execute(
            """
            UPDATE oils
            SET name = ?, type = ?, is_olive_oil = ?, actual_price_per_liter_eur = ?, price_source = ?,
                brought_by_respondent_id = ?, updated_at = ?
            WHERE slot_index = ? AND implemented = 1
            """,
            (
                name[:160],
                oil_type,
                1 if is_olive_oil else 0,
                price,
                "Öl-Auswahl",
                owner_id,
                now_iso(),
                int(oil["slot_index"]),
            ),
        )
        replace_oil_owners(db, int(oil["slot_index"]), owner_ids)
    return oil_selection_payload(config, load_decryption(config))


def remove_oil(config: dict[str, Any], decryption: dict[str, Any], oil_id: str) -> dict[str, Any]:
    counts = oil_response_counts(config, decryption)
    if counts.get(oil_id, 0):
        raise ValueError("Dieses Öl hat bereits Wertungen und kann nicht entfernt werden.")
    for index, oil in enumerate(decryption["oils"]):
        if oil["id"] == oil_id and oil.get("implemented"):
            placeholder_id = placeholder_id_for(index, decryption)
            with UPDATE_LOCK, connect_db() as db:
                db.execute(
                    """
                    UPDATE oils
                    SET id = ?, name = ?, type = 'Platzhalter', is_olive_oil = 0,
                        actual_price_per_liter_eur = NULL, price_source = NULL, baseline = 0,
                        implemented = 0, brought_by_respondent_id = NULL,
                        submitted_by_respondent_id = NULL, updated_at = ?
                    WHERE slot_index = ?
                    """,
                    (placeholder_id, f"Platzhalter frei {index + 1:02d}", now_iso(), int(oil["slot_index"])),
                )
                replace_oil_owners(db, int(oil["slot_index"]), [])
            return oil_selection_payload(config, load_decryption(config))
    raise ValueError("Öl nicht gefunden.")


def shuffle_oil_ciphers(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    updates: list[tuple[int, str, str, str, str]] = []
    operation = uuid.uuid4().hex

    for survey in config["surveys"]:
        survey_id = survey["id"]
        allowed = list(decryption["cipher_sets"][survey["cipher_set"]])
        current = [oil.get("ciphers", {}).get(survey_id, "") for oil in decryption["oils"]]
        shuffled = deranged_ciphers(current, allowed)
        for index, (oil, new_cipher) in enumerate(zip(decryption["oils"], shuffled)):
            old_cipher = oil.setdefault("ciphers", {}).get(survey_id)
            if old_cipher != new_cipher:
                temporary = f"__cipher_shuffle_{operation}_{survey_id}_{index}__"
                updates.append((int(oil["slot_index"]), survey_id, str(old_cipher), new_cipher, temporary))
            oil["ciphers"][survey_id] = new_cipher

    validate_decryption(config, decryption)
    with UPDATE_LOCK, connect_db() as db:
        for slot_index, survey_id, old_cipher, _new_cipher, temporary_cipher in updates:
            db.execute(
                "UPDATE survey_responses SET cipher = ? WHERE survey_id = ? AND cipher = ?",
                (temporary_cipher, survey_id, old_cipher),
            )
            db.execute(
                "UPDATE oil_ciphers SET cipher = ? WHERE slot_index = ? AND survey_id = ?",
                (temporary_cipher, slot_index, survey_id),
            )
        for slot_index, survey_id, _old_cipher, new_cipher, temporary_cipher in updates:
            db.execute(
                "UPDATE oil_ciphers SET cipher = ? WHERE slot_index = ? AND survey_id = ?",
                (new_cipher, slot_index, survey_id),
            )
            db.execute(
                "UPDATE survey_responses SET cipher = ? WHERE survey_id = ? AND cipher = ?",
                (new_cipher, survey_id, temporary_cipher),
            )
    return oil_selection_payload(config, load_decryption(config))


def clamp_to_step(value: float, minimum: float, maximum: float, step: float) -> float:
    clamped = max(minimum, min(maximum, value))
    if step > 0:
        clamped = minimum + round((clamped - minimum) / step) * step
    return max(minimum, min(maximum, clamped))


def dummy_numeric_value(rng: random.SystemRandom, profile: str, field: dict[str, Any]) -> float:
    minimum = float(field.get("min", 0))
    maximum = float(field.get("max", 5))
    step = float(field.get("step", 1))
    span = max(1.0, maximum - minimum)
    field_id = field.get("id")

    if profile == "low":
        ratio = 0.72 if field_id == "bitter" else 0.24
    elif profile == "high":
        ratio = 0.18 if field_id == "bitter" else 0.78
    else:
        ratio = rng.uniform(0.08, 0.92)

    value = minimum + span * ratio + rng.uniform(-0.12, 0.12) * span
    return clamp_to_step(value, minimum, maximum, step)


def dummy_price_guess(rng: random.SystemRandom, profile: str, oil: dict[str, Any], field: dict[str, Any]) -> float:
    actual = as_float(oil.get("actual_price_per_liter_eur")) or float(field.get("default", field.get("min", 1)))
    minimum = float(field.get("min", 1))
    maximum = float(field.get("max", max_actual_price({"oils": [oil]})))
    step = float(field.get("step", 1))
    multiplier = {"low": 0.82, "high": 1.18}.get(profile, rng.uniform(0.72, 1.32))
    value = actual * multiplier + rng.uniform(-0.12, 0.12) * max(5, actual)
    return clamp_to_step(value, minimum, maximum, step)


def dummy_oil_guess(rng: random.SystemRandom, oil: dict[str, Any], field: dict[str, Any]) -> str:
    yes_value = field.get("yes_value", "Olivenöl")
    no_value = field.get("no_value", "Nicht-Olivenöl")
    correct_is_olive = oil_is_olive_oil(oil)
    guessed_is_olive = correct_is_olive if rng.random() < 0.82 else not correct_is_olive
    return yes_value if guessed_is_olive else no_value


def dummy_answer_for_field(
    rng: random.SystemRandom,
    profile: str,
    field: dict[str, Any],
    oil: dict[str, Any],
    no_comment_value: str,
) -> Any:
    field_id = field.get("id")
    kind = field.get("kind")
    if field_id == "oil_guess":
        return dummy_oil_guess(rng, oil, field)
    if field_id == "price_guess":
        return dummy_price_guess(rng, profile, oil, field)
    if kind in {"rating", "range"}:
        value = dummy_numeric_value(rng, profile, field)
        return int(value) if float(value).is_integer() else round(value, 2)
    if kind == "textarea" and field_id == "aroma_profile":
        return no_comment_value if rng.random() < 0.9 else rng.choice(DUMMY_COMMENTS)
    if kind == "select":
        options = field.get("options") or []
        return rng.choice(options) if options else ""
    return ""


def add_dummy_data(config: dict[str, Any], decryption: dict[str, Any]) -> dict[str, Any]:
    rng = random.SystemRandom()
    runtime_config = public_runtime_config(config, decryption)
    sample_lookup = cipher_to_oil(config, decryption)
    no_comment_value = text_at(load_texts(), ("/umfrage/:id", "no_comment_value"), "kein Kommentar")
    profiles = [
        ("niedrig", "low"),
        ("niedrig", "low"),
        ("hoch", "high"),
        ("hoch", "high"),
        ("zufall", "random"),
        ("zufall", "random"),
        ("zufall", "random"),
        ("zufall", "random"),
    ]
    timestamp = now_iso()
    group_counts: dict[str, int] = {}

    with UPDATE_LOCK, connect_db() as db:
        for label, profile in profiles:
            group_counts[label] = group_counts.get(label, 0) + 1
            token = f"dummy-{uuid.uuid4().hex}"
            name = f"Dummy {label} {group_counts[label]}"
            cursor = db.execute(
                """
                INSERT INTO respondents (token, ip, user_agent, display_name, publish_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (token, "0.0.0.0", "Dummy-Daten", name, 1, timestamp, timestamp),
            )
            respondent_id = int(cursor.lastrowid)
            for survey in runtime_config["surveys"]:
                survey_id = survey["id"]
                for sample in survey.get("samples", []):
                    oil = sample_lookup.get((survey_id, sample["cipher"]))
                    if oil is None:
                        continue
                    answers = {
                        field["id"]: dummy_answer_for_field(rng, profile, field, oil, no_comment_value)
                        for field in survey.get("fields", [])
                        if field.get("id")
                    }
                    db.execute(
                        """
                        INSERT INTO survey_responses (
                            respondent_id, survey_id, cipher, answers_json, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            respondent_id,
                            survey_id,
                            sample["cipher"],
                            json.dumps(answers, ensure_ascii=False),
                            timestamp,
                            timestamp,
                        ),
                    )

    return oil_selection_payload(config, decryption)


def require_oil_password(value: Any) -> None:
    if value != OIL_SELECTION_PASSWORD:
        raise ValueError("Passwort ist falsch.")


def normalize_pin(value: Any) -> str:
    pin = str(value or "").strip()
    if not re.fullmatch(r"\d{4}", pin):
        raise ValueError("Die PIN muss genau vier Ziffern haben.")
    return pin


def hash_pin(pin: str, salt: str | None = None) -> str:
    normalized = normalize_pin(pin)
    pin_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        normalized.encode("utf-8"),
        bytes.fromhex(pin_salt),
        PIN_HASH_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PIN_HASH_ITERATIONS}${pin_salt}${digest}"


def verify_pin(pin: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt, expected = str(encoded or "").split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            normalize_pin(pin).encode("utf-8"),
            bytes.fromhex(salt),
            int(iterations),
        ).hex()
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(actual, expected)


def load_default_pins(path: Path | None = None) -> dict[str, str]:
    source = path or PINS_PATH
    if not source.is_file():
        return {}
    result: dict[str, str] = {}
    try:
        lines = source.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    for line in lines:
        parts = line.split("\t", 2)
        if len(parts) < 2:
            continue
        participant_id, pin = parts[0].strip(), parts[1].strip()
        if participant_id.isdigit() and re.fullmatch(r"\d{4}", pin):
            result[participant_id] = pin
    return result


def participant_pin_status(row: sqlite3.Row, default_pins: dict[str, str] | None = None) -> str:
    if str(row["pin_hash"] or ""):
        return "set"
    if bool(row["pin_reset_required"]):
        return "reset"
    pins = default_pins if default_pins is not None else load_default_pins()
    return "file" if str(row["id"]) in pins else "setup"


def authenticate_or_set_participant_pin(db: sqlite3.Connection, row: sqlite3.Row, value: Any) -> bool:
    pin = normalize_pin(value)
    encoded = str(row["pin_hash"] or "")
    if encoded:
        if not verify_pin(pin, encoded):
            raise ValueError("PIN ist falsch.")
        return False

    if not bool(row["pin_reset_required"]):
        default_pin = load_default_pins().get(str(row["id"]))
        if default_pin:
            if not hmac.compare_digest(pin, default_pin):
                raise ValueError("PIN ist falsch.")
            db.execute(
                "UPDATE respondents SET pin_hash = ?, updated_at = ? WHERE id = ?",
                (hash_pin(pin), now_iso(), int(row["id"])),
            )
            return False

    db.execute(
        """
        UPDATE respondents
        SET pin_hash = ?, pin_reset_required = 0, updated_at = ?
        WHERE id = ?
        """,
        (hash_pin(pin), now_iso(), int(row["id"])),
    )
    return True


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, factory=ClosingSQLiteConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def ensure_database_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS respondents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL UNIQUE,
            ip TEXT NOT NULL,
            user_agent TEXT NOT NULL,
            display_name TEXT,
            publish_name INTEGER NOT NULL DEFAULT 1,
            publish_competitive_name INTEGER NOT NULL DEFAULT 1,
            is_participant INTEGER NOT NULL DEFAULT 1,
            pin_hash TEXT,
            pin_reset_required INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS oils (
            slot_index INTEGER PRIMARY KEY,
            id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            is_olive_oil INTEGER NOT NULL DEFAULT 0,
            actual_price_per_liter_eur REAL,
            price_source TEXT,
            baseline INTEGER NOT NULL DEFAULT 0,
            implemented INTEGER NOT NULL DEFAULT 0,
            brought_by_respondent_id INTEGER,
            submitted_by_respondent_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (brought_by_respondent_id) REFERENCES respondents(id) ON DELETE SET NULL,
            FOREIGN KEY (submitted_by_respondent_id) REFERENCES respondents(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS oil_owners (
            slot_index INTEGER NOT NULL,
            respondent_id INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            PRIMARY KEY (slot_index, respondent_id),
            FOREIGN KEY (slot_index) REFERENCES oils(slot_index) ON DELETE CASCADE,
            FOREIGN KEY (respondent_id) REFERENCES respondents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS oil_ciphers (
            slot_index INTEGER NOT NULL,
            survey_id TEXT NOT NULL,
            cipher TEXT NOT NULL,
            PRIMARY KEY (slot_index, survey_id),
            UNIQUE (survey_id, cipher),
            FOREIGN KEY (slot_index) REFERENCES oils(slot_index) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_respondents_ip_agent
            ON respondents(ip, user_agent, updated_at);

        CREATE INDEX IF NOT EXISTS idx_respondents_display_name
            ON respondents(display_name COLLATE NOCASE, updated_at);

        CREATE INDEX IF NOT EXISTS idx_responses_updated
            ON survey_responses(updated_at);

        CREATE INDEX IF NOT EXISTS idx_oils_brought_by
            ON oils(brought_by_respondent_id);

        CREATE INDEX IF NOT EXISTS idx_oil_owners_respondent
            ON oil_owners(respondent_id, slot_index);
        """
    )
    respondent_columns = {row["name"] for row in db.execute("PRAGMA table_info(respondents)").fetchall()}
    if "publish_name" not in respondent_columns:
        db.execute("ALTER TABLE respondents ADD COLUMN publish_name INTEGER NOT NULL DEFAULT 1")
    if "publish_competitive_name" not in respondent_columns:
        db.execute("ALTER TABLE respondents ADD COLUMN publish_competitive_name INTEGER NOT NULL DEFAULT 1")
    if "is_participant" not in respondent_columns:
        db.execute("ALTER TABLE respondents ADD COLUMN is_participant INTEGER NOT NULL DEFAULT 1")
    if "pin_hash" not in respondent_columns:
        db.execute("ALTER TABLE respondents ADD COLUMN pin_hash TEXT")
    if "pin_reset_required" not in respondent_columns:
        db.execute("ALTER TABLE respondents ADD COLUMN pin_reset_required INTEGER NOT NULL DEFAULT 0")

    oil_columns = {row["name"] for row in db.execute("PRAGMA table_info(oils)").fetchall()}
    if "brought_by_respondent_id" not in oil_columns:
        db.execute("ALTER TABLE oils ADD COLUMN brought_by_respondent_id INTEGER REFERENCES respondents(id) ON DELETE SET NULL")
    if "submitted_by_respondent_id" not in oil_columns:
        db.execute("ALTER TABLE oils ADD COLUMN submitted_by_respondent_id INTEGER REFERENCES respondents(id) ON DELETE SET NULL")
    db.execute("CREATE INDEX IF NOT EXISTS idx_oils_submitted_by ON oils(submitted_by_respondent_id)")

    # Übernimmt die bisherige Einzel-Zuordnung einmalig in die neue n:m-Tabelle.
    db.execute(
        """
        INSERT OR IGNORE INTO oil_owners (slot_index, respondent_id, position, created_at)
        SELECT slot_index, brought_by_respondent_id, 0, updated_at
        FROM oils
        WHERE brought_by_respondent_id IS NOT NULL
        """
    )


def insert_oil_slot(db: sqlite3.Connection, slot_index: int, oil: dict[str, Any], timestamp: str) -> None:
    normalized = normalize_oil_row(slot_index, oil)
    db.execute(
        """
        INSERT INTO oils (
            slot_index, id, name, type, is_olive_oil, actual_price_per_liter_eur,
            price_source, baseline, implemented, brought_by_respondent_id, submitted_by_respondent_id,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            normalized["slot_index"],
            normalized["id"],
            normalized["name"],
            normalized["type"],
            1 if normalized["is_olive_oil"] else 0,
            normalized["actual_price_per_liter_eur"],
            normalized["price_source"],
            1 if normalized["baseline"] else 0,
            1 if normalized["implemented"] else 0,
            normalized["brought_by_respondent_id"],
            normalized["submitted_by_respondent_id"],
            timestamp,
            timestamp,
        ),
    )
    if normalized["brought_by_respondent_id"] is not None:
        db.execute(
            """
            INSERT OR IGNORE INTO oil_owners (slot_index, respondent_id, position, created_at)
            VALUES (?, ?, 0, ?)
            """,
            (slot_index, normalized["brought_by_respondent_id"], timestamp),
        )
    for survey_id, cipher in normalized["ciphers"].items():
        db.execute(
            """
            INSERT INTO oil_ciphers (slot_index, survey_id, cipher)
            VALUES (?, ?, ?)
            """,
            (slot_index, survey_id, str(cipher)),
        )


def migrate_legacy_oils(db: sqlite3.Connection, config: dict[str, Any], decryption: dict[str, Any]) -> None:
    oil_count = db.execute("SELECT COUNT(*) AS count FROM oils").fetchone()["count"]
    if oil_count:
        return

    timestamp = now_iso()
    legacy_oils = decryption.get("oils")
    if isinstance(legacy_oils, list) and len(legacy_oils) == DEFAULT_OIL_SLOT_COUNT:
        candidate = {
            "note": decryption.get("note", ""),
            "cipher_sets": decryption["cipher_sets"],
            "oils": [
                {**oil, "slot_index": index}
                for index, oil in enumerate(legacy_oils)
                if isinstance(oil, dict)
            ],
        }
        validate_decryption(config, candidate)
        oils = candidate["oils"]
    else:
        oils = generated_placeholder_oils(config, decryption)

    for index, oil in enumerate(oils):
        insert_oil_slot(db, index, oil, timestamp)


def init_db(config: dict[str, Any] | None = None) -> None:
    with UPDATE_LOCK, connect_db() as db:
        ensure_database_schema(db)
        if config is not None:
            decryption = load_json_file(DECRYPTION_PATH)
            validate_cipher_sets(config, decryption)
            migrate_legacy_oils(db, config, decryption)


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
                  AND (display_name IS NULL OR TRIM(display_name) = '')
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
        publish_competitive_name=bool(row["publish_competitive_name"]) if "publish_competitive_name" in row.keys() else True,
        is_participant=bool(row["is_participant"]) if "is_participant" in row.keys() else True,
        is_new_cookie=is_new_cookie,
    )


def participant_payload(respondent: Respondent) -> dict[str, Any]:
    mode = event_mode()
    return {
        "ok": True,
        "participant": {
            "id": respondent.id,
            "display_name": respondent.display_name or "",
            "publish_name": respondent.publish_name if respondent.display_name else True,
            "publish_competitive_name": respondent.publish_competitive_name if respondent.display_name else True,
            "is_participant": respondent.is_participant,
            "authenticated": bool(respondent.display_name),
        },
        "event_mode": mode,
        "event_finished": mode == EVENT_MODE_EVALUATION,
        "capabilities": {
            "submit_oil": bool(respondent.display_name) and mode == EVENT_MODE_PREPARATION,
            "open_surveys": bool(respondent.display_name) and mode in {EVENT_MODE_EXECUTION, EVENT_MODE_EVALUATION},
            "edit_surveys": bool(respondent.display_name) and mode == EVENT_MODE_EXECUTION,
            "open_results": mode == EVENT_MODE_EVALUATION,
        },
    }


def home_submission_payload(
    config: dict[str, Any],
    decryption: dict[str, Any],
    respondent: Respondent,
) -> list[dict[str, Any]]:
    if not respondent.display_name:
        return []

    own_oils = [
        oil
        for oil in active_oils(decryption)
        if respondent.id in {int(owner_id) for owner_id in oil.get("owner_ids", [])}
        or oil.get("submitted_by_respondent_id") == respondent.id
    ]
    values_by_oil: dict[str, dict[str, list[float]]] = {
        oil["id"]: {str(survey["id"]): [] for survey in config["surveys"]}
        for oil in own_oils
    }
    if event_is_finished() and own_oils:
        lookup = cipher_to_oil(config, decryption)
        with connect_db() as db:
            rows = db.execute("SELECT survey_id, cipher, answers_json FROM survey_responses").fetchall()
        for row in rows:
            oil = lookup.get((str(row["survey_id"]), str(row["cipher"])))
            if not oil or oil["id"] not in values_by_oil:
                continue
            try:
                answers = json.loads(row["answers_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            value = as_float(answers.get("overall")) if isinstance(answers, dict) else None
            if value is not None:
                values_by_oil[oil["id"]][str(row["survey_id"])].append(value)

    submissions = []
    for oil in own_oils:
        survey_values = values_by_oil[oil["id"]]
        all_values = [value for values in survey_values.values() for value in values]
        submissions.append(
            {
                "id": oil["id"],
                "name": oil.get("name", ""),
                "type": oil.get("type", ""),
                "actual_price_per_liter_eur": oil.get("actual_price_per_liter_eur"),
                "owners": oil.get("owners", []),
                "brought_by_name": oil.get("brought_by_name", ""),
                "overall": {
                    "all": {"avg": average(all_values)},
                    "by_survey": {
                        survey_id: {"avg": average(values)}
                        for survey_id, values in survey_values.items()
                    },
                }
                if event_is_finished()
                else None,
            }
        )
    return sorted(submissions, key=lambda item: str(item["name"]).casefold())


def home_state_payload(
    config: dict[str, Any],
    decryption: dict[str, Any],
    respondent: Respondent,
) -> dict[str, Any]:
    payload = participant_payload(respondent)
    participants: list[dict[str, Any]] = []
    if respondent.display_name:
        with connect_db() as db:
            rows = db.execute(
                """
                SELECT id, display_name
                FROM respondents
                WHERE display_name IS NOT NULL AND TRIM(display_name) != ''
                ORDER BY display_name COLLATE NOCASE
                """
            ).fetchall()
        participants = [
            {"id": int(row["id"]), "display_name": str(row["display_name"])}
            for row in rows
        ]
    payload.update(
        {
            "participants": participants,
            "submissions": home_submission_payload(config, decryption, respondent),
            "submission_capacity": sum(1 for oil in decryption["oils"] if not oil.get("implemented")),
            "survey_series": [
                {
                    "id": str(survey["id"]),
                    "title": str(survey.get("short_title") or survey.get("title") or survey["id"]),
                    "accent": str(survey.get("accent") or "#d49b2b"),
                }
                for survey in config["surveys"]
            ],
        }
    )
    return payload


def clean_display_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())[:80]


def save_participant(
    handler: BaseHTTPRequestHandler,
    config: dict[str, Any],
    decryption: dict[str, Any],
    payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str] | None]:
    respondent = get_or_create_respondent(handler)
    display_name = clean_display_name(payload.get("display_name"))
    if not display_name:
        raise ValueError("Bitte einen Namen eingeben.")
    pin = normalize_pin(payload.get("pin"))
    publish_name = bool(payload.get("publish_name"))
    publish_competitive_name = bool(payload.get("publish_competitive_name"))
    timestamp = now_iso()
    pin_was_set = False

    with UPDATE_LOCK, connect_db() as db:
        current = db.execute("SELECT * FROM respondents WHERE id = ?", (respondent.id,)).fetchone()
        if current is None:
            raise ValueError("Anmeldung konnte nicht zugeordnet werden.")
        target = None
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
        existing_preferences = target or current
        if target is not None:
            pin_was_set = authenticate_or_set_participant_pin(db, target, pin)
        elif current["display_name"]:
            pin_was_set = authenticate_or_set_participant_pin(db, current, pin)
        else:
            db.execute(
                "UPDATE respondents SET pin_hash = ?, pin_reset_required = 0 WHERE id = ?",
                (hash_pin(pin), respondent.id),
            )
            pin_was_set = True

        if event_is_finished(db) and existing_preferences is not None:
            if bool(existing_preferences["publish_name"]) and not publish_name:
                raise ValueError("Nach Ende der Umfrage kann der Name bei den Freitextbewertungen nicht mehr anonymisiert werden.")
            if bool(existing_preferences["publish_competitive_name"]) and not publish_competitive_name:
                raise ValueError("Nach Ende der Umfrage kann die Teilnahme am Symposium-Minispiel nicht mehr zurückgenommen werden.")

        if target and target_id != respondent.id:
            # Nur anonyme, vor der Anmeldung entstandene Angaben werden in das Zielkonto übernommen.
            if not current["display_name"]:
                current_rows = db.execute(
                    "SELECT * FROM survey_responses WHERE respondent_id = ?",
                    (respondent.id,),
                ).fetchall()
                for current_response in current_rows:
                    existing = db.execute(
                        """
                        SELECT updated_at
                        FROM survey_responses
                        WHERE respondent_id = ? AND survey_id = ? AND cipher = ?
                        """,
                        (target_id, current_response["survey_id"], current_response["cipher"]),
                    ).fetchone()
                    if existing is None or str(current_response["updated_at"]) >= str(existing["updated_at"]):
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
                                current_response["survey_id"],
                                current_response["cipher"],
                                current_response["answers_json"],
                                current_response["created_at"],
                                current_response["updated_at"],
                            ),
                        )
                db.execute("DELETE FROM survey_responses WHERE respondent_id = ?", (respondent.id,))
                db.execute(
                    """
                    INSERT OR IGNORE INTO oil_owners (slot_index, respondent_id, position, created_at)
                    SELECT slot_index, ?, position, created_at
                    FROM oil_owners
                    WHERE respondent_id = ?
                    """,
                    (target_id, respondent.id),
                )
                db.execute("DELETE FROM oil_owners WHERE respondent_id = ?", (respondent.id,))
                db.execute(
                    "UPDATE oils SET brought_by_respondent_id = ? WHERE brought_by_respondent_id = ?",
                    (target_id, respondent.id),
                )
                db.execute(
                    "UPDATE oils SET submitted_by_respondent_id = ? WHERE submitted_by_respondent_id = ?",
                    (target_id, respondent.id),
                )

            # Der aktuelle Cookie wechselt zum authentifizierten Zielkonto. Ein bisheriges
            # Konto bleibt mit einem neuen, nicht ausgelieferten Token erhalten.
            db.execute(
                "UPDATE respondents SET token = ? WHERE id = ?",
                (f"detached-{uuid.uuid4().hex}", respondent.id),
            )
            if not current["display_name"]:
                db.execute("DELETE FROM respondents WHERE id = ?", (respondent.id,))

        db.execute(
            """
            UPDATE respondents
            SET token = ?, ip = ?, user_agent = ?, display_name = ?, publish_name = ?,
                publish_competitive_name = ?, is_participant = 1, updated_at = ?
            WHERE id = ?
            """,
            (
                target_token,
                respondent.ip,
                respondent.user_agent,
                display_name or None,
                1 if publish_name else 0,
                1 if publish_competitive_name else 0,
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
        publish_competitive_name=bool(row["publish_competitive_name"]),
        is_participant=True,
        is_new_cookie=False,
    )
    body = home_state_payload(config, load_decryption(config), updated)
    body["pin_was_set"] = pin_was_set
    return body, {"Set-Cookie": cookie_header(updated.token)}


def logout_participant(
    handler: BaseHTTPRequestHandler,
    config: dict[str, Any],
    decryption: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    token = uuid.uuid4().hex
    timestamp = now_iso()
    ip = handler.client_address[0]
    user_agent = handler.headers.get("User-Agent", "")[:500]
    with UPDATE_LOCK, connect_db() as db:
        cursor = db.execute(
            """
            INSERT INTO respondents (token, ip, user_agent, publish_name, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (token, ip, user_agent, timestamp, timestamp),
        )
        respondent_id = int(cursor.lastrowid)
    anonymous = Respondent(
        id=respondent_id,
        token=token,
        ip=ip,
        user_agent=user_agent,
        display_name=None,
        publish_name=True,
        publish_competitive_name=True,
        is_participant=True,
        is_new_cookie=False,
    )
    return home_state_payload(config, decryption, anonymous), {"Set-Cookie": cookie_header(token)}


def ensure_unique_participant_name(db: sqlite3.Connection, display_name: str, exclude_id: int | None = None) -> None:
    params: list[Any] = [display_name]
    where = "display_name = ? COLLATE NOCASE"
    if exclude_id is not None:
        where += " AND id != ?"
        params.append(exclude_id)
    row = db.execute(
        f"""
        SELECT id
        FROM respondents
        WHERE {where}
        LIMIT 1
        """,
        params,
    ).fetchone()
    if row is not None:
        raise ValueError("Ein Proband mit diesem Namen existiert bereits.")


def add_participant_from_admin(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    display_name = clean_display_name(payload.get("display_name"))
    if not display_name:
        raise ValueError("Name fehlt.")
    publish_name = bool(payload.get("publish_name", True))
    publish_competitive_name = bool(payload.get("publish_competitive_name", True))
    is_participant = bool(payload.get("is_participant", False))
    timestamp = now_iso()
    with UPDATE_LOCK, connect_db() as db:
        ensure_unique_participant_name(db, display_name)
        db.execute(
            """
            INSERT INTO respondents (
                token, ip, user_agent, display_name, publish_name, publish_competitive_name,
                is_participant, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"manual-{uuid.uuid4().hex}",
                "0.0.0.0",
                "Admin-Probandenliste",
                display_name,
                1 if publish_name else 0,
                1 if publish_competitive_name else 0,
                1 if is_participant else 0,
                timestamp,
                timestamp,
            ),
        )
    return oil_selection_payload(config, load_decryption(config))


def update_participant_from_admin(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    participant_id = as_int(payload.get("participant_id"))
    display_name = clean_display_name(payload.get("display_name"))
    if participant_id is None:
        raise ValueError("Proband fehlt.")
    if not display_name:
        raise ValueError("Name fehlt.")
    publish_name = bool(payload.get("publish_name"))
    publish_competitive_name = bool(payload.get("publish_competitive_name"))
    is_participant = bool(payload.get("is_participant"))
    with UPDATE_LOCK, connect_db() as db:
        row = db.execute("SELECT * FROM respondents WHERE id = ?", (participant_id,)).fetchone()
        if row is None:
            raise ValueError("Proband nicht gefunden.")
        if event_is_finished(db):
            if bool(row["publish_name"]) and not publish_name:
                raise ValueError("Nach Ende der Umfrage kann der Name bei den Freitextbewertungen nicht mehr anonymisiert werden.")
            if bool(row["publish_competitive_name"]) and not publish_competitive_name:
                raise ValueError("Nach Ende der Umfrage kann die Teilnahme am Symposium-Minispiel nicht mehr zurückgenommen werden.")
        ensure_unique_participant_name(db, display_name, participant_id)
        db.execute(
            """
            UPDATE respondents
            SET display_name = ?, publish_name = ?, publish_competitive_name = ?, is_participant = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                display_name,
                1 if publish_name else 0,
                1 if publish_competitive_name else 0,
                1 if is_participant else 0,
                now_iso(),
                participant_id,
            ),
        )
    return oil_selection_payload(config, load_decryption(config))


def reset_participant_pin(config: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    participant_id = as_int(payload.get("participant_id"))
    if participant_id is None:
        raise ValueError("Proband fehlt.")
    with UPDATE_LOCK, connect_db() as db:
        row = db.execute("SELECT id FROM respondents WHERE id = ?", (participant_id,)).fetchone()
        if row is None:
            raise ValueError("Proband nicht gefunden.")
        db.execute(
            """
            UPDATE respondents
            SET token = ?, pin_hash = NULL, pin_reset_required = 1, updated_at = ?
            WHERE id = ?
            """,
            (f"pin-reset-{uuid.uuid4().hex}", now_iso(), participant_id),
        )
    return oil_selection_payload(config, load_decryption(config))


def delete_participant_from_admin(config: dict[str, Any], decryption: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    participant_id = as_int(payload.get("participant_id"))
    if participant_id is None:
        raise ValueError("Proband fehlt.")
    with UPDATE_LOCK, connect_db() as db:
        row = db.execute("SELECT id FROM respondents WHERE id = ?", (participant_id,)).fetchone()
        if row is None:
            raise ValueError("Proband nicht gefunden.")
        db.execute("DELETE FROM respondents WHERE id = ?", (participant_id,))
    return oil_selection_payload(config, load_decryption(config))


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


def network_home_url(port: int) -> str:
    for origin in local_origins(port):
        host = urlparse(origin).hostname or ""
        if re.match(r"^\d+\.\d+\.\d+\.\d+$", host) and host != "127.0.0.1":
            return f"{origin}/"
    return f"http://127.0.0.1:{port}/"


def render_home(handler: BaseHTTPRequestHandler, config: dict[str, Any], decryption: dict[str, Any], respondent: Respondent) -> str:
    texts = load_texts()
    mode = event_mode()
    authenticated = bool(respondent.display_name)
    can_open_surveys = authenticated and mode in {EVENT_MODE_EXECUTION, EVENT_MODE_EVALUATION}
    can_submit = authenticated and mode == EVENT_MODE_PREPARATION
    can_open_results = mode == EVENT_MODE_EVALUATION
    publish_checked = respondent.publish_name if respondent.display_name else True
    publish_competitive_checked = respondent.publish_competitive_name if respondent.display_name else True
    mode_labels = {
        EVENT_MODE_PREPARATION: route_text(texts, "/", "mode_preparation", "Vorbereitung"),
        EVENT_MODE_EXECUTION: route_text(texts, "/", "mode_execution", "Durchführung"),
        EVENT_MODE_EVALUATION: route_text(texts, "/", "mode_evaluation", "Auswertung"),
    }
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

    submission_form = ""
    if mode != EVENT_MODE_EVALUATION:
        submission_form = f"""
          <details id="new-submission" class="new-submission" {"" if can_submit else "data-disabled='true'"}>
            <summary class="submission-toggle {"" if can_submit else "locked-link"}" aria-disabled="{"false" if can_submit else "true"}">
              <span>{html.escape(route_text(texts, '/', 'submission_new_title', 'Etwas Neues einreichen'))}</span>
              <small>{html.escape(route_text(texts, '/', 'submission_new_hint', 'Formular aufklappen'))}</small>
            </summary>
            <div class="submission-form">
              <label>
                {html.escape(route_text(texts, '/', 'submission_name_label', 'Name des Öls'))}
                <input id="submission-name" type="text" maxlength="160" autocomplete="off">
              </label>
              <label>
                {html.escape(route_text(texts, '/', 'submission_price_label', 'Preis pro Liter'))}
                <input id="submission-price" type="number" min="1" step="1" inputmode="decimal">
              </label>
              <label class="check-option submission-olive-option">
                <input id="submission-is-olive" type="checkbox" checked>
                <span>{html.escape(route_text(texts, '/', 'submission_is_olive', 'Olivenöl'))}</span>
              </label>
              <fieldset class="submission-owners-field">
                <legend>{html.escape(route_text(texts, '/', 'submission_owners_label', 'Von wem ist das Öl?'))}</legend>
                <p class="metric-sub">{html.escape(route_text(texts, '/', 'submission_owners_hint', 'Du bist vorausgewählt und kannst weitere Personen ergänzen.'))}</p>
                <div id="submission-owner-options" class="submission-owner-options"></div>
              </fieldset>
              <button id="submit-oil-button" class="save-button" type="button" {"" if can_submit else "disabled"}>{html.escape(route_text(texts, '/', 'submission_button', 'Öl einreichen'))}</button>
              <p id="submission-state" class="notice" aria-live="polite"></p>
            </div>
          </details>
        """

    result_section = ""
    if mode != EVENT_MODE_PREPARATION:
        result_link_class = "primary-link result-entry-link" if can_open_results else "primary-link result-entry-link locked-link"
        result_section = f"""
          <section class="link-grid result-link-grid">
            <article class="link-card result-link-card" style="--accent:#f3f5f7;--accent-contrast:#111827;--accent-hover-contrast:#111827">
              <div>
                <p class="eyebrow">{html.escape(route_text(texts, '/', 'results_eyebrow', 'Auswertung'))}</p>
                <h2>{html.escape(route_text(texts, '/', 'results_title', 'Ergebnisse'))}</h2>
              </div>
              <a class="{result_link_class}" href="/ergebnisse" aria-disabled="{"false" if can_open_results else "true"}">{html.escape(route_text(texts, '/', 'results_open_button', 'Öffnen'))}</a>
            </article>
          </section>
        """

    page_title = route_text(texts, "/", "page_title", "Studie des Oliven-Symposiums")
    home_subtitle = route_text(texts, "/", "subtitle", "")
    home_subtitle_html = f'<p class="topbar-subtitle">{html.escape(home_subtitle)}</p>' if home_subtitle else ""
    initial_state = home_state_payload(config, decryption, respondent)
    return page_shell(
        page_title,
        f"""
        <main id="home-app" class="page" data-event-mode="{html.escape(mode)}">
          <section class="topbar">
            <div>
              <h1>{html.escape(route_text(texts, '/', 'heading', page_title))}</h1>
              {home_subtitle_html}
            </div>
            <span id="event-mode-badge" class="event-mode-badge mode-{html.escape(mode)}">{html.escape(mode_labels[mode])}</span>
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
            <form id="participant-form" class="participant-form">
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
              <label class="participant-pin-field">
                <span>{html.escape(route_text(texts, '/', 'participant_pin_label', '4-stellige PIN'))}</span>
                <input
                  id="participant-pin"
                  type="password"
                  inputmode="numeric"
                  pattern="[0-9]{{4}}"
                  maxlength="4"
                  autocomplete="current-password"
                  placeholder="••••"
                >
              </label>
              <label class="check-option publish-option">
                <input id="participant-publish" type="checkbox" {"checked" if publish_checked else ""}>
                <span>{html.escape(route_text(texts, '/', 'publish_label', 'Name bei Freitextbewertungen veröffentlichen'))}</span>
              </label>
              <label class="check-option publish-option">
                <input id="participant-publish-competitive" type="checkbox" {"checked" if publish_competitive_checked else ""}>
                <span>{html.escape(route_text(texts, '/', 'publish_competitive_label', 'beim Symposium-Minispiel mitmachen'))}</span>
              </label>
              <div class="participant-actions">
                <button id="participant-login" class="save-button" type="submit">{html.escape(route_text(texts, '/', 'participant_login_button', 'Anmelden'))}</button>
                <button id="participant-logout" class="ghost-button" type="button" {"" if authenticated else "hidden"}>{html.escape(route_text(texts, '/', 'participant_logout_button', 'Abmelden'))}</button>
              </div>
            </form>
            <p class="notice" id="participant-state"> </p>
          </section>

          <section id="submissions-card" class="setup-editor submissions-card">
            <div class="submissions-heading">
              <div>
                <p class="eyebrow">{html.escape(route_text(texts, '/', 'submissions_eyebrow', 'Deine Auswahl'))}</p>
                <h2>{html.escape(route_text(texts, '/', 'submissions_title', 'Einreichungen'))}</h2>
              </div>
              <span id="submission-count" class="submission-count">0</span>
            </div>
            <div id="own-submissions" class="own-submissions" aria-live="polite"></div>
            {submission_form}
          </section>

          <section class="link-grid survey-link-grid">
            {''.join(survey_cards)}
          </section>

          {result_section}

          <section class="admin-link-section">
            <a class="ghost-button" href="/oel-auswahl">{html.escape(route_text(texts, '/', 'admin_link', 'Öl-Auswahl'))}</a>
          </section>
        </main>
        """,
        f'{inline_json_script("HOME_STATE", initial_state)}<script src="/static/home.js" defer></script>',
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


def render_results_page(
    config: dict[str, Any],
    mode: str = "rankings",
) -> str:
    texts = load_texts()
    if mode == "oils":
        route = "/einzelne-oel-wertungen"
        fallback_title = "Aufschlüsselung je Öl"
    elif mode == "competitive":
        route = "/kompetitive-verkostung"
        fallback_title = "Symposium-Minispiel"
    elif mode == "personal":
        route = "/individuelle-ergebnisse"
        fallback_title = "Individuelle Ergebnisse"
    else:
        route = "/ergebnisse"
        fallback_title = "Ergebnisse"
    page_title = route_text(texts, route, "page_title", fallback_title)
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
    mode = event_mode()
    if mode != EVENT_MODE_EXECUTION:
        if mode == EVENT_MODE_PREPARATION:
            raise ValueError("Die Umfragen sind während der Vorbereitung noch gesperrt.")
        raise ValueError("Die Umfrage ist beendet. Angaben können nur noch eingesehen werden.")
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


def as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
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
        key=lambda item: ((-item[1] if reverse else item[1]), item[0]),
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
        key=lambda item: (item["rank"] or 999, item["name"].casefold()),
        reverse=False,
    )
    if not reverse:
        ordered = sorted(ordered, key=lambda item: (item["rank"] or 999, item["name"].casefold()))
    return {"key": key or slugify(title), "title": title, "subtitle": subtitle, "unit": unit, "color": color, "items": ordered}


def participant_ranking_payload(
    title: str,
    values: dict[str, float | None],
    participants: dict[str, dict[str, Any]],
    ranks: dict[str, int | None],
    unit: str,
    subtitle: str = "",
    key: str | None = None,
    color: str | None = None,
    distributions: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    ordered = sorted(
        [
            {
                "participant_id": participant_id,
                "name": participants[participant_id]["name"],
                "value": round(value, 2) if value is not None else None,
                "rank": ranks.get(participant_id),
                "box": box_plot((distributions or {}).get(participant_id, [])),
            }
            for participant_id, value in values.items()
            if value is not None and participant_id in participants
        ],
        key=lambda item: (item["rank"] or 999, item["name"].casefold()),
    )
    return {"key": key or slugify(title), "title": title, "subtitle": subtitle, "unit": unit, "color": color, "items": ordered}


def participant_stats_template(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "overall_values": [],
        "bitter_values": [],
        "price_errors": [],
        "guess_correct": 0,
        "guess_total": 0,
        "vectors_by_oil": {},
        "comment_texts": set(),
        "comment_lengths": [],
    }


def competitive_payload(
    oils: list[dict[str, Any]],
    surveys: list[dict[str, Any]],
    participants: dict[str, dict[str, Any]],
    texts: dict[str, Any],
    owner_oil_values: dict[str, list[float]] | None = None,
    neutral_comparisons: dict[str, dict[str, list[float]]] | None = None,
    all_people: dict[str, dict[str, Any]] | None = None,
    viewer_name: str | None = None,
    viewer_vectors_by_oil: dict[str, dict[str, float]] | None = None,
) -> dict[str, Any]:
    competitive_texts = dict_at(texts, ("/kompetitive-verkostung",))
    ranking_texts = dict_at(competitive_texts, ("rankings",))
    all_people = all_people or participants
    survey_ids = {survey["id"] for survey in surveys}
    taste_id = "geschmack" if "geschmack" in survey_ids else (surveys[0]["id"] if surveys else "")
    smell_id = "geruch" if "geruch" in survey_ids else (surveys[1]["id"] if len(surveys) > 1 else taste_id)
    experience_id = "gesamt" if "gesamt" in survey_ids else (surveys[2]["id"] if len(surveys) > 2 else smell_id)

    price_accuracy_values = {
        participant_id: average(stats["price_errors"])
        for participant_id, stats in participants.items()
    }
    price_accuracy_ranks = rank_map(price_accuracy_values, reverse=False)
    spread_distributions: dict[str, list[float]] = {}
    for participant_id, stats in participants.items():
        deviations: list[float] = []
        for vector in stats["vectors_by_oil"].values():
            values = [float(value) for value in vector.values()]
            deviations.extend(
                abs(left - right)
                for index, left in enumerate(values)
                for right in values[index + 1 :]
            )
        spread_distributions[participant_id] = deviations
    spread_values = {
        participant_id: average(values)
        for participant_id, values in spread_distributions.items()
    }
    spread_ranks = rank_map(spread_values, reverse=False, distributions=spread_distributions)
    average_overall_values = {
        participant_id: average(stats["overall_values"])
        for participant_id, stats in participants.items()
    }
    average_overall_ranks = rank_map(average_overall_values, reverse=True)
    classification_values = {
        participant_id: (
            stats["guess_correct"] / stats["guess_total"]
            if stats["guess_total"]
            else None
        )
        for participant_id, stats in participants.items()
    }
    classification_ranks = rank_map(classification_values, reverse=True)
    bitter_values = {
        participant_id: average(stats["bitter_values"])
        for participant_id, stats in participants.items()
    }
    bitter_ranks = rank_map(bitter_values, reverse=False)
    owner_oil_values = owner_oil_values or {}
    goat_values = {
        participant_id: average(values)
        for participant_id, values in owner_oil_values.items()
        if participant_id in all_people
    }
    goat_ranks = rank_map(goat_values, reverse=True, distributions=owner_oil_values)
    neutral_comparisons = neutral_comparisons or {}
    neutral_bias_values: dict[str, float | None] = {}
    neutral_bias_signed_values: dict[str, float | None] = {}
    neutral_intermediates: dict[str, dict[str, float | None]] = {}
    for participant_id, comparison in neutral_comparisons.items():
        own_rating = average(comparison.get("own_values", []))
        other_rating = average(comparison.get("peer_values", []))
        own_sonne = average_overall_values.get(participant_id)
        other_sonne = average(
            [
                value
                for other_id, value in average_overall_values.items()
                if other_id != participant_id and value is not None
            ]
        )
        neutral_intermediates[participant_id] = {
            "own_rating": own_rating,
            "other_rating": other_rating,
        }
        if None in {own_rating, other_rating, own_sonne, other_sonne}:
            neutral_bias_values[participant_id] = None
            neutral_bias_signed_values[participant_id] = None
            continue
        own_difference = float(own_rating) - float(own_sonne)
        other_difference = float(other_rating) - float(other_sonne)
        signed_bias = own_difference - other_difference
        neutral_bias_signed_values[participant_id] = signed_bias
        neutral_bias_values[participant_id] = abs(signed_bias)
    neutral_bias_ranks = rank_map(neutral_bias_values, reverse=False)
    comment_count_values = {
        participant_id: float(len(stats["comment_texts"]))
        for participant_id, stats in participants.items()
    }
    comment_count_ranks = rank_map(comment_count_values, reverse=True)
    comment_length_values = {
        participant_id: average(stats["comment_lengths"])
        for participant_id, stats in participants.items()
        if stats["comment_lengths"]
    }
    comment_length_ranks = rank_map(comment_length_values, reverse=True)
    oil_group_costs: dict[str, float] = {}
    for oil in oils:
        owner_ids = [str(owner_id) for owner_id in oil.get("owner_ids", [])]
        if not owner_ids and oil.get("brought_by_respondent_id") is not None:
            owner_ids = [str(oil["brought_by_respondent_id"])]
        price = as_float(oil.get("actual_price_per_liter_eur"))
        if not owner_ids or price is None:
            continue
        shared_cost = price * 0.035 / len(owner_ids)
        for participant_id in owner_ids:
            oil_group_costs[participant_id] = oil_group_costs.get(participant_id, 0.0) + shared_cost
    oil_group_cost_ranks = rank_map(oil_group_costs, reverse=True)

    host_id = next(
        (
            participant_id
            for participant_id, stats in participants.items()
            if str(stats.get("name") or "").strip().casefold() == "erik"
        ),
        None,
    )
    def distances_from(reference_vectors: dict[str, dict[str, float]]) -> tuple[dict[str, list[float]], dict[str, float | None]]:
        distributions: dict[str, list[float]] = {}
        values: dict[str, float | None] = {}
        for participant_id, stats in participants.items():
            distances: list[float] = []
            for oil_id, reference_vector in reference_vectors.items():
                participant_vector = stats["vectors_by_oil"].get(oil_id, {})
                for survey_id in survey_ids:
                    if survey_id in reference_vector and survey_id in participant_vector:
                        distances.append(abs(float(participant_vector[survey_id]) - float(reference_vector[survey_id])))
            if distances:
                distributions[participant_id] = distances
                values[participant_id] = average(distances)
        return distributions, values

    host_distance_distributions: dict[str, list[float]] = {}
    host_distance_values: dict[str, float | None] = {}
    if host_id is not None:
        host_distance_distributions, host_distance_values = distances_from(participants[host_id]["vectors_by_oil"])
    host_distance_ranks = rank_map(host_distance_values, reverse=False)

    normalized_viewer_name = str(viewer_name or "").strip()
    show_viewer_soulmate = bool(normalized_viewer_name) and normalized_viewer_name.casefold() != "erik"
    viewer_distance_distributions: dict[str, list[float]] = {}
    viewer_distance_values: dict[str, float | None] = {}
    if show_viewer_soulmate and viewer_vectors_by_oil:
        viewer_distance_distributions, viewer_distance_values = distances_from(viewer_vectors_by_oil)
    viewer_distance_ranks = rank_map(viewer_distance_values, reverse=False)

    coordinate_oils = []
    for oil in oils:
        oil_id = oil["id"]
        points = []
        for participant_id, stats in participants.items():
            vector_by_survey = stats["vectors_by_oil"].get(oil_id, {})
            if not all(key in vector_by_survey for key in (taste_id, smell_id, experience_id)):
                continue
            vector = [
                float(vector_by_survey[taste_id]),
                float(vector_by_survey[experience_id]),
                float(vector_by_survey[smell_id]),
            ]
            points.append(
                {
                    "participant_id": participant_id,
                    "name": stats["name"],
                    "x": round(vector[0], 2),
                    "y": round(vector[1], 2),
                    "z": round(vector[2], 2),
                }
            )
        coordinate_oils.append(
            {
                "oil_id": oil_id,
                "name": oil["name"],
                "brought_by_name": oil.get("brought_by_name", ""),
                "brought_by_respondent_id": oil.get("brought_by_respondent_id"),
                "owners": oil.get("owners", []),
                "points": sorted(points, key=lambda item: item["name"]),
            }
        )

    rankings = [
            participant_ranking_payload(
                ranking_texts.get("price_accuracy_title", "Preis-Schätzgenauigkeit"),
                price_accuracy_values,
                participants,
                price_accuracy_ranks,
                "€",
                ranking_texts.get("price_accuracy_subtitle", "mittlere absolute Abweichung, niedrigste zuerst"),
                key="price_accuracy",
                distributions={participant_id: stats["price_errors"] for participant_id, stats in participants.items()},
            ),
            participant_ranking_payload(
                ranking_texts.get("participant_spread_title", "individuelle Streuung über alle Proben"),
                spread_values,
                participants,
                spread_ranks,
                "σ",
                ranking_texts.get("participant_spread_subtitle", "niedrigste Streuung zuerst"),
                key="participant_spread",
                distributions=spread_distributions,
            ),
            participant_ranking_payload(
                ranking_texts.get("goat_title", "GOAT-Probanden"),
                goat_values,
                all_people,
                goat_ranks,
                "Punkte",
                ranking_texts.get("goat_subtitle", "durchschnittliche Wertung der mitgebrachten Öle"),
                key="participant_goat",
                distributions=owner_oil_values,
            ),
            participant_ranking_payload(
                ranking_texts.get("oil_group_zero_title", "Ölgruppe 0 negativ"),
                oil_group_costs,
                all_people,
                oil_group_cost_ranks,
                "€",
                ranking_texts.get("oil_group_zero_subtitle", "Kosten von 35 ml aller mitgebrachten Öle, höchste zuerst"),
                key="participant_oil_group_zero",
            ),
            {
                **participant_ranking_payload(
                    ranking_texts.get("average_overall_title", "Durchschnittliche Wertung"),
                    average_overall_values,
                    participants,
                    average_overall_ranks,
                    "Punkte",
                    ranking_texts.get("average_overall_subtitle", "höchste durchschnittliche Bewertung zuerst"),
                    key="participant_average_overall",
                    distributions={participant_id: stats["overall_values"] for participant_id, stats in participants.items()},
                ),
                "crowns": False,
            },
            participant_ranking_payload(
                ranking_texts.get("classification_title", "Klassifizierungsquote"),
                classification_values,
                participants,
                classification_ranks,
                "%",
                ranking_texts.get("classification_subtitle", "höchste Trefferquote zuerst"),
                key="participant_classification",
            ),
            participant_ranking_payload(
                ranking_texts.get("neutral_bias_title", "so neutral wie Raps"),
                neutral_bias_values,
                participants,
                neutral_bias_ranks,
                "Punkte",
                ranking_texts.get("neutral_bias_subtitle", "niedrige bereinigte Eigenöl-Abweichung zuerst"),
                key="participant_neutral_bias",
            ),
            {
                **participant_ranking_payload(
                    ranking_texts.get("host_favorite_title", "Gastgebers Liebling...söl?"),
                    host_distance_values,
                    participants,
                    host_distance_ranks,
                    "Punkte",
                    ranking_texts.get("host_favorite_subtitle", "Mittlere Distanz zur Wertung von Erik; niedrigste zuerst."),
                    key="participant_host_favorite",
                    distributions=host_distance_distributions,
                ),
                "crown_rank_offset": 1,
            },
            participant_ranking_payload(
                ranking_texts.get("comment_count_title", "Tinte für 1,99€/l"),
                comment_count_values,
                participants,
                comment_count_ranks,
                "Kommentare",
                ranking_texts.get("comment_count_subtitle", "meiste eindeutige Kommentare zuerst"),
                key="participant_comment_count",
            ),
            participant_ranking_payload(
                ranking_texts.get("comment_length_title", "Genießer"),
                comment_length_values,
                participants,
                comment_length_ranks,
                "Zeichen",
                ranking_texts.get("comment_length_subtitle", "durchschnittliche Kommentarlänge"),
                key="participant_comment_length",
                distributions={participant_id: stats["comment_lengths"] for participant_id, stats in participants.items()},
            ),
            {
                **participant_ranking_payload(
                    ranking_texts.get("bitter_title", "niedrigste Bitterkeits-Bewertungen"),
                    bitter_values,
                    participants,
                    bitter_ranks,
                    "Punkte",
                    ranking_texts.get("bitter_subtitle", "niedrigste Bitterkeit zuerst"),
                    key="participant_bitter",
                    distributions={participant_id: stats["bitter_values"] for participant_id, stats in participants.items()},
                ),
                "crowns": False,
            },
        ]

    if show_viewer_soulmate:
        viewer_ranking = {
            **participant_ranking_payload(
                ranking_texts.get("viewer_soulmate_title", "deine eigenen Seelenverwandte"),
                viewer_distance_values,
                participants,
                viewer_distance_ranks,
                "Punkte",
                format_text(
                    ranking_texts.get(
                        "viewer_soulmate_subtitle",
                        "{name}, du wolltest sicherlich auch deine Seelenverwandten auf diesem Symposium ausfindig machen! :D (Diese Rangliste siehst nur du.)",
                    ),
                    name=normalized_viewer_name,
                ),
                key="participant_viewer_soulmate",
                distributions=viewer_distance_distributions,
            ),
            "crowns": False,
        }
        host_ranking_index = next(
            (index for index, ranking in enumerate(rankings) if ranking.get("key") == "participant_host_favorite"),
            len(rankings) - 1,
        )
        rankings.insert(host_ranking_index + 1, viewer_ranking)

    ranking_order = {
        "participant_goat": 1,
        "participant_bitter": 2,
        "participant_classification": 3,
        "participant_spread": 4,
        "participant_average_overall": 5,
        "participant_neutral_bias": 6,
        "participant_comment_count": 7,
        "participant_comment_length": 8,
        "participant_host_favorite": 9,
        "price_accuracy": 10,
        "participant_oil_group_zero": 11,
        "participant_viewer_soulmate": 12,
    }
    rankings.sort(key=lambda ranking: ranking_order.get(str(ranking.get("key")), 999))

    crown_awards: dict[str, dict[str, int]] = {
        participant_id: {"gold": 0, "silver": 0, "bronze": 0}
        for participant_id in all_people
    }
    for ranking in rankings:
        if ranking.get("crowns") is False:
            continue
        crown_rank_offset = int(ranking.get("crown_rank_offset") or 0)
        for item in ranking.get("items", []):
            award_rank = int(item.get("rank") or 0) - crown_rank_offset
            awards = crown_awards.setdefault(item["participant_id"], {"gold": 0, "silver": 0, "bronze": 0})
            if award_rank == 1:
                awards["gold"] += 1
            elif award_rank == 2:
                awards["silver"] += 1
            elif award_rank == 3:
                awards["bronze"] += 1

    crown_scores: dict[str, float] = {
        participant_id: float(awards["gold"] * 3 + awards["silver"] * 2 + awards["bronze"])
        for participant_id, awards in crown_awards.items()
    }

    crown_ranking = {
            **participant_ranking_payload(
                ranking_texts.get("crown_score_title", "ölympisches Treppchen"),
                crown_scores,
                all_people,
                rank_map(crown_scores, reverse=True),
                "Kronenpunkte",
                ranking_texts.get("crown_score_subtitle", "Gold 3, Silber 2, Bronze 1 Punkt"),
                key="participant_crown_score",
            ),
            "crowns": True,
        }
    for item in crown_ranking.get("items", []):
        item["crown_awards"] = crown_awards.get(item["participant_id"], {"gold": 0, "silver": 0, "bronze": 0})
    neutral_ranking = next((ranking for ranking in rankings if ranking.get("key") == "participant_neutral_bias"), None)
    if neutral_ranking:
        for item in neutral_ranking.get("items", []):
            comparison = neutral_intermediates.get(item["participant_id"], {})
            peer_average = comparison.get("other_rating")
            own_average = comparison.get("own_rating")
            item["box"] = None
            item["value"] = round(neutral_bias_signed_values.get(item["participant_id"]), 2)
            item["intermediate_values"] = [
                {
                    "label": ranking_texts.get("neutral_peer_label", "andere Wertungen:"),
                    "value": round(peer_average, 2) if peer_average is not None else None,
                },
                {
                    "label": ranking_texts.get("neutral_own_label", "eigene Wertung:"),
                    "value": round(own_average, 2) if own_average is not None else None,
                },
            ]

    return {
        "rankings": rankings,
        "coordinate_oils": coordinate_oils,
        "crown_title": crown_ranking["title"],
        "crown_subtitle": crown_ranking["subtitle"],
        "crown_standings": [
            {
                "participant_id": item["participant_id"],
                "name": item["name"],
                "rank": item["rank"],
                "score": item["value"],
                "crowns": item.get("crown_awards", {}),
            }
            for item in crown_ranking.get("items", [])
        ],
    }


def result_payload(
    config: dict[str, Any],
    decryption: dict[str, Any],
    include_competitive: bool = False,
    viewer_id: int | None = None,
    personal_only: bool = False,
) -> dict[str, Any]:
    texts = load_texts()
    ranking_texts = {
        **dict_at(texts, ("/ergebnisse", "rankings")),
        **(dict_at(texts, ("/individuelle-ergebnisse", "rankings")) if personal_only else {}),
    }
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

    participant_stats: dict[str, dict[str, Any]] = {}
    overall_observations: list[dict[str, Any]] = []
    personal_by_oil: dict[str, dict[str, Any]] = {}

    with connect_db() as db:
        response_rows = db.execute(
            """
            SELECT sr.*, r.display_name, r.publish_name, r.publish_competitive_name, r.is_participant
            FROM survey_responses sr
            JOIN respondents r ON r.id = sr.respondent_id
            ORDER BY sr.updated_at DESC
            """
        ).fetchall()
        session_count = db.execute("SELECT COUNT(*) AS count FROM respondents").fetchone()["count"]
        named_participants = participant_admin_rows(db)
    all_tester_ids = {
        int(row["respondent_id"])
        for row in response_rows
        if bool(row["is_participant"])
        and sample_lookup.get((row["survey_id"], row["cipher"]))
        and survey_lookup.get(row["survey_id"])
    }
    if personal_only:
        response_rows = [
            row
            for row in response_rows
            if viewer_id is not None and int(row["respondent_id"]) == viewer_id
        ]
    participant_names = {str(item["id"]): item["display_name"] for item in named_participants}
    competition_people = {
        str(item["id"]): participant_stats_template(item["display_name"])
        for item in named_participants
    }
    anonymous_competitive_ids = {
        str(item["id"])
        for item in named_participants
        if item["is_participant"] and not item["publish_competitive_name"]
    }
    hidden_competitive_ids = set(anonymous_competitive_ids)
    if len(hidden_competitive_ids) < 2:
        hidden_competitive_ids.clear()

    tester_ids: set[int] = set()
    for row in response_rows:
        if not bool(row["is_participant"]):
            continue
        survey_id = row["survey_id"]
        cipher = row["cipher"]
        oil = sample_lookup.get((survey_id, cipher))
        survey = survey_lookup.get(survey_id)
        if not oil or not survey:
            continue

        oil_id = oil["id"]
        respondent_id = int(row["respondent_id"])
        participant_id = str(respondent_id)
        tester_ids.add(respondent_id)
        participant = participant_stats.setdefault(
            participant_id,
            participant_stats_template(str(row["display_name"] or "").strip() or f"Proband {participant_id}"),
        )
        oil_stats[oil_id]["response_count"] += 1
        try:
            answers = json.loads(row["answers_json"])
        except json.JSONDecodeError:
            answers = {}

        if viewer_id is not None and respondent_id == viewer_id:
            personal_oil = personal_by_oil.setdefault(
                oil_id,
                {"oil_id": oil_id, "name": oil["name"], "surveys": []},
            )
            personal_oil["surveys"].append(
                {
                    "survey_id": survey_id,
                    "title": comment_series_labels.get(survey_id, survey.get("title", survey_id)),
                    "answers": [
                        {
                            "field_id": field["id"],
                            "label": field.get("label", field["id"]),
                            "kind": field.get("kind", ""),
                            "value": answers.get(field["id"]),
                        }
                        for field in survey.get("fields", [])
                        if field["id"] in answers
                    ],
                }
            )

        overall = as_float(answers.get("overall"))
        if overall is not None:
            oil_stats[oil_id]["overall"].append(overall)
            oil_stats[oil_id]["overall_by_survey"][survey_id].append(overall)
            oil_stats[oil_id]["overall_by_respondent"].setdefault(respondent_id, []).append(overall)
            participant["overall_values"].append(overall)
            participant["vectors_by_oil"].setdefault(oil_id, {})[survey_id] = overall
            overall_observations.append(
                {
                    "participant_id": participant_id,
                    "oil_id": oil_id,
                    "survey_id": survey_id,
                    "value": overall,
                }
            )

        bitter = as_float(answers.get("bitter"))
        if bitter is not None and "bitter" in field_lookup.get(survey_id, {}):
            oil_stats[oil_id]["bitter"].append(bitter)
            participant["bitter_values"].append(bitter)

        price_guess = as_float(answers.get("price_guess"))
        if price_guess is not None and "price_guess" in field_lookup.get(survey_id, {}):
            oil_stats[oil_id]["price_guess"].append(price_guess)
            actual_price = as_float(oil.get("actual_price_per_liter_eur"))
            if actual_price is not None:
                deviation = price_guess - actual_price
                oil_stats[oil_id]["price_deviation"].append(deviation)
                participant["price_errors"].append(abs(deviation))
                if actual_price > 0:
                    oil_stats[oil_id]["price_deviation_percent"].append((deviation / actual_price) * 100)

        guess = answers.get("oil_guess")
        if guess:
            oil_stats[oil_id]["guess_total"] += 1
            participant["guess_total"] += 1
            if guess_matches_oil(guess, oil):
                oil_stats[oil_id]["guess_correct"] += 1
                participant["guess_correct"] += 1

        comment = str(answers.get("aroma_profile") or "").strip()
        if comment and comment.casefold() != no_comment_value:
            normalized_comment = re.sub(r"\s+", " ", comment.casefold()).strip()
            participant["comment_texts"].add(normalized_comment)
            participant["comment_lengths"].append(len(comment))
            oil_stats[oil_id]["comments"].append(
                {
                    "survey_id": survey_id,
                    "survey_title": survey.get("short_title", survey.get("title", survey_id)),
                    "series_label": comment_series_labels.get(survey_id, f"Testreihe {survey_numbers.get(survey_id, '?')}"),
                    "cipher": cipher,
                    "author": str(row["display_name"] or "").strip() if row["publish_name"] else "",
                    "is_viewer": viewer_id is not None and respondent_id == viewer_id,
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
    accuracy_ranks = rank_map(accuracy_values, reverse=True)
    oil_owner_ids: dict[str, list[str]] = {}
    for oil in oils:
        owner_ids = [str(owner_id) for owner_id in oil.get("owner_ids", [])]
        if not owner_ids and oil.get("brought_by_respondent_id") is not None:
            owner_ids = [str(oil["brought_by_respondent_id"])]
        if owner_ids:
            oil_owner_ids[oil["id"]] = owner_ids
    owner_oil_values: dict[str, list[float]] = {}
    for oil_id, owner_ids in oil_owner_ids.items():
        oil_average = average(oil_stats.get(oil_id, {}).get("overall", []))
        if oil_average is not None:
            for owner_id in owner_ids:
                owner_oil_values.setdefault(owner_id, []).append(oil_average)

    neutral_comparisons: dict[str, dict[str, list[float]]] = {}
    for observation in overall_observations:
        owner_ids = oil_owner_ids.get(observation["oil_id"], [])
        participant_id = observation["participant_id"]
        if not owner_ids or participant_id in hidden_competitive_ids:
            continue
        for owner_id in owner_ids:
            if owner_id in hidden_competitive_ids:
                continue
            comparison = neutral_comparisons.setdefault(owner_id, {"own_values": [], "peer_values": []})
            target = "own_values" if participant_id == owner_id else "peer_values"
            comparison[target].append(float(observation["value"]))

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
            ranking_payload(
                ranking_texts.get("accuracy_title", "Trefferquote"),
                accuracy_values,
                oils,
                accuracy_ranks,
                "%",
                ranking_texts.get("accuracy_subtitle", "höchste Quote zuerst"),
                key="guess_accuracy",
            ),
        ]
    )
    if personal_only:
        rankings = [ranking for ranking in rankings if ranking.get("key") != "spread"]
        accuracy_ranking = next(
            (ranking for ranking in rankings if ranking.get("key") == "guess_accuracy"),
            None,
        )
        if accuracy_ranking is not None:
            present_oil_ids = {item["oil_id"] for item in accuracy_ranking["items"]}
            accuracy_ranking["items"].extend(
                {
                    "oil_id": oil["id"],
                    "name": oil["name"],
                    "value": None,
                    "rank": None,
                    "box": None,
                }
                for oil in oils
                if oil["id"] not in present_oil_ids
            )
            accuracy_ranking["items"].sort(
                key=lambda item: (item["rank"] or 999, item["name"].casefold())
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
                "brought_by_respondent_id": oil.get("brought_by_respondent_id"),
                "brought_by_name": oil.get("brought_by_name", ""),
                "brought_by_names": oil.get("brought_by_names", []),
                "owner_ids": oil.get("owner_ids", []),
                "owners": oil.get("owners", []),
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
                "personal_surveys": personal_by_oil.get(oil_id, {}).get("surveys", []),
                "comments": sorted(
                    stat["comments"],
                    key=lambda comment: (
                        not comment.get("is_viewer", False),
                        survey_numbers.get(comment.get("survey_id"), 999)
                        if comment.get("is_viewer", False)
                        else 0,
                    ),
                ),
            }
        )

    total_guesses = sum(oil_stats[oil_id]["guess_total"] for oil_id in oil_order)
    correct_guesses = sum(oil_stats[oil_id]["guess_correct"] for oil_id in oil_order)
    total_samples = sum(len(survey.get("samples", [])) for survey in surveys)
    response_count = sum(oil_stats[oil_id]["response_count"] for oil_id in oil_order)
    comment_count = sum(len(oil_stats[oil_id]["comments"]) for oil_id in oil_order)
    expected_responses = len(tester_ids) * total_samples if tester_ids else 0

    payload = {
        "ok": True,
        "event_finished": event_is_finished(),
        "config": {
            "event": config.get("event", {}),
            "surveys": surveys,
        },
        "summary": {
            "tester_count": len(all_tester_ids),
            "oil_count": len(oils),
            "session_count": session_count,
            "response_count": response_count,
            "comment_count": comment_count,
            "competitor_count": sum(
                1
                for participant in named_participants
                if participant["display_name"] and participant["publish_competitive_name"]
            ),
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
        "personal_responses": sorted(personal_by_oil.values(), key=lambda item: item["name"].casefold()),
        "server_time": now_iso(),
    }
    if include_competitive:
        competitive_participants = {
            participant_id: ({**stats, "name": "anonym"} if participant_id in anonymous_competitive_ids else stats)
            for participant_id, stats in participant_stats.items()
            if participant_id not in hidden_competitive_ids
        }
        competitive_people = {
            participant_id: ({**stats, "name": "anonym"} if participant_id in anonymous_competitive_ids else stats)
            for participant_id, stats in competition_people.items()
            if participant_id not in hidden_competitive_ids
        }
        payload["competitive"] = competitive_payload(
            oils,
            surveys,
            competitive_participants,
            texts,
            owner_oil_values={key: value for key, value in owner_oil_values.items() if key not in hidden_competitive_ids},
            neutral_comparisons={key: value for key, value in neutral_comparisons.items() if key not in hidden_competitive_ids},
            all_people=competitive_people,
            viewer_name=participant_names.get(str(viewer_id)) if viewer_id is not None else None,
            viewer_vectors_by_oil=(participant_stats.get(str(viewer_id)) or {}).get("vectors_by_oil") if viewer_id is not None else None,
        )
    return payload


class OilSurveyHandler(BaseHTTPRequestHandler):
    server_version = "OilSurvey/2.0"

    def log_message(self, format: str, *args: Any) -> None:
        return

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
            if not respondent.display_name or event_mode() == EVENT_MODE_PREPARATION:
                send_html(self, 200, render_home(self, config, decryption, respondent), headers)
                return
            survey_id = path.rsplit("/", 1)[-1]
            send_html(self, 200, render_survey_page(survey_id, config), headers)
            return

        if path == "/ergebnisse":
            require_event_mode(EVENT_MODE_EVALUATION, "Ergebnisse sind erst in der Auswertung verfügbar.")
            send_html(self, 200, render_results_page(config))
            return

        if path == "/einzelne-oel-wertungen":
            require_event_mode(EVENT_MODE_EVALUATION, "Ergebnisse sind erst in der Auswertung verfügbar.")
            send_html(self, 200, render_results_page(config, "oils"))
            return

        if path == "/kompetitive-verkostung":
            require_event_mode(EVENT_MODE_EVALUATION, "Ergebnisse sind erst in der Auswertung verfügbar.")
            send_html(self, 200, render_results_page(config, "competitive"))
            return

        if path == "/individuelle-ergebnisse":
            require_event_mode(EVENT_MODE_EVALUATION, "Ergebnisse sind erst in der Auswertung verfügbar.")
            send_html(self, 200, render_results_page(config, "personal"))
            return

        if path == "/oel-auswahl":
            send_html(self, 200, render_oil_selection_page(config))
            return

        if path == "/api/bootstrap":
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            survey_id = query.get("survey_id", [""])[0]
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            if not respondent.display_name:
                raise ValueError("Bitte zuerst mit Name und PIN anmelden.")
            if event_mode() == EVENT_MODE_PREPARATION:
                raise ValueError("Die Umfragen sind während der Vorbereitung noch gesperrt.")
            send_json(self, 200, bootstrap_payload(config, decryption, respondent, survey_id), headers)
            return

        if path == "/api/participant":
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_json(self, 200, home_state_payload(config, decryption, respondent), headers)
            return

        if path == "/api/results":
            access_scope = query.get("access", query.get("mode", ["results"]))[0]
            include_competitive = access_scope == "competitive"
            personal_only = access_scope == "personal"
            viewer = get_or_create_respondent(self)
            require_event_mode(EVENT_MODE_EVALUATION, "Ergebnisse sind erst in der Auswertung verfügbar.")
            decryption = load_decryption(config)
            result = result_payload(
                config,
                decryption,
                include_competitive=include_competitive,
                viewer_id=viewer.id,
                personal_only=personal_only,
            )
            headers = {"Set-Cookie": cookie_header(viewer.token)} if viewer.is_new_cookie else None
            send_json(self, 200, result, headers)
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

        if path == "/api/submissions":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            decryption = load_decryption(config)
            respondent = get_or_create_respondent(self)
            headers = {"Set-Cookie": cookie_header(respondent.token)} if respondent.is_new_cookie else None
            send_json(self, 200, submit_oil_from_home(config, decryption, respondent, payload), headers)
            return

        if path == "/api/oils/add":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, add_oil(config, decryption, payload))
            return

        if path == "/api/oils/participants/add":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, add_participant_from_admin(config, decryption, payload))
            return

        if path == "/api/oils/participants/update":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, update_participant_from_admin(config, decryption, payload))
            return

        if path == "/api/oils/participants/reset-pin":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            send_json(self, 200, reset_participant_pin(config, payload))
            return

        if path == "/api/oils/participants/delete":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, delete_participant_from_admin(config, decryption, payload))
            return

        if path == "/api/oils/event-mode":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            set_event_mode(str(payload.get("mode", "")))
            decryption = load_decryption(config)
            send_json(self, 200, oil_selection_payload(config, decryption))
            return

        if path == "/api/oils/event-finished":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            set_event_finished(bool(payload.get("finished")))
            decryption = load_decryption(config)
            send_json(self, 200, oil_selection_payload(config, decryption))
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

        if path == "/api/oils/shuffle-ciphers":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, shuffle_oil_ciphers(config, decryption))
            return

        if path == "/api/oils/add-dummy-data":
            payload = read_json_body(self)
            if not isinstance(payload, dict):
                raise ValueError("Payload fehlt.")
            require_oil_password(payload.get("password"))
            decryption = load_decryption(config)
            send_json(self, 200, add_dummy_data(config, decryption))
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
            decryption = load_decryption(config)
            body, headers = save_participant(self, config, decryption, payload)
            send_json(self, 200, body, headers)
            return


        if path == "/api/participant/logout":
            decryption = load_decryption(config)
            body, headers = logout_participant(self, config, decryption)
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
    config = load_config()
    init_db(config)
    load_decryption(config)
    actual_port = find_open_port(host, port)
    server = ThreadingHTTPServer((host, actual_port), OilSurveyHandler)

    print(network_home_url(actual_port), flush=True)

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
