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
  respondent: {},
  answers: {},
  timers: new Map(),
  saving: new Set(),
  dirty: new Set(),
  openCipher: null,
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

function surveyText(key, fallback = "") {
  return text(["/umfrage/:id", key], fallback);
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return globalText("open_value", "offen");
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
};

async function loadSurvey() {
  const response = await fetch(`/api/bootstrap?survey_id=${encodeURIComponent(window.SURVEY_ID)}`, {
    credentials: "same-origin",
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || surveyText("survey_load_failed", "Umfrage konnte nicht geladen werden."));

  state.config = payload.config;
  state.survey = payload.survey;
  state.responses = payload.responses || {};
  state.respondent = payload.respondent || {};
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

  app.innerHTML = `
    <section class="survey-header">
      <div>
        <h1>${escapeHtml(survey.title)}</h1>
        <p class="lead">${escapeHtml(survey.short_title || "")}</p>
      </div>
      <div class="participant-pill">${escapeHtml(participantSheetLabel())}</div>
    </section>

    <section class="sample-list">
      <div class="sample-tabs">
        ${survey.samples.map((sample) => renderSampleTab(sample)).join("")}
      </div>
      <div class="sample-detail-slot" id="sample-detail-slot"></div>
    </section>

    <footer class="survey-footer">
      <section class="progress-panel" aria-live="polite">
        <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
        <div class="progress-value" id="progress-value"></div>
      </section>
      <a class="ghost-button locked-link" id="linktree-link" href="/" aria-disabled="true">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
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

function renderSampleTab(sample) {
  const complete = isComplete(sample.cipher);
  const showTitle = state.survey.cipher_set === "greek";
  const open = state.openCipher === sample.cipher;
  return `
    <article class="sample-card sample-tab ${open ? "open" : ""} ${complete ? "complete" : ""}" data-cipher="${escapeHtml(sample.cipher)}">
      <button class="sample-header ${showTitle ? "" : "badge-only"}" type="button" data-action="toggle" data-cipher="${escapeHtml(sample.cipher)}">
        <span class="cipher-badge">${escapeHtml(cipherBadge(sample.cipher))}</span>
        ${showTitle ? `<span class="sample-title"><h2>${escapeHtml(sample.cipher)}</h2></span>` : ""}
        <span class="status-pill" data-status="${escapeHtml(sample.cipher)}">${complete ? escapeHtml(surveyText("complete", "fertig")) : escapeHtml(surveyText("incomplete", "offen"))}</span>
      </button>
    </article>
  `;
}

function renderSampleDetail(sample) {
  if (!sample) return "";
  return `
    <article class="sample-card sample-detail-card open ${isComplete(sample.cipher) ? "complete" : ""}" data-cipher="${escapeHtml(sample.cipher)}">
      <div class="sample-body">
        <div class="field-grid">
          ${state.survey.fields.map((field) => renderField(sample.cipher, field)).join("")}
        </div>
        <p class="save-state inline-save-state" data-save-state="${escapeHtml(sample.cipher)}">${state.responses[sample.cipher]?.updated_at ? escapeHtml(globalText("saved", "gespeichert")) : escapeHtml(globalText("not_saved", "noch nicht gespeichert"))}</p>
      </div>
    </article>
  `;
}

function renderOpenSampleDetail() {
  const slot = document.getElementById("sample-detail-slot");
  if (!slot) return;
  const sample = state.survey.samples.find((item) => item.cipher === state.openCipher);
  slot.innerHTML = sample ? renderSampleDetail(sample) : "";
  for (const input of slot.querySelectorAll('input[type="range"][data-field]')) {
    setRangeVisual(input);
  }
}

function updateOpenSampleHeaders() {
  for (const card of app.querySelectorAll(".sample-tab[data-cipher]")) {
    card.classList.toggle("open", card.dataset.cipher === state.openCipher);
  }
}

function participantSheetLabel() {
  const name = state.respondent.display_name || surveyText("participant_anonymous", "anonym");
  const index = state.config?.surveys?.findIndex((survey) => survey.id === state.survey?.id);
  const number = Number.isInteger(index) && index >= 0 ? index + 1 : "";
  return number ? `${name}'s ${surveyText("sheet_label", "Wertungsbogen")} ${number}` : name;
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
          <option value="">${escapeHtml(surveyText("select_placeholder", "Auswählen"))}</option>
          ${options
            .map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`)
            .join("")}
        </select>
      </div>
    `;
  }

  if (field.kind === "yes_no") {
    const yesValue = field.yes_value || "Olivenöl";
    const noValue = field.no_value || "Nicht-Olivenöl";
    const legendContent =
      field.id === "oil_guess"
        ? `<span class="active-cipher-badge">${escapeHtml(cipherBadge(cipher))}</span><span>${escapeHtml(field.label)}</span>`
        : escapeHtml(field.label);
    if (field.id === "oil_guess") {
      return `
        <fieldset class="field choice-field inline-choice-field">
          <legend class="visually-hidden">${escapeHtml(field.label)}</legend>
          <div class="inline-choice-question" aria-hidden="true">${legendContent}</div>
          <div class="choice-row">
            ${renderCheckOption(cipher, field.id, yesValue, surveyText("yes_label", "Ja"), value === yesValue)}
            ${renderCheckOption(cipher, field.id, noValue, surveyText("no_label", "Nein"), value === noValue)}
          </div>
        </fieldset>
      `;
    }
    return `
      <fieldset class="field choice-field">
        <legend>${legendContent}</legend>
        <div class="choice-row">
          ${renderCheckOption(cipher, field.id, yesValue, surveyText("yes_label", "Ja"), value === yesValue)}
          ${renderCheckOption(cipher, field.id, noValue, surveyText("no_label", "Nein"), value === noValue)}
        </div>
      </fieldset>
    `;
  }

  if (field.kind === "textarea") {
    const noCommentButton =
      field.id === "aroma_profile"
        ? `<button class="text-button no-comment-button" type="button" data-action="no-comment" data-cipher="${escapeHtml(cipher)}" data-field="${escapeHtml(field.id)}">${escapeHtml(surveyText("no_comment_button", "kein Kommentar"))}</button>`
        : "";
    return `
      <div class="field full">
        <div class="textarea-heading">
          <label for="${fieldId(cipher, field.id)}">${escapeHtml(field.label)}</label>
          ${noCommentButton}
        </div>
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
          <div class="range-control">
            ${renderTicks(min, max, Number(field.tick_step ?? step), Number(field.tick_min ?? min))}
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
          ${renderRangeLabels(field, min, max)}
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

function renderCheckOption(cipher, fieldIdValue, value, label, checked) {
  return `
    <label class="check-option">
      <input
        type="checkbox"
        value="${escapeHtml(value)}"
        data-cipher="${escapeHtml(cipher)}"
        data-field="${escapeHtml(fieldIdValue)}"
        ${checked ? "checked" : ""}
      >
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderTicks(min, max, step, tickMin = min) {
  const safeStep = Math.max(Number(step) || 1, 1);
  const start = Math.ceil(tickMin / safeStep) * safeStep;
  const values = [];
  for (let value = start; value <= max; value += safeStep) {
    values.push(value);
  }
  if (!values.length || values[0] !== tickMin) values.unshift(tickMin);
  if (values[values.length - 1] !== max) values.push(max);
  return `<div class="tick-row" aria-hidden="true">${values
    .map((value) => {
      const ratio = max === tickMin ? 0 : (value - tickMin) / (max - tickMin);
      return `<span style="left:${escapeHtml(Math.max(0, Math.min(100, ratio * 100)))}%"></span>`;
    })
    .join("")}</div>`;
}

function renderRangeLabels(field, min, max) {
  const midLabel = String(field.mid_label || "").trim();
  const midRatio = max === min ? 50 : ((0 - min) / (max - min)) * 100;
  return `
    <div class="range-labels ${midLabel ? "has-mid-label" : ""}">
      <span class="range-label-left">${escapeHtml(field.left_label || "")}</span>
      ${midLabel ? `<span class="range-label-mid" style="left:${escapeHtml(Math.max(0, Math.min(100, midRatio)))}%">${escapeHtml(midLabel)}</span>` : ""}
      <span class="range-label-right">${escapeHtml(field.right_label || "")}</span>
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
  const link = event.target.closest("#linktree-link");
  if (link?.classList.contains("locked-link")) {
    event.preventDefault();
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.action === "toggle") {
    state.openCipher = state.openCipher === target.dataset.cipher ? null : target.dataset.cipher;
    updateOpenSampleHeaders();
    renderOpenSampleDetail();
  }

  if (target.dataset.action === "no-comment") {
    const card = cardFor(target.dataset.cipher);
    const input = card?.querySelector(`textarea[data-field="${cssEscape(target.dataset.field)}"]`);
    if (!input) return;
    input.value = surveyText("no_comment_value", "kein Kommentar");
    updateAnswerFromInput(input);
    scheduleSave(target.dataset.cipher);
    updateCardState(target.dataset.cipher);
    updateProgress();
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
  if (input.type === "checkbox") {
    const group = input.closest(".choice-row");
    if (input.checked) {
      for (const other of group?.querySelectorAll('input[type="checkbox"]') || []) {
        if (other !== input) other.checked = false;
      }
      value = input.value;
    } else if (state.answers[cipher][field] === input.value) {
      value = "";
    } else {
      return;
    }
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
  setSaveState(cipher, globalText("saving", "speichert..."));
  clearTimeout(state.timers.get(cipher));
  state.timers.set(cipher, setTimeout(() => saveCipher(cipher), 600));
}

async function saveCipher(cipher) {
  const card = cardFor(cipher);
  if (state.saving.has(cipher)) return;
  state.dirty.delete(cipher);
  if (card) collectCardAnswers(card);
  state.saving.add(cipher);
  setSaveState(cipher, globalText("saving", "speichert..."));

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
    setSaveState(cipher, globalText("saved", "gespeichert"));
  } catch {
    setSaveState(cipher, globalText("save_error", "Fehler beim Speichern"));
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
  const cards = app.querySelectorAll(`[data-cipher="${cssEscape(cipher)}"]`);
  const complete = isComplete(cipher);
  for (const card of cards) {
    card.classList.toggle("complete", complete);
  }
  const status = app.querySelector(`[data-status="${cssEscape(cipher)}"]`);
  if (status) status.textContent = complete ? surveyText("complete", "fertig") : surveyText("incomplete", "offen");
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
  return app.querySelector(`.sample-detail-card[data-cipher="${cssEscape(cipher)}"]`);
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
