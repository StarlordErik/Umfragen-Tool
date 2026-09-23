"""Deterministic, disposable fixture server; never opens the real project database."""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def reference_source() -> Path:
    commit = json.loads((ROOT / "tests/support/reference.json").read_text())["commit"]
    target = ROOT / ".artifacts/reference" / commit
    files = ["main.py", "event_config.json", "decryption.json", "ui_texts.json", "create_snapshot.py"]
    files += [f"static/{name}" for name in ("home.js", "survey.js", "results.js", "oils.js", "styles.css")]
    for name in files:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(subprocess.check_output(["git", "show", f"{commit}:{name}"], cwd=ROOT))
    return target


def load_app(kind: str):
    if kind == "reference":
        source = reference_source()
        spec = importlib.util.spec_from_file_location("reference_olive", source / "main.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    import main
    return main


def seed(app, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    # Only our explicitly named test file is replaced.
    app.DB_PATH = directory / "fixture.sqlite3"
    for suffix in ("", "-wal", "-shm"):
        app.DB_PATH.with_name(app.DB_PATH.name + suffix).unlink(missing_ok=True)
    app.PINS_PATH = directory / "missing-pins.txt"
    app.OIL_SELECTION_PASSWORD = "fixture-admin"
    app.now_iso = lambda: "2026-01-01T12:00:00+00:00"
    config_copy = directory / "event_config.json"
    shutil.copyfile(app.CONFIG_PATH, config_copy)
    app.CONFIG_PATH = config_copy
    config = app.load_config()
    app.init_db(config)
    with app.connect_db() as db:
        for index, name in enumerate(("Testperson Alpha", "Testperson Beta", "Testperson Gamma"), 1):
            db.execute("""INSERT INTO respondents
                (id,token,ip,user_agent,display_name,publish_name,publish_competitive_name,
                 is_participant,pin_hash,created_at,updated_at)
                VALUES (?,?, '127.0.0.1','fixture',?,1,1,1,?,?,?)""",
                (index, f"fixture-token-{index}", name, app.hash_pin("1234", salt="00112233445566778899aabbccddeeff"), app.now_iso(), app.now_iso()))
    for index, name in enumerate(("Testöl Grün", "Testöl Gold", "Testöl Neutral")):
        app.add_oil(config, app.load_decryption(config), {
            "name": name, "actual_price_per_liter_eur": 10 + index * 10,
            "is_olive_oil": index < 2, "owner_ids": [index + 1],
        })
    app.set_event_mode(app.EVENT_MODE_EXECUTION)
    decryption = app.load_decryption(config)
    for participant_id in range(1, 4):
        respondent = app.Respondent(participant_id, f"fixture-token-{participant_id}", "127.0.0.1",
                                    "fixture", f"Testperson {participant_id}", True, True, True, False)
        for survey in config["surveys"]:
            for index, sample in enumerate(app.survey_samples(config, decryption, survey)):
                app.upsert_response(config, decryption, respondent, {
                    "survey_id": survey["id"], "cipher": sample["cipher"],
                    "answers": {"oil_guess": "Olivenöl", "overall": index + participant_id - 3,
                                "bitter": index, "price_guess": 12 + index * 8,
                                "aroma_profile": "Fruchtig und frisch."},
                })
    app.set_event_mode(app.EVENT_MODE_PREPARATION)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("reference", "current"), required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    app = load_app(args.kind)
    seed(app, ROOT / ".artifacts/e2e" / args.kind)
    if args.kind == "current":
        from platform_runtime.olive import handler_for
        handler = handler_for(app)
    else:
        handler = app.OilSurveyHandler
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Fixture {args.kind}: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
