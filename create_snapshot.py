from __future__ import annotations

import argparse
import html
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import main as survey_app


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "Oliven-Symposium-Momentaufnahme.html"


SNAPSHOT_HOME_JS = r"""
(() => {
  const select = document.getElementById("snapshot-participant");
  const state = document.getElementById("participant-state");
  const pinPanel = document.getElementById("snapshot-pin-panel");
  const pinInput = document.getElementById("snapshot-pin");
  const pinButton = document.getElementById("snapshot-pin-submit");
  const pinError = document.getElementById("snapshot-pin-error");
  const links = [...document.querySelectorAll(".survey-entry-link")];
  let pendingParticipantId = "";

  function applyAccess(participantId) {
    const selected = Boolean(participantId);
    for (const link of links) {
      link.classList.toggle("locked-link", !selected);
      link.setAttribute("aria-disabled", selected ? "false" : "true");
    }
    if (state) {
      state.textContent = selected
        ? "Du kannst nun auf eine Momentaufnahme der Oliven-Symposium-Daten zugreifen, als wärst du bei der Auswertung da gewesen! =D"
        : "Bitte einen vorhandenen Probanden auswählen, um dessen Wertungsbögen zu öffnen.";
    }
  }

  function hidePinPanel() {
    pendingParticipantId = "";
    if (pinPanel) pinPanel.hidden = true;
    if (pinInput) pinInput.value = "";
    if (pinError) pinError.textContent = "";
  }

  function selectParticipant(participantId) {
    const candidate = String(participantId || "");
    if (!candidate) {
      parent.snapshotSetParticipant("");
      hidePinPanel();
      applyAccess("");
      return;
    }
    if (!parent.snapshotParticipantNeedsPin(candidate)) {
      parent.snapshotSetParticipant(candidate);
      hidePinPanel();
      applyAccess(candidate);
      return;
    }
    pendingParticipantId = candidate;
    parent.snapshotSetParticipant("");
    if (pinPanel) pinPanel.hidden = false;
    if (pinError) pinError.textContent = "";
    if (state) state.textContent = "Bitte die persönliche 4-stellige PIN eingeben.";
    applyAccess("");
    if (select) select.value = candidate;
    pinInput?.focus();
  }

  function submitPin() {
    const pin = String(pinInput?.value || "").trim();
    if (!pendingParticipantId || !parent.snapshotVerifyParticipantPin(pendingParticipantId, pin)) {
      if (pinError) pinError.textContent = "PIN ist falsch.";
      pinInput?.focus();
      pinInput?.select();
      return;
    }
    parent.snapshotSetParticipant(pendingParticipantId);
    const selectedId = pendingParticipantId;
    hidePinPanel();
    if (select) select.value = selectedId;
    applyAccess(selectedId);
  }

  select?.addEventListener("change", () => selectParticipant(select.value));
  pinButton?.addEventListener("click", submitPin);
  pinInput?.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
    if (pinError) pinError.textContent = "";
  });
  pinInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitPin();
  });

  document.addEventListener("click", (event) => {
    const locked = event.target.closest(".survey-entry-link.locked-link");
    if (!locked) return;
    event.preventDefault();
    state?.classList.add("error");
    select?.focus();
  });

  const selectedParticipantId = parent.snapshotSelectedParticipant();
  if (select) select.value = selectedParticipantId;
  applyAccess(selectedParticipantId);
})();
"""


FRAME_BRIDGE_JS = r"""
(() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  window.fetch = async (input, options = {}) => {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    const payload = parent.snapshotApi(rawUrl, options);
    return new Response(JSON.stringify(clone(payload)), {
      status: payload?.ok === false ? 400 : 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("/")) return;
    event.preventDefault();
    parent.snapshotNavigate(href);
  }, true);
})();
"""


