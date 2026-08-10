const app = document.getElementById("survey-app");

const state = {
  config: null,
  survey: null,
  responses: {},
  answers: {},
  timers: new Map(),
  saving: new Set(),
  dirty: new Set(),
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "offen";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
};

async function loadSurvey() {
  const response = await fetch(`/api/bootstrap?survey_id=${encodeURIComponent(window.SURVEY_ID)}`, {
    credentials: "same-origin",
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Umfrage konnte nicht geladen werden.");

  state.config = payload.config;
  state.survey = payload.survey;
  state.responses = payload.responses || {};
  state.answers = {};
  for (const sample of state.survey.samples) {
    state.answers[sample.cipher] = state.responses[sample.cipher]?.answers || {};
  }

  document.documentElement.style.setProperty("--accent", state.survey.accent || "#2f7d62");
  render(payload.respondent || {});
}

function render(respondent) {
  const survey = state.survey;
  const firstOpen = survey.samples.find((sample) => !isComplete(sample.cipher))?.cipher || survey.samples[0]?.cipher;

  app.innerHTML = `
    <section class="survey-header">
      <div>
        <p class="eyebrow">${escapeHtml(survey.method || "Umfrage")}</p>
        <h1>${escapeHtml(survey.title)}</h1>
        <p class="lead">${escapeHtml(survey.prompt || "")}</p>
      </div>
      <a class="ghost-button" href="/">Links</a>
    </section>

    <section class="identity-panel">
      <label>
        Name
        <input id="display-name" maxlength="80" autocomplete="name" value="${escapeHtml(respondent.display_name || "")}" placeholder="optional">
      </label>
      <div class="save-state" id="name-state">${escapeHtml(respondent.ip || "")}</div>
    </section>

    <section class="progress-panel" aria-live="polite">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-value" id="progress-value"></div>
    </section>

    <section class="sample-list">
      ${survey.samples.map((sample) => renderSample(sample, sample.cipher === firstOpen)).join("")}
    </section>
  `;

  app.addEventListener("click", handleClick);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleInput);
  updateProgress();
}

function renderSample(sample, open) {
  const complete = isComplete(sample.cipher);
  return `
    <article class="sample-card ${open ? "open" : ""} ${complete ? "complete" : ""}" data-cipher="${escapeHtml(sample.cipher)}">
      <button class="sample-header" type="button" data-action="toggle" data-cipher="${escapeHtml(sample.cipher)}">
        <span class="cipher-badge">${escapeHtml(sample.cipher.slice(0, 2))}</span>
        <span class="sample-title">
          <h2>${escapeHtml(sample.cipher)}</h2>
          <p>Probe ${escapeHtml(sample.cipher)}</p>
        </span>
        <span class="status-pill" data-status="${escapeHtml(sample.cipher)}">${complete ? "fertig" : "offen"}</span>
      </button>
      <div class="sample-body">
        <div class="field-grid">
          ${state.survey.fields.map((field) => renderField(sample.cipher, field)).join("")}
        </div>
        <div class="card-actions">
          <span class="save-state" data-save-state="${escapeHtml(sample.cipher)}">${state.responses[sample.cipher]?.updated_at ? "gespeichert" : "nicht gespeichert"}</span>
          <div class="topbar-actions">
            <button class="ghost-button" type="button" data-action="next" data-cipher="${escapeHtml(sample.cipher)}">Weiter</button>
            <button class="save-button" type="button" data-action="save" data-cipher="${escapeHtml(sample.cipher)}">Speichern</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderField(cipher, field) {
  const value = valueFor(cipher, field);
  const full = field.kind === "textarea" ? " full" : "";
  if (field.kind === "select") {
    const options = field.options || state.config.oil_type_options || [];
    return `
      <div class="field${full}">
        <label for="${fieldId(cipher, field.id)}">${escapeHtml(field.label)}</label>
        <select id="${fieldId(cipher, field.id)}" data-cipher="${escapeHtml(cipher)}" data-field="${escapeHtml(field.id)}">
          <option value="">Auswählen</option>
          ${options
            .map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`)
            .join("")}
        </select>
      </div>
    `;
  }

  if (field.kind === "textarea") {
    return `
      <div class="field full">
        <label for="${fieldId(cipher, field.id)}">${escapeHtml(field.label)}</label>
        <textarea id="${fieldId(cipher, field.id)}" data-cipher="${escapeHtml(cipher)}" data-field="${escapeHtml(field.id)}" rows="4" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value)}</textarea>
        ${renderChips(cipher, field)}
      </div>
    `;
  }

  if (field.kind === "rating" || field.kind === "range") {
    const min = Number(field.min ?? 0);
    const max = Number(field.max ?? 5);
    const step = Number(field.step ?? 1);
    return `
      <div class="field">
        <label for="${fieldId(cipher, field.id)}">${escapeHtml(field.label)}</label>
        <div class="range-row">
          <output>${escapeHtml(min)}</output>
          <input
            id="${fieldId(cipher, field.id)}"
            type="range"
            min="${escapeHtml(min)}"
            max="${escapeHtml(max)}"
            step="${escapeHtml(step)}"
            value="${escapeHtml(value)}"
            data-cipher="${escapeHtml(cipher)}"
            data-field="${escapeHtml(field.id)}"
          >
          <output data-output="${escapeHtml(cipher)}:${escapeHtml(field.id)}">${escapeHtml(formatValue(value))}</output>
        </div>
        <div class="range-labels">
          <span>${escapeHtml(field.left_label || "")}</span>
          <span>${escapeHtml(field.right_label || "")}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="field${full}">
      <label for="${fieldId(cipher, field.id)}">${escapeHtml(field.label)}</label>
      <input id="${fieldId(cipher, field.id)}" type="text" data-cipher="${escapeHtml(cipher)}" data-field="${escapeHtml(field.id)}" value="${escapeHtml(value)}">
    </div>
  `;
}

function renderChips(cipher, field) {
  if (!field.chips?.length) return "";
  return `
    <div class="chip-row">
      ${field.chips.map((chip) => `<button class="chip-button" type="button" data-action="chip" data-cipher="${escapeHtml(cipher)}" data-field="${escapeHtml(field.id)}" data-chip="${escapeHtml(chip)}">${escapeHtml(chip)}</button>`).join("")}
    </div>
  `;
}

function fieldId(cipher, fieldIdValue) {
  return `${cipher}-${fieldIdValue}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function valueFor(cipher, field) {
  const answer = state.answers[cipher]?.[field.id];
  if (answer !== undefined && answer !== null && answer !== "") return answer;
  if ((field.kind === "rating" || field.kind === "range") && field.default !== undefined) return field.default;
  return "";
}

function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const cipher = target.dataset.cipher;

  if (action === "toggle") {
    const card = cardFor(cipher);
    card?.classList.toggle("open");
  }

  if (action === "save") {
    saveCipher(cipher);
  }

  if (action === "next") {
    saveCipher(cipher).finally(() => openNext(cipher));
  }

  if (action === "chip") {
    const field = target.dataset.field;
    const textarea = app.querySelector(`[data-cipher="${cssEscape(cipher)}"][data-field="${cssEscape(field)}"]`);
    if (textarea) {
      const chip = target.dataset.chip;
      const current = textarea.value.trim();
      const parts = current ? current.split(/\s*,\s*/) : [];
      if (!parts.map((part) => part.toLocaleLowerCase("de-DE")).includes(chip.toLocaleLowerCase("de-DE"))) {
        textarea.value = current ? `${current}, ${chip}` : chip;
        updateAnswerFromInput(textarea);
        scheduleSave(cipher);
      }
    }
  }
}

function handleInput(event) {
  const target = event.target;
  if (!target?.dataset?.field || !target.dataset.cipher) return;
  updateAnswerFromInput(target);
  scheduleSave(target.dataset.cipher);
}

function updateAnswerFromInput(input) {
  const cipher = input.dataset.cipher;
  const field = input.dataset.field;
  if (!state.answers[cipher]) state.answers[cipher] = {};

  let value = input.value;
  if (input.type === "range") {
    value = Number(input.value);
    const output = app.querySelector(`[data-output="${cssEscape(`${cipher}:${field}`)}"]`);
    if (output) output.textContent = formatValue(value);
  }

  state.answers[cipher][field] = value;
  updateCardState(cipher);
  updateProgress();
}

function scheduleSave(cipher) {
  state.dirty.add(cipher);
  setSaveState(cipher, "speichert...");
  clearTimeout(state.timers.get(cipher));
  state.timers.set(cipher, setTimeout(() => saveCipher(cipher), 600));
}

async function saveCipher(cipher) {
  const card = cardFor(cipher);
  if (!card || state.saving.has(cipher)) return;
  state.dirty.delete(cipher);
  collectCardAnswers(card);
  state.saving.add(cipher);
  setSaveState(cipher, "speichert...");

  const button = card.querySelector('[data-action="save"]');
  if (button) button.disabled = true;

  try {
    const response = await fetch("/api/response", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        survey_id: state.survey.id,
        cipher,
        display_name: document.getElementById("display-name")?.value || "",
        answers: state.answers[cipher] || {},
      }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Speichern fehlgeschlagen.");
    state.responses[cipher] = { answers: state.answers[cipher], updated_at: payload.updated_at };
    setSaveState(cipher, "gespeichert");
  } catch (error) {
    setSaveState(cipher, "Fehler beim Speichern");
  } finally {
    state.saving.delete(cipher);
    if (button) button.disabled = false;
    updateCardState(cipher);
    updateProgress();
    if (state.dirty.has(cipher)) scheduleSave(cipher);
  }
}

function collectCardAnswers(card) {
  for (const input of card.querySelectorAll("input[data-field], select[data-field], textarea[data-field]")) {
    updateAnswerFromInput(input);
  }
}

let nameTimer = null;
async function saveNameSoon() {
  const input = document.getElementById("display-name");
  const status = document.getElementById("name-state");
  if (!input || !status) return;
  status.textContent = "speichert...";
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/respondent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: input.value }),
      });
      const payload = await response.json();
      status.textContent = payload.ok ? "gespeichert" : "Fehler";
    } catch {
      status.textContent = "Fehler";
    }
  }, 500);
}

function isComplete(cipher) {
  const answers = state.answers[cipher] || {};
  return state.survey.fields.every((field) => {
    if (field.kind === "textarea") return true;
    const value = answers[field.id];
    return value !== undefined && value !== null && value !== "";
  });
}

function updateCardState(cipher) {
  const card = cardFor(cipher);
  if (!card) return;
  const complete = isComplete(cipher);
  card.classList.toggle("complete", complete);
  const status = card.querySelector(`[data-status="${cssEscape(cipher)}"]`);
  if (status) status.textContent = complete ? "fertig" : "offen";
}

function updateProgress() {
  const total = state.survey.samples.length;
  const done = state.survey.samples.filter((sample) => isComplete(sample.cipher)).length;
  const ratio = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById("progress-fill");
  const value = document.getElementById("progress-value");
  if (fill) fill.style.width = `${ratio}%`;
  if (value) value.textContent = `${done}/${total}`;
}

function setSaveState(cipher, label) {
  const node = app.querySelector(`[data-save-state="${cssEscape(cipher)}"]`);
  if (node) node.textContent = label;
}

function openNext(cipher) {
  const samples = state.survey.samples;
  const currentIndex = samples.findIndex((sample) => sample.cipher === cipher);
  const next = samples[currentIndex + 1];
  if (!next) return;
  for (const card of app.querySelectorAll(".sample-card.open")) card.classList.remove("open");
  cardFor(next.cipher)?.classList.add("open");
  cardFor(next.cipher)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cardFor(cipher) {
  return app.querySelector(`.sample-card[data-cipher="${cssEscape(cipher)}"]`);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

document.addEventListener("input", (event) => {
  if (event.target?.id === "display-name") saveNameSoon();
});

loadSurvey().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});
