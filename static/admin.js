const app = document.getElementById("admin-app");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

async function loadConfig() {
  const response = await fetch("/api/config", { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Setup konnte nicht geladen werden.");
  render(payload.config);
}

function render(config) {
  app.innerHTML = `
    <section class="admin-header">
      <div>
        <p class="eyebrow">Setup</p>
        <h1>${escapeHtml(config.event?.title || "Ölverkostung")}</h1>
        <p class="lead">Öle, Chiffren, Skalen und Textfelder.</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">Links</a>
        <a class="primary-link" href="/ergebnisse">Ergebnisse</a>
      </div>
    </section>

    <section class="setup-editor">
      <textarea id="config-json" spellcheck="false">${escapeHtml(JSON.stringify(config, null, 2))}</textarea>
      <div class="setup-actions">
        <p class="notice" id="setup-state">event_config.json</p>
        <button class="save-button" id="save-config" type="button">Speichern</button>
      </div>
    </section>
  `;

  document.getElementById("save-config").addEventListener("click", saveConfig);
}

async function saveConfig() {
  const textarea = document.getElementById("config-json");
  const status = document.getElementById("setup-state");
  const button = document.getElementById("save-config");
  status.classList.remove("error");
  button.disabled = true;
  status.textContent = "prüft...";

  let config;
  try {
    config = JSON.parse(textarea.value);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    button.disabled = false;
    return;
  }

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Speichern fehlgeschlagen.");
    status.textContent = "gespeichert";
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

loadConfig().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});
