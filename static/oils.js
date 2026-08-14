const app = document.getElementById("oil-selection-app");

const state = {
  password: "",
  payload: null,
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
      <label>
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
        </div>
        <p class="metric-sub">${escapeHtml(oil.type)} · ${escapeHtml(euro(oil.actual_price_per_liter_eur))} · ${escapeHtml(oil.response_count)} ${escapeHtml(routeText("ratings_suffix", "Wertungen"))}</p>
        <div class="cipher-mini-row">
          <span>${escapeHtml(routeText("taste_cipher", "Geschmack"))}: ${escapeHtml(oil.ciphers.geschmack || "-")}</span>
          <span>${escapeHtml(routeText("smell_cipher", "Geruch"))}: ${escapeHtml(oil.ciphers.geruch || "-")}</span>
          <span>${escapeHtml(routeText("experience_cipher", "Erfahrung"))}: ${escapeHtml(oil.ciphers.gesamt || "-")}</span>
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
    const isOliveOil = Boolean(document.getElementById("new-oil-olive-yes")?.checked);
    try {
      await postAction("/api/oils/add", { name, actual_price_per_liter_eur: price, is_olive_oil: isOliveOil });
      renderOils(routeText("oil_added", "Öl hinzugefügt."));
    } catch (error) {
      renderOils(`${globalText("error_prefix", "Fehler")}: ${error.message}`);
    }
  }

  if (action === "update-oil") {
    const oilId = target.dataset.oilId;
    const row = target.closest(".oil-admin-row");
    const name = row?.querySelector('[data-edit-field="name"]')?.value.trim() || "";
    const price = row?.querySelector('[data-edit-field="price"]')?.value || "";
    try {
      await postAction("/api/oils/update", { oil_id: oilId, name, actual_price_per_liter_eur: price });
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
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  event.target.querySelector("[data-action]")?.click();
});

renderLogin();
