const app = document.getElementById("oil-selection-app");

const state = {
  password: "",
  payload: null,
  openParticipantCards: new Set(),
  openOilCards: new Set(),
  openConfigGroups: new Set(),
};

const greekSymbols = {
  Alpha: "α",
  Beta: "β",
  Gamma: "γ",
  Delta: "δ",
  Epsilon: "ε",
  Zeta: "ζ",
  Eta: "η",
  Theta: "θ",
  Iota: "ι",
  Kappa: "κ",
  Lambda: "λ",
  Mu: "μ",
  Nu: "ν",
  Xi: "ξ",
  Omikron: "ο",
  Pi: "π",
  Rho: "ρ",
  Sigma: "σ",
  Tau: "τ",
  Ypsilon: "υ",
  Phi: "φ",
  Chi: "χ",
  Psi: "ψ",
  Omega: "ω",
};

function text(path, fallback = "") {
  let node = window.UI_TEXTS || {};
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === "string" ? node : fallback;
}

function globalText(key, fallback = "") {
  return text(["global", key], fallback);
}

function routeText(key, fallback = "") {
  return text(["/oel-auswahl", key], fallback);
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const euro = (value) => (value === null || value === undefined ? "Realpreis unbekannt" : `${Number(value).toFixed(0)} €/l`);

function displayCipher(cipher, cipherSet = "") {
  if (cipherSet === "greek") return greekSymbols[cipher] || cipher;
  return cipher || "-";
}

function participantOptions(selectedIds = []) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : [selectedIds]).map((value) => String(value)));
  const participants = state.payload?.participants || [];
  return participants
    .map((participant) => {
      const value = String(participant.id);
      return `<option value="${escapeHtml(value)}" ${selected.has(value) ? "selected" : ""}>${escapeHtml(participant.display_name)}</option>`;
    })
    .join("");
}

function ownerName(value) {
  return value || routeText("owner_empty", "nicht zugeordnet");
}

