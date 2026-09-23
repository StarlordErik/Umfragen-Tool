from __future__ import annotations

import ast
from contextlib import closing
import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path

import main
from support.legacy_server import ROOT, load_app


def logical_dump(path: Path) -> str:
    with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as db:
        return "\n".join(db.iterdump())


class LegacyCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = load_app("reference")

    def test_assets_and_configuration_are_identical_to_reference(self):
        reference_root = Path(self.reference.__file__).parent
        current_root = main.LEGACY_ROOT
        for name in ["event_config.json", "ui_texts.json", "decryption.json", *[f"static/{name}" for name in ("home.js", "survey.js", "results.js", "oils.js", "styles.css")]]:
            with self.subTest(file=name):
                self.assertEqual((reference_root / name).read_text(encoding="utf-8"), (current_root / name).read_text(encoding="utf-8"))

    def test_every_business_function_and_http_handler_is_unchanged(self):
        def definitions(path):
            tree = ast.parse(Path(path).read_text(encoding="utf-8"))
            return {node.name: ast.dump(node) for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name != "require_oil_password"}
        self.assertEqual(definitions(self.reference.__file__), definitions(main.__file__))

    def test_existing_data_and_complete_results_survive_initialization(self):
        # SQLite online backup takes a consistent committed view, including WAL.
        source = ROOT / "data/umfragen.sqlite3"
        original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        previous_path = main.DB_PATH
        previous_clock = main.now_iso
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "existing.sqlite3"
            with closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)) as original, closing(sqlite3.connect(copy)) as target:
                original.backup(target)
            before = logical_dump(copy)
            try:
                main.DB_PATH = copy
                self.reference.DB_PATH = copy
                main.now_iso = self.reference.now_iso = lambda: "2026-01-01T12:00:00+00:00"
                config = main.load_config()
                main.init_db(config)
                self.assertTrue(before == logical_dump(copy), 'Legacy initialization changed existing records/schema')
                with main.connect_db() as db:
                    self.assertEqual('ok', db.execute('PRAGMA integrity_check').fetchone()[0])
                    self.assertEqual([], db.execute('PRAGMA foreign_key_check').fetchall())
                    participant_ids = [row[0] for row in db.execute('SELECT id FROM respondents')]
                for viewer in [None, *participant_ids]:
                    for competitive, personal in [(False, False), (True, False), (False, True)]:
                        options = dict(include_competitive=competitive, viewer_id=viewer, personal_only=personal)
                        self.assertTrue(
                            self.reference.result_payload(config, self.reference.load_decryption(config), **options) ==
                            main.result_payload(config, main.load_decryption(config), **options),
                            'Result payload differs from original; inspect locally without printing private data.',
                        )
                self.assertTrue(before == logical_dump(copy), 'Reading results changed records/schema')
            finally:
                main.DB_PATH = previous_path
                main.now_iso = previous_clock
        self.assertEqual(original_hash, hashlib.sha256(source.read_bytes()).hexdigest())
