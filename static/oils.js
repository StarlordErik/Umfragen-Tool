const app = document.getElementById("oil-selection-app");

const state = {
  password: "",
  payload: null,
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

function participantOptions(selectedId = "") {
  const selected = String(selectedId || "");
  const participants = state.payload?.participants || [];
  return [
    `<option value="">${escapeHtml(routeText("owner_empty", "nicht zugeordnet"))}</option>`,
    ...participants.map((participant) => {
      const value = String(participant.id);
      return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(participant.display_name)}</option>`;
    }),
  ].join("");
}

function ownerName(value) {
  return value || routeText("owner_empty", "nicht zugeordnet");
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

function renderOils(message = "") {
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

function renderParticipantPanel(participants) {
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

function renderParticipantRow(participant) {
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

function renderOilRow(oil) {
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
    const owner = document.getElementById("new-oil-owner")?.value || "";
    const isOliveOil = Boolean(document.getElementById("new-oil-olive-yes")?.checked);
    try {
      await postAction("/api/oils/add", { name, actual_price_per_liter_eur: price, is_olive_oil: isOliveOil, brought_by_respondent_id: owner });
      renderOils(routeText("oil_added", "Öl hinzugefügt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "add-participant") {
    const name = document.getElementById("new-participant-name")?.value.trim() || "";
    const publish = Boolean(document.getElementById("new-participant-publish")?.checked);
    try {
      await postAction("/api/oils/participants/add", { display_name: name, publish_name: publish });
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
    try {
      await postAction("/api/oils/participants/update", { participant_id: participantId, display_name: name, publish_name: publish });
      renderOils(routeText("participant_saved", "Proband gespeichert."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "update-oil") {
    const oilId = target.dataset.oilId;
    const row = target.closest(".oil-admin-row");
    const name = row?.querySelector('[data-edit-field="name"]')?.value.trim() || "";
    const price = row?.querySelector('[data-edit-field="price"]')?.value || "";
    const owner = row?.querySelector('[data-edit-field="owner"]')?.value || "";
    try {
      await postAction("/api/oils/update", { oil_id: oilId, name, actual_price_per_liter_eur: price, brought_by_respondent_id: owner });
      renderOils(routeText("oil_saved", "Öl gespeichert."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "clear-oil") {
    const oilId = target.dataset.oilId;
    if (!confirm(routeText("confirm_clear", "Alle Wertungen für dieses Öl löschen?"))) return;
    await postAction("/api/oils/clear", { oil_id: oilId });
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