def json_for_html(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def pin_digest(value: str) -> str:
    digest = 2_166_136_261
    for byte in value.encode("ascii"):
        digest ^= byte
        digest = (digest * 16_777_619) & 0xFFFFFFFF
    return f"{digest:08x}"


def load_existing_pins(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t", 2)
        if len(parts) < 2:
            continue
        participant_id, pin = parts[0].strip(), parts[1].strip()
        if participant_id.isdigit() and len(pin) == 4 and pin.isdigit():
            result[participant_id] = pin
    return result


def participant_pins(participants: list[dict[str, Any]], pins_path: Path) -> dict[str, str]:
    existing = load_existing_pins(pins_path)
    assignments: dict[str, str] = {}
    used: set[str] = set()
    protected = [
        participant
        for participant in participants
        if str(participant.get("display_name") or "").strip().casefold() != "erik"
    ]
    if len(protected) > 10_000:
        raise ValueError("Für mehr als 10.000 Probanden reichen vierstellige PINs nicht aus.")
    for participant in protected:
        participant_id = str(participant["id"])
        pin = existing.get(participant_id, "")
        if len(pin) != 4 or not pin.isdigit() or pin in used:
            pin = ""
            while not pin or pin in used:
                pin = f"{secrets.randbelow(10_000):04d}"
        assignments[participant_id] = pin
        used.add(pin)
    return assignments


def write_pin_list(path: Path, participants: list[dict[str, Any]], assignments: dict[str, str]) -> None:
    lines = [
        "VERTRAULICH – PIN-Liste zur Oliven-Symposium-Momentaufnahme",
        "Probanden-ID\tPIN\tName",
    ]
    for participant in participants:
        participant_id = str(participant["id"])
        name = str(participant.get("display_name") or "")
        lines.append(f"{participant_id}\t{assignments.get(participant_id, 'PIN-frei')}\t{name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def respondent_from_row(row: Any) -> survey_app.Respondent:
    return survey_app.Respondent(
        id=int(row["id"]),
        token="",
        ip="",
        user_agent="",
        display_name=str(row["display_name"]) if row["display_name"] else None,
        publish_name=bool(row["publish_name"]),
        publish_competitive_name=bool(row["publish_competitive_name"]),
        is_participant=bool(row["is_participant"]),
        is_new_cookie=False,
    )


def snapshot_database_data() -> tuple[list[dict[str, Any]], list[Any]]:
    with survey_app.connect_db() as db:
        rows = db.execute(
            """
            SELECT id, display_name, publish_name, publish_competitive_name,
                   is_participant, created_at, updated_at
            FROM respondents
            ORDER BY COALESCE(display_name, '') COLLATE NOCASE, id
            """
        ).fetchall()
        response_rows = db.execute(
            """
            SELECT respondent_id, survey_id, cipher, answers_json, created_at, updated_at
            FROM survey_responses
            ORDER BY respondent_id, survey_id, cipher
            """
        ).fetchall()

    responses_by_respondent: dict[int, list[dict[str, Any]]] = {}
    for response in response_rows:
        responses_by_respondent.setdefault(int(response["respondent_id"]), []).append(
            {
                "survey_id": str(response["survey_id"]),
                "cipher": str(response["cipher"]),
                "answers": json.loads(response["answers_json"]),
                "created_at": str(response["created_at"]),
                "updated_at": str(response["updated_at"]),
            }
        )

    archived = [
        {
            "id": int(row["id"]),
            "display_name": str(row["display_name"] or ""),
            "publish_name": bool(row["publish_name"]),
            "publish_competitive_name": bool(row["publish_competitive_name"]),
            "is_participant": bool(row["is_participant"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "responses": responses_by_respondent.get(int(row["id"]), []),
        }
        for row in rows
    ]
    return archived, rows


def home_page(config: dict[str, Any], runtime: dict[str, Any], participants: list[dict[str, Any]]) -> dict[str, str]:
    texts = survey_app.load_texts()
    cards = []
    for survey in runtime["surveys"]:
        cards.append(
            f"""
            <article class="link-card" style="--accent:{html.escape(survey.get('accent', '#277c61'))}">
              <div>
                <p class="eyebrow">{html.escape(survey.get('short_title', 'Testreihe'))}</p>
                <h2>{html.escape(survey.get('title', survey['id']))}</h2>
              </div>
              <a class="primary-link survey-entry-link locked-link" href="/umfrage/{html.escape(str(survey['id']))}" aria-disabled="true">{html.escape(survey_app.text_at(texts, ('global', 'open_button'), 'Öffnen'))}</a>
            </article>
            """
        )

    participant_options = "".join(
        f'<option value="{participant["id"]}">{html.escape(participant["display_name"])}</option>'
        for participant in participants
    )
    page_title = survey_app.route_text(texts, "/", "page_title", "Oliven-Symposium")
    subtitle = survey_app.route_text(texts, "/", "subtitle", "")
    subtitle_markup = f'<p class="topbar-subtitle">{html.escape(subtitle)}</p>' if subtitle else ""
    return {
        "title": page_title,
        "body": f"""
        <main id="home-app" class="page">
          <section class="topbar">
            <div>
              <h1>{html.escape(survey_app.route_text(texts, '/', 'heading', page_title))}</h1>
              {subtitle_markup}
            </div>
          </section>

          <section class="setup-editor participant-panel">
            <div class="participant-panel-heading">
              <h2>{html.escape(survey_app.route_text(texts, '/', 'registration_title', 'Anmeldung'))}</h2>
            </div>
            <div class="participant-form snapshot-participant-form">
              <label class="participant-name-field" for="snapshot-participant">Vorhandenen Probanden auswählen</label>
              <select id="snapshot-participant">
                <option value="">Bitte auswählen</option>
                {participant_options}
              </select>
              <div id="snapshot-pin-panel" class="snapshot-pin-panel" hidden>
                <label for="snapshot-pin">Persönliche 4-stellige PIN</label>
                <input id="snapshot-pin" type="password" inputmode="numeric" pattern="[0-9]{{4}}" maxlength="4" autocomplete="one-time-code">
                <button id="snapshot-pin-submit" class="save-button" type="button">Proband auswählen</button>
                <p id="snapshot-pin-error" class="notice error" aria-live="polite"></p>
              </div>
            </div>
            <p class="notice" id="participant-state"></p>
          </section>

          <section class="link-grid result-link-grid">
            <article class="link-card result-link-card" style="--accent:#f3f5f7;--accent-contrast:#111827;--accent-hover-contrast:#111827">
              <div>
                <p class="eyebrow">{html.escape(survey_app.route_text(texts, '/', 'results_eyebrow', 'Auswertung'))}</p>
                <h2>{html.escape(survey_app.route_text(texts, '/', 'results_title', 'Ergebnisse'))}</h2>
              </div>
              <a class="primary-link" href="/ergebnisse">{html.escape(survey_app.route_text(texts, '/', 'results_open_button', 'Öffnen'))}</a>
            </article>
          </section>

          <section class="link-grid survey-link-grid">{''.join(cards)}</section>
        </main>
        """,
    }


def survey_pages(config: dict[str, Any], runtime: dict[str, Any]) -> dict[str, dict[str, str]]:
    texts = survey_app.load_texts()
    pages: dict[str, dict[str, str]] = {}
    for survey in runtime["surveys"]:
        survey_id = str(survey["id"])
        visible_title = survey.get("short_title") or survey.get("title") or survey_id
        pages[survey_id] = {
            "title": f"{visible_title} · {config.get('event', {}).get('title', 'Oliven-Symposium')}",
            "body": f"""
              <main id="survey-app" class="page survey-page">
                <div class="loading-panel">{html.escape(survey_app.route_text(texts, '/umfrage/:id', 'loading', 'Umfrage wird geladen...'))}</div>
              </main>
            """,
        }
    return pages


def result_pages(config: dict[str, Any]) -> dict[str, dict[str, str]]:
    texts = survey_app.load_texts()
    definitions = {
        "rankings": ("/ergebnisse", "Ergebnisse"),
        "oils": ("/einzelne-oel-wertungen", "Aufschlüsselung je Öl"),
        "competitive": ("/kompetitive-verkostung", "Symposium-Minispiel"),
        "personal": ("/individuelle-ergebnisse", "Individuelle Ergebnisse"),
    }
    pages: dict[str, dict[str, str]] = {}
    for mode, (route, fallback) in definitions.items():
        page_title = survey_app.route_text(texts, route, "page_title", fallback)
        pages[mode] = {
            "title": f"{page_title} · {config.get('event', {}).get('title', 'Oliven-Symposium')}",
            "body": f"""
              <main id="results-app" class="page results-page">
                <div class="loading-panel">{html.escape(survey_app.route_text(texts, route, 'loading', 'Ergebnisse werden geladen...'))}</div>
              </main>
            """,
        }
    return pages


def build_snapshot_payload(db_path: Path) -> dict[str, Any]:
    survey_app.DB_PATH = db_path.resolve()
    config = survey_app.load_config()
    survey_app.init_db(config)
    decryption = survey_app.load_decryption(config)

    # Ein Snapshot ist unabhängig vom Live-Status immer abgeschlossen und schreibgeschützt.
    survey_app.event_is_finished = lambda db=None: True
    runtime = survey_app.public_runtime_config(config, decryption)
    archived_respondents, respondent_rows = snapshot_database_data()

    selectable_rows = [row for row in respondent_rows if str(row["display_name"] or "").strip()]
    participants = [
        {
            "id": str(row["id"]),
            "display_name": str(row["display_name"]),
            "publish_name": bool(row["publish_name"]),
            "publish_competitive_name": bool(row["publish_competitive_name"]),
            "is_participant": bool(row["is_participant"]),
        }
        for row in selectable_rows
    ]

    bootstraps: dict[str, dict[str, Any]] = {}
    results: dict[str, dict[str, Any]] = {}
    individual_results: dict[str, dict[str, Any]] = {}
    for row in selectable_rows:
        respondent = respondent_from_row(row)
        participant_id = str(respondent.id)
        bootstraps[participant_id] = {
            str(survey["id"]): survey_app.bootstrap_payload(config, decryption, respondent, str(survey["id"]))
            for survey in runtime["surveys"]
        }
        results[participant_id] = survey_app.result_payload(
            config,
            decryption,
            include_competitive=True,
            viewer_id=respondent.id,
        )
        individual_results[participant_id] = survey_app.result_payload(
            config,
            decryption,
            viewer_id=respondent.id,
            personal_only=True,
        )

    results[""] = survey_app.result_payload(config, decryption, include_competitive=True, viewer_id=None)
    individual_results[""] = survey_app.result_payload(
        config,
        decryption,
        viewer_id=None,
        personal_only=True,
    )
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "snapshot": {
            "created_at": created_at,
            "source_database": db_path.name,
            "event_finished": True,
            "read_only": True,
        },
        "ui_texts": survey_app.load_texts(),
        "participants": participants,
        "bootstraps": bootstraps,
        "results": results,
        "individual_results": individual_results,
        "archive": {
            "respondents": archived_respondents,
            "oils": decryption["oils"],
        },
        "pages": {
            "home": home_page(config, runtime, participants),
            "surveys": survey_pages(config, runtime),
            "results": result_pages(config),
        },
        "assets": {
            "styles": (survey_app.STATIC_DIR / "styles.css").read_text(encoding="utf-8"),
            "survey_js": (survey_app.STATIC_DIR / "survey.js").read_text(encoding="utf-8"),
            "results_js": (survey_app.STATIC_DIR / "results.js").read_text(encoding="utf-8"),
            "home_js": SNAPSHOT_HOME_JS,
            "bridge_js": FRAME_BRIDGE_JS,
        },
    }


def render_snapshot(payload: dict[str, Any]) -> str:
    encoded = json_for_html(payload)
    created_at = html.escape(payload["snapshot"]["created_at"])
    return f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#121417">
  <meta name="generator" content="Umfragen-Tool Snapshot {created_at}">
  <title>Oliven-Symposium · Snapshot</title>
  <style>
    html, body {{ width: 100%; height: 100%; margin: 0; overflow: hidden; background: #121417; }}
    #snapshot-frame {{ display: block; width: 100%; height: 100%; border: 0; background: #121417; }}
  </style>
</head>
<body>
  <iframe id="snapshot-frame" title="Oliven-Symposium Snapshot"></iframe>
  <script id="snapshot-data" type="application/json">{encoded}</script>
  <script>
    const SNAPSHOT = JSON.parse(document.getElementById("snapshot-data").textContent);
    const frame = document.getElementById("snapshot-frame");
    let memoryParticipant = "";

    function storedParticipant() {{
      return memoryParticipant;
    }}

    function writeParticipant(value) {{
      memoryParticipant = value;
    }}

    function validParticipant(value) {{
      const normalized = String(value || "");
      return SNAPSHOT.participants.some((participant) => participant.id === normalized) ? normalized : "";
    }}

    window.snapshotSelectedParticipant = () => validParticipant(storedParticipant());
    window.snapshotSetParticipant = (value) => writeParticipant(validParticipant(value));

    function snapshotPinDigest(value) {{
      let digest = 2166136261;
      for (let index = 0; index < value.length; index += 1) {{
        digest ^= value.charCodeAt(index);
        digest = Math.imul(digest, 16777619) >>> 0;
      }}
      return digest.toString(16).padStart(8, "0");
    }}

    window.snapshotParticipantNeedsPin = (participantId) => Boolean(SNAPSHOT.pin_gate?.hashes?.[String(participantId)]);
    window.snapshotVerifyParticipantPin = (participantId, pin) => {{
      const normalizedId = validParticipant(participantId);
      const normalizedPin = String(pin || "");
      if (!normalizedId || !/^\\d{{4}}$/.test(normalizedPin)) return false;
      const expected = SNAPSHOT.pin_gate?.hashes?.[normalizedId];
      if (!expected) return true;
      return snapshotPinDigest(`${{SNAPSHOT.pin_gate.salt}}:${{normalizedId}}:${{normalizedPin}}`) === expected;
    }};

    window.snapshotApi = (rawUrl, options = {{}}) => {{
      const url = new URL(rawUrl, "https://snapshot.invalid");
      const participantId = window.snapshotSelectedParticipant();
      if ((options.method || "GET").toUpperCase() !== "GET") {{
        return {{ ok: false, error: "Der Snapshot ist schreibgeschützt." }};
      }}
      if (url.pathname === "/api/participant") {{
        const participant = SNAPSHOT.participants.find((item) => item.id === participantId);
        return {{ ok: true, participant: participant || {{ display_name: "" }}, event_finished: true }};
      }}
      if (url.pathname === "/api/bootstrap") {{
        const surveyId = url.searchParams.get("survey_id") || "";
        return SNAPSHOT.bootstraps[participantId]?.[surveyId] || {{ ok: false, error: "Bitte zuerst einen Probanden auswählen." }};
      }}
      if (url.pathname === "/api/results") {{
        if (url.searchParams.get("access") === "personal") {{
          return SNAPSHOT.individual_results[participantId] || SNAPSHOT.individual_results[""];
        }}
        return SNAPSHOT.results[participantId] || SNAPSHOT.results[""];
      }}
      return {{ ok: false, error: "Diese Funktion ist im Snapshot nicht verfügbar." }};
    }};

    function pageForRoute(route) {{
      if (route === "/") return {{ ...SNAPSHOT.pages.home, kind: "home" }};
      if (route.startsWith("/umfrage/")) {{
        const surveyId = route.slice("/umfrage/".length);
        const page = SNAPSHOT.pages.surveys[surveyId];
        return page ? {{ ...page, kind: "survey", surveyId }} : null;
      }}
      const resultModes = {{
        "/ergebnisse": "rankings",
        "/einzelne-oel-wertungen": "oils",
        "/kompetitive-verkostung": "competitive",
        "/individuelle-ergebnisse": "personal",
      }};
      const mode = resultModes[route];
      return mode ? {{ ...SNAPSHOT.pages.results[mode], kind: "results", mode }} : null;
    }}

    function safeScript(source) {{
      return String(source || "").replaceAll("<" + "/script", "<\\\\/script");
    }}

    function frameDocument(page) {{
      const setup = [
        "window.UI_TEXTS = " + JSON.stringify(SNAPSHOT.ui_texts) + ";",
        "window.SNAPSHOT_PAGE = " + JSON.stringify({{ kind: page.kind }}) + ";",
        page.kind === "survey" ? "window.SURVEY_ID = " + JSON.stringify(page.surveyId) + ";" : "",
        page.kind === "results" ? "window.RESULTS_MODE = " + JSON.stringify(page.mode) + ";" : "",
      ].join("\\n");
      const application = page.kind === "home"
        ? SNAPSHOT.assets.home_js
        : page.kind === "survey"
          ? SNAPSHOT.assets.survey_js
          : SNAPSHOT.assets.results_js;
      return '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="theme-color" content="#121417"><title>' + page.title.replaceAll('<', '&lt;') + '</title>' +
        '<style>' + SNAPSHOT.assets.styles + '\\n.snapshot-participant-form select{{width:100%;min-height:46px;margin-top:8px}}.snapshot-pin-panel{{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end;margin-top:12px}}.snapshot-pin-panel[hidden]{{display:none}}.snapshot-pin-panel label{{grid-column:1/-1}}.snapshot-pin-panel input{{width:100%;min-height:46px;font-size:1.1rem;letter-spacing:.25em;text-align:center}}.snapshot-pin-panel .notice{{grid-column:1/-1;margin:0}}@media(max-width:600px){{.snapshot-pin-panel{{grid-template-columns:1fr}}.snapshot-pin-panel .save-button{{width:100%}}}}</style></head><body>' +
        page.body + '<script>' + safeScript(setup) + '<\\/script>' +
        '<script>' + safeScript(SNAPSHOT.assets.bridge_js) + '<\\/script>' +
        '<script>' + safeScript(application) + '<\\/script></body></html>';
    }}

    function currentRoute() {{
      const route = decodeURIComponent(window.location.hash.slice(1) || "/").split("?")[0];
      return route.startsWith("/") ? route : "/";
    }}

    function renderRoute() {{
      let route = currentRoute();
      if (route.startsWith("/umfrage/") && !window.snapshotSelectedParticipant()) route = "/";
      const page = pageForRoute(route) || pageForRoute("/");
      document.title = page.title + " · Snapshot";
      frame.srcdoc = frameDocument(page);
    }}

    window.snapshotNavigate = (route) => {{
      const normalized = String(route || "/").split("?")[0];
      if (currentRoute() === normalized) renderRoute();
      else window.location.hash = normalized;
    }};

    window.addEventListener("hashchange", renderRoute);
    renderRoute();
  </script>
</body>
</html>
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Erzeugt eine eigenständige, schreibgeschützte HTML-Momentaufnahme.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"Zieldatei (Standard: {DEFAULT_OUTPUT.name})")
    parser.add_argument("--db", type=Path, default=survey_app.DB_PATH, help="Zu sichernde SQLite-Datenbank")
    parser.add_argument("--pins-output", type=Path, help="Zieldatei der vertraulichen PIN-Liste")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output.resolve()
    pins_output = (args.pins_output or output.with_name(f"{output.stem}-PINs.txt")).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = build_snapshot_payload(args.db)
    assignments = participant_pins(payload["participants"], pins_output)
    pin_salt = secrets.token_hex(16)
    payload["pin_gate"] = {
        "salt": pin_salt,
        "hashes": {
            participant_id: pin_digest(f"{pin_salt}:{participant_id}:{pin}")
            for participant_id, pin in assignments.items()
        },
    }
    output.write_text(render_snapshot(payload), encoding="utf-8")
    write_pin_list(pins_output, payload["participants"], assignments)
    print(f"Snapshot erstellt: {output}")
    print(f"Vertrauliche PIN-Liste: {pins_output}")
    print(f"Probanden: {len(payload['archive']['respondents'])}, Öle/Slots: {len(payload['archive']['oils'])}")


if __name__ == "__main__":
    main()
