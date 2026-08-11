const app = document.getElementById("survey-app");

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
    state.answers[sample.cipher] = { ...(state.responses[sample.cipher]?.answers || {}) };
    applyDefaultAnswers(sample.cipher);
  }

  document.documentElement.style.setProperty("--accent", state.survey.accent || "#2f7d62");
  render();
}

function applyDefaultAnswers(cipher) {
  for (const field of state.survey.fields) {
    if ((field.kind === "rating" || field.kind === "range") && state.answers[cipher][field.id] === undefined) {
      state.answers[cipher][field.id] = field.default ?? field.min ?? 0;
    }
  }
}

function render() {
  const survey = state.survey;
  const firstOpen = survey.samples.find((sample) => !isComplete(sample.cipher))?.cipher || survey.samples[0]?.cipher;

  app.innerHTML = `
    <section class="survey-header">
      <div>
        <h1>${escapeHtml(survey.title)}</h1>
        <p class="lead">${escapeHtml(survey.short_title || "")}</p>
      </div>
    </section>

    <section class="sample-list">
      ${survey.samples.map((sample) => renderSample(sample, sample.cipher === firstOpen)).join("")}
    </section>

    <footer class="survey-footer">
      <section class="progress-panel" aria-live="polite">
        <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
        <div class="progress-value" id="progress-value"></div>
      </section>
      <a class="ghost-button locked-link" id="linktree-link" href="/" aria-disabled="true">Linktree zum Oliven-Symposium</a>
    </footer>
  `;

  app.addEventListener("click", handleClick);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleInput);
  for (const input of app.querySelectorAll('input[type="range"][data-field]')) {
    setRangeVisual(input);
  }
  updateProgress();
}

function renderSample(sample, open) {
  const complete = isComplete(sample.cipher);
  const showTitle = state.survey.cipher_set === "greek";
  return `
    <article class="sample-card ${open ? "open" : ""} ${complete ? "complete" : ""}" data-cipher="${escapeHtml(sample.cipher)}">
      <button class="sample-header ${showTitle ? "" : "badge-only"}" type="button" data-action="toggle" data-cipher="${escapeHtml(sample.cipher)}">
        <span class="cipher-badge">${escapeHtml(cipherBadge(sample.cipher))}</span>
        ${showTitle ? `<span class="sample-title"><h2>${escapeHtml(sample.cipher)}</h2></span>` : ""}
        <span class="status-pill" data-status="${escapeHtml(sample.cipher)}">${complete ? "fertig" : "offen"}</span>
      </button>
      <div class="sample-body">
        <div class="field-grid">
          ${state.survey.fields.map((field) => renderField(sample.cipher, field)).join("")}
        </div>
        <p class="save-state inline-save-state" data-save-state="${escapeHtml(sample.cipher)}">${state.responses[sample.cipher]?.updated_at ? "gespeichert" : "noch nicht gespeichert"}</p>
      </div>
    </article>
  `;
}

function cipherBadge(cipher) {
  if (state.survey.cipher_set === "greek") return greekSymbols[cipher] || cipher;
  return cipher;
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
        <div class="range-widget">
          <div class="range-endpoints">
            <span>${escapeHtml(min)}</span>
            <span>${escapeHtml(max)}</span>
          </div>
          <div class="range-control">
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
            <output class="range-bubble" data-output="${escapeHtml(cipher)}:${escapeHtml(field.id)}">${escapeHtml(formatValue(value))}</output>
          </div>
          ${renderTicks(min, max, step)}
          <div class="range-labels">
            <span>${escapeHtml(field.left_label || "")}</span>
            <span>${escapeHtml(field.right_label || "")}</span>
          </div>
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

function renderTicks(min, max, step) {
  const count = Math.floor((max - min) / step) + 1;
  return `<div class="tick-row" aria-hidden="true">${Array.from({ length: count }, () => "<span></span>").join("")}</div>`;
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
  const link = event.target.closest("#linktree-link");
  if (link?.classList.contains("locked-link")) {
    event.preventDefault();
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.action === "toggle") {
    const card = cardFor(target.dataset.cipher);
    card?.classList.toggle("open");
    setTimeout(() => updateCardRanges(card), 0);
  }
}

function handleInput(event) {
  const target = event.target;
  if (!target?.dataset?.field || !target.dataset.cipher) return;
  updateAnswerFromInput(target);
  scheduleSave(target.dataset.cipher);
  updateCardState(target.dataset.cipher);
  updateProgress();
}

function updateAnswerFromInput(input) {
  const cipher = input.dataset.cipher;
  const field = input.dataset.field;
  if (!state.answers[cipher]) state.answers[cipher] = {};

  let value = input.value;
  if (input.type === "range") {
    value = Number(input.value);
    setRangeVisual(input);
  }

  state.answers[cipher][field] = value;
}

function setRangeVisual(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const percent = ratio * 100;
  const control = input.closest(".range-control");
  const output = control?.querySelector(".range-bubble");
  if (control) control.style.setProperty("--range-pos", `${percent}%`);
  if (output) {
    const inputWidth = input.getBoundingClientRect().width;
    const thumbWidth = 32;
    if (inputWidth > thumbWidth) {
      output.style.left = `${thumbWidth / 2 + ratio * (inputWidth - thumbWidth)}px`;
    } else {
      output.style.left = `${percent}%`;
    }
    output.textContent = formatValue(value);
  }
}

function updateCardRanges(card) {
  if (!card) return;
  for (const input of card.querySelectorAll('input[type="range"][data-field]')) {
    setRangeVisual(input);
  }
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

  try {
    const response = await fetch("/api/response", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        survey_id: state.survey.id,
        cipher,
        answers: state.answers[cipher] || {},
      }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Speichern fehlgeschlagen.");
    state.responses[cipher] = {
      answers: cloneAnswers(state.answers[cipher] || {}),
      updated_at: payload.updated_at,
    };
    setSaveState(cipher, "gespeichert");
  } catch {
    setSaveState(cipher, "Fehler beim Speichern");
  } finally {
    state.saving.delete(cipher);
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

function cloneAnswers(answers) {
  return JSON.parse(JSON.stringify(answers));
}

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

function isComplete(cipher) {
  if (state.dirty.has(cipher) || state.saving.has(cipher)) return false;
  const saved = state.responses[cipher]?.answers || {};
  return hasText(saved.oil_guess) && hasText(saved.aroma_profile);
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
  const link = document.getElementById("linktree-link");
  if (fill) fill.style.width = `${ratio}%`;
  if (value) value.textContent = `${done}/${total}`;
  if (link) {
    const locked = done < total;
    link.classList.toggle("locked-link", locked);
    link.setAttribute("aria-disabled", locked ? "true" : "false");
  }
}

function setSaveState(cipher, label) {
  const node = app.querySelector(`[data-save-state="${cssEscape(cipher)}"]`);
  if (node) node.textContent = label;
}

function cardFor(cipher) {
  return app.querySelector(`.sample-card[data-cipher="${cssEscape(cipher)}"]`);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

window.addEventListener("resize", () => {
  for (const input of app.querySelectorAll('input[type="range"][data-field]')) {
    setRangeVisual(input);
  }
});

loadSurvey().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});