function selectedParticipantIds(select) {
  return [...(select?.selectedOptions || [])]
    .map((option) => Number(option.value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function eventModeNotice(mode) {
  const notices = {
    preparation: routeText("event_preparation_notice", "Anmeldung und Öl-Einreichung sind geöffnet; Umfragen und Ergebnisse sind gesperrt."),
    execution: routeText("event_execution_notice", "Die Umfragen laufen; neue Öle und Ergebnisse sind gesperrt."),
    evaluation: routeText("event_evaluation_notice", "Die Umfragen sind schreibgeschützt und alle Ergebnisse freigegeben."),
  };
  return notices[mode] || "";
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="admin-header">
      <div>
        <p class="eyebrow">${escapeHtml(routeText("protected_eyebrow", "Geschützt"))}</p>
        <h1>${escapeHtml(routeText("heading", "Öl-Auswahl"))}</h1>
        <p class="lead">${escapeHtml(routeText("login_lead", "Passwort eingeben, um Öle und Wertungen zu verwalten."))}</p>
      </div>
      <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
    </section>

    <form class="setup-editor oil-login-panel" action="/oel-auswahl/login" method="post" data-login-form="oil-selection">
      <label class="visually-hidden" for="oil-selection-login-realm">
        Anmeldebereich
        <input
          id="oil-selection-login-realm"
          name="oil-selection-login-realm"
          type="text"
          value="oel-auswahl"
          autocomplete="username"
          tabindex="-1"
        >
      </label>
      <label for="oil-password">
        ${escapeHtml(globalText("password_label", "Passwort"))}
        <input id="oil-password" name="oil-selection-password" type="password" autocomplete="section-oil-selection current-password" autofocus>
      </label>
      <div class="setup-actions">
        <p class="notice ${error ? "error" : ""}">${escapeHtml(error || " ")} </p>
        <button class="save-button" type="button" data-action="login">${escapeHtml(globalText("login_button", "Öffnen"))}</button>
      </div>
    </form>
  `;
}

async function loadOils() {
  const response = await fetch(`/api/oils?password=${encodeURIComponent(state.password)}`, {
    credentials: "same-origin",
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || routeText("load_failed", "Öl-Auswahl konnte nicht geladen werden."));
  state.payload = payload;
  renderOils();
}

function renderOilsLegacy(message = "") {
  const payload = state.payload;
  const activeOils = payload.oils.filter((oil) => oil.implemented);
  const canAdd = payload.placeholder_count > 0;

  app.innerHTML = `
    <section class="admin-header">
      <div>
        <p class="eyebrow">${escapeHtml(activeOils.length)} ${escapeHtml(routeText("active_suffix", "aktiv"))} · ${escapeHtml(payload.placeholder_count)} ${escapeHtml(routeText("free_suffix", "frei"))}</p>
        <h1>${escapeHtml(routeText("heading", "Öl-Auswahl"))}</h1>
        <p class="lead">${escapeHtml(routeText("admin_lead", "Hinzufügen ist nur mit freien Platzhaltern möglich. Entfernen geht nur ohne Wertungen."))}</p>
      </div>
      <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
    </section>

    ${renderParticipantPanel(payload.participants || [])}

    <section class="setup-editor add-oil-panel">
      <h2>${escapeHtml(routeText("add_heading", "Öl hinzufügen"))}</h2>
      <div class="oil-form">
        <label>
          ${escapeHtml(routeText("name_label", "Name"))}
          <input id="new-oil-name" type="text" maxlength="160" placeholder="${escapeHtml(routeText("name_placeholder", "Name des Öls"))}" ${canAdd ? "" : "disabled"}>
        </label>
        <label>
          ${escapeHtml(routeText("price_label", "Preis pro Liter"))}
          <input id="new-oil-price" type="number" min="1" step="1" placeholder="${escapeHtml(routeText("price_placeholder", "€ pro Liter"))}" ${canAdd ? "" : "disabled"}>
        </label>
        <label>
          ${escapeHtml(routeText("owner_label", "Mitgebracht von"))}
          <select id="new-oil-owner" ${canAdd ? "" : "disabled"}>
            ${participantOptions()}
          </select>
        </label>
        <fieldset class="oil-type-field">
          <legend>${escapeHtml(routeText("is_olive_question", "Ist das ein Olivenöl?"))}</legend>
          <div class="choice-row">
            <label class="check-option">
              <input id="new-oil-olive-yes" type="checkbox" data-oil-kind="olive" ${canAdd ? "checked" : "disabled"}>
              <span>${escapeHtml(routeText("yes_label", "Ja"))}</span>
            </label>
            <label class="check-option">
              <input id="new-oil-olive-no" type="checkbox" data-oil-kind="olive" ${canAdd ? "" : "disabled"}>
              <span>${escapeHtml(routeText("no_label", "Nein"))}</span>
            </label>
          </div>
        </fieldset>
        <button class="save-button" type="button" data-action="add-oil" ${canAdd ? "" : "disabled"}>${escapeHtml(routeText("add_button", "Hinzufügen"))}</button>
      </div>
      <p class="notice ${message.startsWith(globalText("error_prefix", "Fehler")) ? "error" : ""}">${escapeHtml(message || (canAdd ? " " : routeText("no_placeholders", "Keine freien Platzhalter mehr.")))}</p>
    </section>

    <section class="setup-editor action-zone">
      <div class="action-zone-copy">
        <h2>${escapeHtml(routeText("cipher_heading", "Chiffres"))}</h2>
        <p class="notice">${escapeHtml(routeText("cipher_notice", "Mischt alle Chiffres neu, inklusive der freien Platzhalter."))}</p>
      </div>
      <button class="ghost-button" type="button" data-action="shuffle-ciphers">${escapeHtml(routeText("shuffle_ciphers_button", "Chiffres neu mischen"))}</button>
    </section>

    <section class="setup-editor action-zone">
      <div class="action-zone-copy">
        <h2>${escapeHtml(routeText("dummy_heading", "Dummy-Daten"))}</h2>
        <p class="notice">${escapeHtml(routeText("dummy_notice", "Ergänzt 8 vollständig ausgefüllte Test-Probanden für alle aktiven Öle."))}</p>
      </div>
      <button class="ghost-button" type="button" data-action="add-dummy-data">${escapeHtml(routeText("dummy_data_button", "Dummy-Daten ergänzen"))}</button>
    </section>

    <section class="oil-admin-list">
      ${activeOils.map(renderOilRow).join("")}
    </section>

    <section class="setup-editor danger-zone">
      <div class="danger-zone-copy">
        <h2>${escapeHtml(routeText("database_heading", "Datenbank"))}</h2>
        <p class="notice">${escapeHtml(routeText("database_notice", "Setzt alle Teilnehmer und alle Wertungen zurück. Die Öl-Auswahl bleibt erhalten."))}</p>
      </div>
      <button class="ghost-button danger-button" type="button" data-action="reset-db">${escapeHtml(routeText("database_reset_button", "Gesamte Datenbank zurücksetzen"))}</button>
    </section>
  `;
}

function renderOils(message = "") {
  const payload = state.payload;
  const activeOils = payload.oils.filter((oil) => oil.implemented);
  const canAdd = payload.placeholder_count > 0;
  const isError = message.startsWith(globalText("error_prefix", "Fehler"));
  app.innerHTML = `
    <section class="admin-header">
      <div>
        <p class="eyebrow">${escapeHtml(activeOils.length)} ${escapeHtml(routeText("active_suffix", "Proben"))} · ${escapeHtml(payload.placeholder_count)} ${escapeHtml(routeText("free_suffix", "Chiffren frei"))} · ${escapeHtml((payload.participants || []).length)} ${escapeHtml(routeText("participant_count_suffix", "Probanden"))}</p>
        <h1>${escapeHtml(routeText("heading", "Konfiguration"))}</h1>
        <p class="lead">${escapeHtml(routeText("admin_lead", "Öle, Namen und Tests verwalten"))}</p>
      </div>
      <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
    </section>

    <section class="setup-editor event-state-panel mode-${escapeHtml(payload.event_mode || "preparation")}">
      <div><h2>${escapeHtml(routeText("event_state_heading", "Umfrage-Status"))}</h2>
        <p class="notice">${escapeHtml(eventModeNotice(payload.event_mode))}</p></div>
      <label class="event-mode-field">
        <span>${escapeHtml(routeText("event_mode_label", "Phase"))}</span>
        <select data-action="change-event-mode">
          <option value="preparation" ${payload.event_mode === "preparation" ? "selected" : ""}>${escapeHtml(routeText("event_mode_preparation", "Vorbereitung"))}</option>
          <option value="execution" ${payload.event_mode === "execution" ? "selected" : ""}>${escapeHtml(routeText("event_mode_execution", "Durchführung"))}</option>
          <option value="evaluation" ${payload.event_mode === "evaluation" ? "selected" : ""}>${escapeHtml(routeText("event_mode_evaluation", "Auswertung"))}</option>
        </select>
      </label>
    </section>

    <div class="configuration-split">
      <section class="configuration-column configuration-participants">
        ${renderConfigurationGroupHeader("participants", routeText("participants_heading", "Probanden"), (payload.participants || []).length)}
        <div class="configuration-group-body ${state.openConfigGroups.has("participants") ? "open" : ""}" data-config-group-body="participants">${renderParticipantPanel(payload.participants || [])}</div>
      </section>
      <section class="configuration-column configuration-oils">
        ${renderConfigurationGroupHeader("oils", routeText("oils_heading", "Öle"), activeOils.length)}
        <div class="configuration-group-body ${state.openConfigGroups.has("oils") ? "open" : ""}" data-config-group-body="oils">
        <section class="setup-editor config-add-card add-oil-panel">
          <h3>${escapeHtml(routeText("add_heading", "Öl neu hinzufügen"))}</h3>
          <div class="oil-form">
            <label>${escapeHtml(routeText("name_label", "Name"))}<input id="new-oil-name" type="text" maxlength="160" placeholder="${escapeHtml(routeText("name_placeholder", "Name des Öls"))}" ${canAdd ? "" : "disabled"}></label>
            <label>${escapeHtml(routeText("price_short_label", "€/l"))}<input id="new-oil-price" type="number" min="1" step="1" placeholder="${escapeHtml(routeText("price_placeholder", "€ pro Liter"))}" ${canAdd ? "" : "disabled"}></label>
            <label>${escapeHtml(routeText("owner_short_label", "von"))}<select id="new-oil-owner" multiple size="4" ${canAdd ? "" : "disabled"}>${participantOptions()}</select></label>
            <label class="check-option oil-row-olive-option"><input id="new-oil-olive-yes" type="checkbox" ${canAdd ? "checked" : "disabled"}><span>${escapeHtml(routeText("is_olive_label", "Olivenöl"))}</span></label>
            <button class="save-button" type="button" data-action="add-oil" ${canAdd ? "" : "disabled"}>${escapeHtml(routeText("add_button", "Hinzufügen"))}</button>
          </div>
          <p class="notice ${isError ? "error" : ""}">${escapeHtml(message || (canAdd ? " " : routeText("no_placeholders", "Keine freien Platzhalter mehr.")))}</p>
        </section>
        <section class="oil-admin-list">${activeOils.map(renderOilRow).join("")}</section>
        </div>
      </section>
    </div>

    <div class="configuration-tools-grid">
      <section class="setup-editor action-zone"><div class="action-zone-copy"><h2>${escapeHtml(routeText("cipher_heading", "Chiffres"))}</h2><p class="notice">${escapeHtml(routeText("cipher_notice", "Mischt alle Chiffres neu, inklusive der freien Platzhalter."))}</p></div><button class="ghost-button" type="button" data-action="shuffle-ciphers">${escapeHtml(routeText("shuffle_ciphers_button", "Chiffres neu mischen"))}</button></section>
      <section class="setup-editor action-zone"><div class="action-zone-copy"><h2>${escapeHtml(routeText("dummy_heading", "Dummy-Daten"))}</h2><p class="notice">${escapeHtml(routeText("dummy_notice", "Ergänzt vollständige Testdaten."))}</p></div><button class="ghost-button" type="button" data-action="add-dummy-data">${escapeHtml(routeText("dummy_data_button", "Dummy-Daten ergänzen"))}</button></section>
    </div>
    <section class="setup-editor danger-zone"><div class="danger-zone-copy"><h2>${escapeHtml(routeText("database_heading", "Datenbank"))}</h2><p class="notice">${escapeHtml(routeText("database_notice", "Setzt alle Teilnehmer und alle Wertungen zurück. Die Öl-Auswahl bleibt erhalten."))}</p></div><button class="ghost-button danger-button" type="button" data-action="reset-db">${escapeHtml(routeText("database_reset_button", "Gesamte Datenbank zurücksetzen"))}</button></section>
  `;
}

function renderConfigurationGroupHeader(group, title, count) {
  const open = state.openConfigGroups.has(group);
  return `<button class="configuration-group-header" type="button" data-action="toggle-config-group" data-config-group="${escapeHtml(group)}" aria-expanded="${open}"><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(count)}</small></span><b>${open ? "−" : "+"}</b></button>`;
}

function renderParticipantPanelLegacy(participants) {
  return `
    <section class="setup-editor participant-admin-panel">
      <div class="participant-admin-heading">
        <div>
          <h2>${escapeHtml(routeText("participants_heading", "Probanden"))}</h2>
          <p class="notice">${escapeHtml(routeText("participants_notice", "Namen aus der Startseite erscheinen automatisch."))}</p>
        </div>
      </div>
      <div class="participant-add-row">
        <label>
          ${escapeHtml(routeText("participant_name_label", "Name"))}
          <input id="new-participant-name" type="text" maxlength="80" placeholder="${escapeHtml(routeText("participant_name_placeholder", "Name hinzufügen"))}">
        </label>
        <label class="check-option participant-publish-option">
          <input id="new-participant-publish" type="checkbox" checked>
          <span>${escapeHtml(routeText("participant_publish_label", "Name veröffentlichen"))}</span>
        </label>
        <button class="save-button" type="button" data-action="add-participant">${escapeHtml(routeText("participant_add_button", "Proband hinzufügen"))}</button>
      </div>
      <div class="participant-admin-list">
        ${participants.length ? participants.map(renderParticipantRow).join("") : `<p class="notice">${escapeHtml(routeText("participants_empty", "Noch keine Probanden."))}</p>`}
      </div>
    </section>
  `;
}

function renderParticipantRowLegacy(participant) {
  return `
    <div class="participant-admin-row" data-participant-id="${escapeHtml(participant.id)}">
      <label>
        ${escapeHtml(routeText("participant_name_label", "Name"))}
        <input type="text" maxlength="80" value="${escapeHtml(participant.display_name)}" data-participant-field="name">
      </label>
      <label class="check-option participant-publish-option">
        <input type="checkbox" data-participant-field="publish" ${participant.publish_name ? "checked" : ""}>
        <span>${escapeHtml(routeText("participant_publish_label", "Name veröffentlichen"))}</span>
      </label>
      <span class="participant-rating-count">${escapeHtml(participant.response_count)} ${escapeHtml(routeText("ratings_suffix", "Wertungen"))}</span>
      <button class="ghost-button" type="button" data-action="update-participant" data-participant-id="${escapeHtml(participant.id)}">${escapeHtml(routeText("save_button", "Speichern"))}</button>
    </div>
  `;
}

function renderOilRowLegacy(oil) {
  return `
    <article class="oil-admin-row">
      <div>
        <div class="oil-edit-grid">
          <label>
            ${escapeHtml(routeText("name_label", "Name"))}
            <input type="text" maxlength="160" value="${escapeHtml(oil.name)}" data-edit-field="name" data-oil-id="${escapeHtml(oil.id)}">
          </label>
          <label>
            ${escapeHtml(routeText("price_label", "Preis pro Liter"))}
            <input type="number" min="1" step="1" value="${escapeHtml(oil.actual_price_per_liter_eur ?? "")}" data-edit-field="price" data-oil-id="${escapeHtml(oil.id)}">
          </label>
          <label>
            ${escapeHtml(routeText("owner_label", "Mitgebracht von"))}
            <select data-edit-field="owner" data-oil-id="${escapeHtml(oil.id)}">
              ${participantOptions(oil.brought_by_respondent_id)}
            </select>
          </label>
        </div>
        <p class="metric-sub">${escapeHtml(oil.type)} · ${escapeHtml(euro(oil.actual_price_per_liter_eur))} · ${escapeHtml(routeText("owner_label", "Mitgebracht von"))}: ${escapeHtml(ownerName(oil.brought_by_name))} · ${escapeHtml(oil.response_count)} ${escapeHtml(routeText("ratings_suffix", "Wertungen"))}</p>
        <div class="cipher-mini-row">
          <span>${escapeHtml(routeText("taste_cipher", "Geschmack"))}: ${escapeHtml(displayCipher(oil.ciphers.geschmack, "greek"))}</span>
          <span>${escapeHtml(routeText("smell_cipher", "Geruch"))}: ${escapeHtml(displayCipher(oil.ciphers.geruch, "latin"))}</span>
          <span>${escapeHtml(routeText("experience_cipher", "Erfahrung"))}: ${escapeHtml(displayCipher(oil.ciphers.gesamt, "number"))}</span>
        </div>
      </div>
      <div class="oil-admin-actions">
        <button class="save-button" type="button" data-action="update-oil" data-oil-id="${escapeHtml(oil.id)}">${escapeHtml(routeText("save_button", "Speichern"))}</button>
        <button class="ghost-button" type="button" data-action="clear-oil" data-oil-id="${escapeHtml(oil.id)}" ${oil.response_count ? "" : "disabled"}>${escapeHtml(routeText("clear_ratings_button", "Wertungen löschen"))}</button>
        <button class="ghost-button danger-button" type="button" data-action="remove-oil" data-oil-id="${escapeHtml(oil.id)}" ${oil.can_remove ? "" : "disabled"}>${escapeHtml(routeText("remove_button", "Entfernen"))}</button>
      </div>
    </article>
  `;
}

function visibleFieldLabel(key, fallback) {
  const value = routeText(key, fallback);
  return value === "TMP" ? "" : escapeHtml(value);
}

function renderParticipantPanel(participants) {
  return `
    <div class="participant-admin-panel">
      <article class="setup-editor config-add-card">
        <h3>${escapeHtml(routeText("participant_add_heading", "Proband neu hinzufügen"))}</h3>
        <div class="participant-add-row">
        <label>${visibleFieldLabel("participant_name_label", "Name")}<input id="new-participant-name" type="text" maxlength="80" aria-label="Name" placeholder="${escapeHtml(routeText("participant_name_placeholder", "Name hinzufügen"))}"></label>
        <label class="check-option participant-publish-option"><input id="new-participant-publish" type="checkbox" checked><span>${escapeHtml(routeText("participant_publish_label", "Name veröffentlichen"))}</span></label>
        <label class="check-option participant-publish-option"><input id="new-participant-publish-competitive" type="checkbox" checked><span>${escapeHtml(routeText("participant_publish_competitive_label", "beim Symposium-Minispiel mitmachen"))}</span></label>
        <label class="check-option participant-publish-option"><input id="new-participant-active" type="checkbox"><span>${escapeHtml(routeText("participant_active_label", "Teilnehmer"))}</span></label>
        <button class="save-button" type="button" data-action="add-participant">${escapeHtml(routeText("participant_add_button", "Proband hinzufügen"))}</button>
        </div>
      </article>
      <div class="participant-admin-list">${participants.length ? participants.map(renderParticipantRow).join("") : `<p class="notice">${escapeHtml(routeText("participants_empty", "Noch keine Probanden."))}</p>`}</div>
    </div>`;
}

function renderParticipantRow(participant) {
  const open = state.openParticipantCards.has(String(participant.id));
  return `
    <article class="setup-editor config-item-card participant-admin-row ${open ? "open" : ""}" data-participant-id="${escapeHtml(participant.id)}">
      <button class="config-item-toggle" type="button" data-action="toggle-participant-card" data-participant-id="${escapeHtml(participant.id)}" aria-expanded="${open}"><strong>${escapeHtml(participant.display_name)}</strong><span>${open ? "−" : "+"}</span></button>
      <div class="config-item-body">
      <label>${visibleFieldLabel("participant_name_label", "Name")}<input type="text" maxlength="80" aria-label="Name" value="${escapeHtml(participant.display_name)}" data-participant-field="name"></label>
      <label class="check-option participant-publish-option"><input type="checkbox" data-participant-field="publish" ${participant.publish_name ? "checked" : ""}><span>${escapeHtml(routeText("participant_publish_label", "Name veröffentlichen"))}</span></label>
      <label class="check-option participant-publish-option"><input type="checkbox" data-participant-field="publish-competitive" ${participant.publish_competitive_name ? "checked" : ""}><span>${escapeHtml(routeText("participant_publish_competitive_label", "beim Symposium-Minispiel mitmachen"))}</span></label>
      <label class="check-option participant-publish-option"><input type="checkbox" data-participant-field="active" ${participant.is_participant ? "checked" : ""}><span>${escapeHtml(routeText("participant_active_label", "Teilnehmer"))}</span></label>
      <span class="participant-rating-count">${escapeHtml(participant.response_count)} ${escapeHtml(routeText("ratings_suffix", "Wertungen"))}</span>
      <span class="participant-pin-status">${escapeHtml(routeText(`participant_pin_status_${participant.pin_status}`, participant.pin_status === "file" ? "PIN aus Datei" : participant.pin_status === "set" ? "PIN gesetzt" : "PIN beim nächsten Login festlegen"))}</span>
      <div class="config-item-actions"><button class="save-button" type="button" data-action="update-participant" data-participant-id="${escapeHtml(participant.id)}">${escapeHtml(routeText("save_button", "Speichern"))}</button><button class="ghost-button" type="button" data-action="reset-participant-pin" data-participant-id="${escapeHtml(participant.id)}">${escapeHtml(routeText("participant_reset_pin_button", "PIN zurücksetzen"))}</button><button class="ghost-button danger-button" type="button" data-action="delete-participant" data-participant-id="${escapeHtml(participant.id)}">${escapeHtml(routeText("participant_delete_button", "Löschen"))}</button></div>
      </div>
    </article>`;
}

function renderOilRow(oil) {
  const open = state.openOilCards.has(String(oil.id));
  return `
    <article class="oil-admin-row config-item-card ${open ? "open" : ""}" data-oil-id="${escapeHtml(oil.id)}">
      <button class="config-item-toggle" type="button" data-action="toggle-oil-card" data-oil-id="${escapeHtml(oil.id)}" aria-expanded="${open}"><strong>${escapeHtml(oil.name)}</strong><span>${open ? "−" : "+"}</span></button>
      <div class="config-item-body">
        <div class="oil-edit-grid">
          <label>${escapeHtml(routeText("name_label", "Name"))}<input type="text" maxlength="160" value="${escapeHtml(oil.name)}" data-edit-field="name" data-oil-id="${escapeHtml(oil.id)}"></label>
          <label>${escapeHtml(routeText("price_short_label", "€/l"))}<input type="number" min="1" step="1" value="${escapeHtml(oil.actual_price_per_liter_eur ?? "")}" data-edit-field="price" data-oil-id="${escapeHtml(oil.id)}"></label>
          <label>${escapeHtml(routeText("owner_short_label", "von"))}<select multiple size="4" data-edit-field="owner" data-oil-id="${escapeHtml(oil.id)}">${participantOptions(oil.owner_ids || [])}</select></label>
          <label class="check-option oil-row-olive-option"><input type="checkbox" data-edit-field="olive" ${oil.is_olive_oil ? "checked" : ""}><span>${escapeHtml(routeText("is_olive_label", "Olivenöl"))}</span></label>
        </div>
        <p class="metric-sub">${escapeHtml(ownerName(oil.brought_by_name))} · ${escapeHtml(oil.response_count)} ${escapeHtml(routeText("ratings_suffix", "Wertungen"))}</p>
        <div class="cipher-mini-row"><span>${escapeHtml(routeText("taste_cipher", "Geschmack"))}: ${escapeHtml(displayCipher(oil.ciphers.geschmack, "greek"))}</span><span>${escapeHtml(routeText("smell_cipher", "Geruch"))}: ${escapeHtml(displayCipher(oil.ciphers.geruch, "latin"))}</span><span>${escapeHtml(routeText("experience_cipher", "volle Erfahrung"))}: ${escapeHtml(displayCipher(oil.ciphers.gesamt, "number"))}</span></div>
      <div class="oil-admin-actions"><button class="save-button" type="button" data-action="update-oil" data-oil-id="${escapeHtml(oil.id)}">${escapeHtml(routeText("save_button", "Speichern"))}</button><button class="ghost-button danger-button" type="button" data-action="remove-oil" data-oil-id="${escapeHtml(oil.id)}" ${oil.can_remove ? "" : "disabled"}>${escapeHtml(routeText("remove_button", "Entfernen"))}</button></div>
      </div>
    </article>`;
}

async function postAction(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: state.password, ...body }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || routeText("action_failed", "Aktion fehlgeschlagen."));
  state.payload = payload;
  renderOils();
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "toggle-config-group") {
    const group = target.dataset.configGroup;
    if (state.openConfigGroups.has(group)) state.openConfigGroups.delete(group);
    else state.openConfigGroups.add(group);
    renderOils();
    return;
  }

  if (action === "toggle-participant-card") {
    const participantId = String(target.dataset.participantId || "");
    if (state.openParticipantCards.has(participantId)) state.openParticipantCards.delete(participantId);
    else state.openParticipantCards.add(participantId);
    renderOils();
    return;
  }

  if (action === "toggle-oil-card") {
    const oilId = String(target.dataset.oilId || "");
    if (state.openOilCards.has(oilId)) state.openOilCards.delete(oilId);
    else state.openOilCards.add(oilId);
    renderOils();
    return;
  }

  if (action === "login") {
    state.password = document.getElementById("oil-password")?.value || "";
    try {
      await loadOils();
    } catch (error) {
      renderLogin(error.message);
    }
  }

  if (action === "add-oil") {
    const name = document.getElementById("new-oil-name")?.value.trim() || "";
    const price = document.getElementById("new-oil-price")?.value || "";
    const ownerIds = selectedParticipantIds(document.getElementById("new-oil-owner"));
    const isOliveOil = Boolean(document.getElementById("new-oil-olive-yes")?.checked);
    try {
      await postAction("/api/oils/add", { name, actual_price_per_liter_eur: price, is_olive_oil: isOliveOil, owner_ids: ownerIds });
      renderOils(routeText("oil_added", "Öl hinzugefügt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "add-participant") {
    const name = document.getElementById("new-participant-name")?.value.trim() || "";
    const publish = Boolean(document.getElementById("new-participant-publish")?.checked);
    const publishCompetitive = Boolean(document.getElementById("new-participant-publish-competitive")?.checked);
    const active = Boolean(document.getElementById("new-participant-active")?.checked);
    try {
      await postAction("/api/oils/participants/add", { display_name: name, publish_name: publish, publish_competitive_name: publishCompetitive, is_participant: active });
      renderOils(routeText("participant_added", "Proband hinzugefügt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "update-participant") {
    const participantId = target.dataset.participantId;
    const row = target.closest(".participant-admin-row");
    const name = row?.querySelector('[data-participant-field="name"]')?.value.trim() || "";
    const publish = Boolean(row?.querySelector('[data-participant-field="publish"]')?.checked);
    const publishCompetitive = Boolean(row?.querySelector('[data-participant-field="publish-competitive"]')?.checked);
    const active = Boolean(row?.querySelector('[data-participant-field="active"]')?.checked);
    try {
      await postAction("/api/oils/participants/update", { participant_id: participantId, display_name: name, publish_name: publish, publish_competitive_name: publishCompetitive, is_participant: active });
      renderOils(routeText("participant_saved", "Proband gespeichert."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "delete-participant") {
    const participantId = target.dataset.participantId;
    if (!confirm(routeText("confirm_delete_participant", "Diesen Probanden mitsamt allen Wertungen löschen?"))) return;
    await postAction("/api/oils/participants/delete", { participant_id: participantId });
  }

  if (action === "reset-participant-pin") {
    const participantId = target.dataset.participantId;
    if (!confirm(routeText("confirm_reset_pin", "PIN dieses Probanden zurücksetzen? Beim nächsten Login wird eine neue PIN festgelegt."))) return;
    await postAction("/api/oils/participants/reset-pin", { participant_id: participantId });
  }

  if (action === "update-oil") {
    const oilId = target.dataset.oilId;
    const row = target.closest(".oil-admin-row");
    const name = row?.querySelector('[data-edit-field="name"]')?.value.trim() || "";
    const price = row?.querySelector('[data-edit-field="price"]')?.value || "";
    const ownerIds = selectedParticipantIds(row?.querySelector('[data-edit-field="owner"]'));
    const isOliveOil = Boolean(row?.querySelector('[data-edit-field="olive"]')?.checked);
    try {
      await postAction("/api/oils/update", { oil_id: oilId, name, actual_price_per_liter_eur: price, owner_ids: ownerIds, is_olive_oil: isOliveOil });
      renderOils(routeText("oil_saved", "Öl gespeichert."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "remove-oil") {
    const oilId = target.dataset.oilId;
    if (!confirm(routeText("confirm_remove", "Dieses Öl entfernen und den Slot wieder als Platzhalter freigeben?"))) return;
    await postAction("/api/oils/remove", { oil_id: oilId });
  }

  if (action === "shuffle-ciphers") {
    if (!confirm(routeText("confirm_shuffle_ciphers", "Alle Chiffres inklusive freier Platzhalter neu mischen?"))) return;
    try {
      await postAction("/api/oils/shuffle-ciphers", {});
      renderOils(routeText("ciphers_shuffled", "Chiffres neu gemischt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "add-dummy-data") {
    if (!confirm(routeText("confirm_dummy_data", "8 vollständig ausgefüllte Dummy-Probanden ergänzen?"))) return;
    try {
      await postAction("/api/oils/add-dummy-data", {});
      renderOils(routeText("dummy_data_added", "Dummy-Daten ergänzt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "reset-db") {
    if (!confirm(routeText("confirm_reset", "Wirklich alle Teilnehmer und alle Wertungen löschen?"))) return;
    await postAction("/api/oils/reset-db", {});
  }

}

app.addEventListener("click", (event) => {
  handleClick(event).catch((error) => {
    if (state.payload) renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    else renderLogin(error.message);
  });
});

app.addEventListener("change", (event) => {
  const modeSelect = event.target.closest('select[data-action="change-event-mode"]');
  if (modeSelect) {
    const previous = state.payload.event_mode;
    const next = modeSelect.value;
    const prompt = routeText("confirm_mode_change", "Veranstaltungsphase wirklich ändern?");
    if (!confirm(prompt)) {
      modeSelect.value = previous;
      return;
    }
    postAction("/api/oils/event-mode", { mode: next }).catch((error) => {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    });
    return;
  }
  const input = event.target.closest('input[type="checkbox"][data-oil-kind="olive"]');
  if (!input) return;
  const group = input.closest(".choice-row");
  const options = Array.from(group?.querySelectorAll('input[type="checkbox"][data-oil-kind="olive"]') || []);
  if (input.checked) {
    for (const option of options) {
      if (option !== input) option.checked = false;
    }
  } else if (!options.some((option) => option.checked)) {
    input.checked = true;
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.id === "oil-password") {
    event.preventDefault();
    app.querySelector('[data-action="login"]')?.click();
  }
  if (event.key === "Enter" && event.target?.id === "new-participant-name") {
    event.preventDefault();
    app.querySelector('[data-action="add-participant"]')?.click();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  event.target.querySelector("[data-action]")?.click();
});

renderLogin();
