from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import main


class PhasePinAndSubmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.old_db_path = main.DB_PATH
        self.old_pins_path = main.PINS_PATH
        main.DB_PATH = Path(self.temporary_directory.name) / "test.sqlite3"
        main.PINS_PATH = Path(self.temporary_directory.name) / "PINs.txt"
        self.config = main.load_config()
        main.init_db(self.config)
        self.decryption = main.load_decryption(self.config)

    def tearDown(self) -> None:
        main.DB_PATH = self.old_db_path
        main.PINS_PATH = self.old_pins_path
        self.temporary_directory.cleanup()

    def add_participant(self, name: str) -> int:
        timestamp = main.now_iso()
        with main.connect_db() as db:
            cursor = db.execute(
                """
                INSERT INTO respondents (
                    token, ip, user_agent, display_name, publish_name,
                    publish_competitive_name, is_participant, created_at, updated_at
                ) VALUES (?, '127.0.0.1', 'test', ?, 1, 1, 1, ?, ?)
                """,
                (f"token-{name}", name, timestamp, timestamp),
            )
            return int(cursor.lastrowid)

    def respondent(self, participant_id: int, name: str) -> main.Respondent:
        return main.Respondent(
            id=participant_id,
            token=f"token-{name}",
            ip="127.0.0.1",
            user_agent="test",
            display_name=name,
            publish_name=True,
            publish_competitive_name=True,
            is_participant=True,
            is_new_cookie=False,
        )

    def test_three_event_modes_and_capabilities(self) -> None:
        participant_id = self.add_participant("Erik")
        respondent = self.respondent(participant_id, "Erik")

        self.assertEqual(main.EVENT_MODE_PREPARATION, main.event_mode())
        self.assertTrue(main.participant_payload(respondent)["capabilities"]["submit_oil"])

        main.set_event_mode(main.EVENT_MODE_EXECUTION)
        execution = main.participant_payload(respondent)
        self.assertTrue(execution["capabilities"]["open_surveys"])
        self.assertFalse(execution["capabilities"]["open_results"])

        main.set_event_mode(main.EVENT_MODE_EVALUATION)
        evaluation = main.participant_payload(respondent)
        self.assertTrue(evaluation["event_finished"])
        self.assertTrue(evaluation["capabilities"]["open_results"])
        self.assertFalse(evaluation["capabilities"]["submit_oil"])

    def test_home_visibility_follows_event_mode(self) -> None:
        participant_id = self.add_participant("Erik")
        respondent = self.respondent(participant_id, "Erik")

        preparation = main.render_home(None, self.config, self.decryption, respondent)
        self.assertIn('id="new-submission"', preparation)
        self.assertIn("survey-entry-link locked-link", preparation)
        self.assertNotIn("result-link-grid", preparation)

        main.set_event_mode(main.EVENT_MODE_EXECUTION)
        execution = main.render_home(None, self.config, main.load_decryption(self.config), respondent)
        self.assertIn('id="new-submission"', execution)
        self.assertIn("data-disabled='true'", execution)
        self.assertIn("result-entry-link locked-link", execution)
        self.assertIn('primary-link survey-entry-link"', execution)

        main.set_event_mode(main.EVENT_MODE_EVALUATION)
        evaluation = main.render_home(None, self.config, main.load_decryption(self.config), respondent)
        self.assertNotIn('id="new-submission"', evaluation)
        self.assertIn('primary-link survey-entry-link"', evaluation)
        self.assertIn('primary-link result-entry-link"', evaluation)

    def test_default_pin_and_reset_to_self_service_pin(self) -> None:
        participant_id = self.add_participant("Lea")
        main.PINS_PATH.write_text(f"{participant_id}\t1234\tLea\n", encoding="utf-8")
        with main.connect_db() as db:
            row = db.execute("SELECT * FROM respondents WHERE id = ?", (participant_id,)).fetchone()
            with self.assertRaisesRegex(ValueError, "PIN ist falsch"):
                main.authenticate_or_set_participant_pin(db, row, "0000")
            self.assertFalse(main.authenticate_or_set_participant_pin(db, row, "1234"))
            stored = db.execute("SELECT pin_hash FROM respondents WHERE id = ?", (participant_id,)).fetchone()["pin_hash"]
            self.assertTrue(main.verify_pin("1234", stored))
            self.assertFalse(main.verify_pin("0000", stored))

        main.reset_participant_pin(self.config, {"participant_id": participant_id})
        with main.connect_db() as db:
            row = db.execute("SELECT * FROM respondents WHERE id = ?", (participant_id,)).fetchone()
            self.assertTrue(main.authenticate_or_set_participant_pin(db, row, "9876"))
            stored = db.execute("SELECT pin_hash FROM respondents WHERE id = ?", (participant_id,)).fetchone()["pin_hash"]
            self.assertTrue(main.verify_pin("9876", stored))
            self.assertFalse(main.verify_pin("1234", stored))

    def test_home_submission_supports_multiple_owners(self) -> None:
        erik_id = self.add_participant("Erik")
        lea_id = self.add_participant("Lea")
        respondent = self.respondent(erik_id, "Erik")

        payload = main.submit_oil_from_home(
            self.config,
            self.decryption,
            respondent,
            {
                "name": "Gemeinsames Öl",
                "actual_price_per_liter_eur": 20,
                "is_olive_oil": True,
                "owner_ids": [erik_id, lea_id],
            },
        )
        self.assertEqual(1, len(payload["submissions"]))
        self.assertEqual("Erik & Lea", payload["submissions"][0]["brought_by_name"])

        main.set_event_mode(main.EVENT_MODE_EXECUTION)
        with self.assertRaisesRegex(ValueError, "Vorbereitung"):
            main.submit_oil_from_home(
                self.config,
                main.load_decryption(self.config),
                respondent,
                {
                    "name": "Zu spät",
                    "actual_price_per_liter_eur": 10,
                    "is_olive_oil": True,
                    "owner_ids": [erik_id],
                },
            )


if __name__ == "__main__":
    unittest.main()
