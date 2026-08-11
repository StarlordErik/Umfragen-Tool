const app = document.getElementById("oil-selection-app");

const state = {
  password: "",
  payload: null,
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="admin-header">
      <div>
        <p class="eyebrow">Geschützt</p>
        <h1>Öl-Auswahl</h1>
        <p class="lead">Passwort eingeben, um Öle und Wertungen zu verwalten.</p>
      </div>
      <a class="ghost-button" href="/">Linktree</a>
    </section>

    <section class="setup-editor oil-login-panel">
      <label>
        Passwort
        <input id="oil-password" type="password" autocomplete="current-password" autofocus>
      </label>
      <div class="setup-actions">
        <p class="notice ${error ? "error" : ""}">${escapeHtml(error || " ")} </p>
        <button class="save-button" type="button" data-action="login">Öffnen</button>
      </div>
    </section>
  `;
}

async function loadOils() {
  const response = await fetch(`/api/oils?password=${encodeURIComponent(state.password)}`, {
    credentials: "same-origin",
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Öl-Auswahl konnte nicht geladen werden.");
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
        <p class="eyebrow">${escapeHtml(activeOils.length)} aktiv · ${escapeHtml(payload.placeholder_count)} frei</p>
        <h1>Öl-Auswahl</h1>
        <p class="lead">Hinzufügen ist nur mit freien Platzhaltern möglich. Entfernen geht nur ohne Wertungen.</p>
      </div>
      <a class="ghost-button" href="/">Linktree</a>
    </section>

    <section class="setup-editor add-oil-panel">
      <h2>Öl hinzufügen</h2>
      <div class="oil-form">
        <label>
          Name
          <input id="new-oil-name" type="text" maxlength="160" placeholder="Name des Öls" ${canAdd ? "" : "disabled"}>
        </label>
        <label>
          Öl-Sorte
          <select id="new-oil-type" ${canAdd ? "" : "disabled"}>
            ${payload.oil_type_options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}
          </select>
        </label>
        <button class="save-button" type="button" data-action="add-oil" ${canAdd ? "" : "disabled"}>Hinzufügen</button>
      </div>
      <p class="notice ${message.startsWith("Fehler") ? "error" : ""}">${escapeHtml(message || (canAdd ? " " : "Keine freien Platzhalter mehr."))}</p>
    </section>

    <section class="oil-admin-list">
      ${activeOils.map(renderOilRow).join("")}
    </section>

    <section class="setup-editor danger-zone">
      <h2>Datenbank</h2>
      <p class="notice">Setzt alle Teilnehmer und alle Wertungen zurück. Die Öl-Auswahl bleibt erhalten.</p>
      <button class="ghost-button danger-button" type="button" data-action="reset-db">Gesamte Datenbank zurücksetzen</button>
    </section>
  `;
}

function renderOilRow(oil) {
  return `
    <article class="oil-admin-row">
      <div>
        <h2>${escapeHtml(oil.name)}</h2>
        <p class="metric-sub">${escapeHtml(oil.type)} · ${escapeHtml(oil.response_count)} Wertungen</p>
        <div class="cipher-mini-row">
          <span>Geschmack: ${escapeHtml(oil.ciphers.geschmack || "-")}</span>
          <span>Geruch: ${escapeHtml(oil.ciphers.geruch || "-")}</span>
          <span>Erfahrung: ${escapeHtml(oil.ciphers.gesamt || "-")}</span>
        </div>
      </div>
      <div class="oil-admin-actions">
        <button class="ghost-button" type="button" data-action="clear-oil" data-oil-id="${escapeHtml(oil.id)}" ${oil.response_count ? "" : "disabled"}>Wertungen löschen</button>
        <button class="ghost-button danger-button" type="button" data-action="remove-oil" data-oil-id="${escapeHtml(oil.id)}" ${oil.can_remove ? "" : "disabled"}>Entfernen</button>
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
  if (!payload.ok) throw new Error(payload.error || "Aktion fehlgeschlagen.");
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
    const type = document.getElementById("new-oil-type")?.value || "";
    try {
      await postAction("/api/oils/add", { name, type });
      renderOils("Öl hinzugefügt.");
    } catch (error) {
      renderOils(`Fehler: ${error.message}`);
    }
  }

  if (action === "clear-oil") {
    const oilId = target.dataset.oilId;
    if (!confirm("Alle Wertungen für dieses Öl löschen?")) return;
    await postAction("/api/oils/clear", { oil_id: oilId });
  }

  if (action === "remove-oil") {
    const oilId = target.dataset.oilId;
    if (!confirm("Dieses Öl entfernen und den Slot wieder als Platzhalter freigeben?")) return;
    await postAction("/api/oils/remove", { oil_id: oilId });
  }

  if (action === "reset-db") {
    if (!confirm("Wirklich alle Teilnehmer und alle Wertungen löschen?")) return;
    await postAction("/api/oils/reset-db", {});
  }
}

app.addEventListener("click", (event) => {
  handleClick(event).catch((error) => {
    if (state.payload) renderOils(`Fehler: ${error.message}`);
    else renderLogin(error.message);
  });
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.id === "oil-password") {
    app.querySelector('[data-action="login"]')?.click();
  }
});

renderLogin();
