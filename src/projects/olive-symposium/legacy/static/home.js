const homeApp = document.getElementById("home-app");
const INFO_SEEN_PREFIX = "oil_tasting_registration_info_seen:";

let homeState = window.HOME_STATE || null;
let ownerSelectionTouched = false;

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

function homeText(key, fallback = "") {
  return text(["/", key], fallback);
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function participantElements() {
  return {
    form: document.getElementById("participant-form"),
    name: document.getElementById("participant-name"),
    pin: document.getElementById("participant-pin"),
    publish: document.getElementById("participant-publish"),
    publishCompetitive: document.getElementById("participant-publish-competitive"),
    login: document.getElementById("participant-login"),
    logout: document.getElementById("participant-logout"),
    state: document.getElementById("participant-state"),
    infoButton: document.getElementById("participant-info-button"),
    infoPopover: document.getElementById("participant-info-popover"),
  };
}

function setParticipantState(message, error = false) {
  const { state } = participantElements();
  if (!state) return;
  state.textContent = message;
  state.classList.toggle("error", error);
}

function setSubmissionState(message, error = false) {
  const node = document.getElementById("submission-state");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", error);
}

function modeLabel(mode) {
  const labels = {
    preparation: homeText("mode_preparation", "Vorbereitung"),
    execution: homeText("mode_execution", "Durchführung"),
    evaluation: homeText("mode_evaluation", "Auswertung"),
  };
  return labels[mode] || mode;
}

function applyPublicationLocks(payload) {
  const { publish, publishCompetitive } = participantElements();
  for (const input of [publish, publishCompetitive]) {
    if (!input) continue;
    input.disabled = Boolean(payload.event_finished && input.checked);
    input.title = input.disabled
      ? homeText("publish_locked_notice", "Nach Ende der Umfrage kann eine Veröffentlichung nicht mehr zurückgenommen werden.")
      : "";
  }
}

function hydrateParticipantForm(payload) {
  const participant = payload.participant || {};
  const elements = participantElements();
  if (elements.name) elements.name.value = participant.display_name || "";
  if (elements.pin) elements.pin.value = "";
  if (elements.publish) elements.publish.checked = Boolean(participant.publish_name);
  if (elements.publishCompetitive) elements.publishCompetitive.checked = Boolean(participant.publish_competitive_name);
  if (elements.logout) elements.logout.hidden = !participant.authenticated;
  if (elements.login) {
    elements.login.textContent = participant.authenticated
      ? homeText("participant_update_button", "Anmeldung aktualisieren")
      : homeText("participant_login_button", "Anmelden");
  }
  applyPublicationLocks(payload);
  updateInfoPulse();
}

function applyAccess(payload) {
  const capabilities = payload.capabilities || {};
  homeApp.dataset.eventMode = payload.event_mode || "preparation";
  const badge = document.getElementById("event-mode-badge");
  if (badge) {
    badge.className = `event-mode-badge mode-${payload.event_mode || "preparation"}`;
    badge.textContent = modeLabel(payload.event_mode);
  }

  for (const link of homeApp.querySelectorAll(".survey-entry-link")) {
    link.classList.toggle("locked-link", !capabilities.open_surveys);
    link.setAttribute("aria-disabled", capabilities.open_surveys ? "false" : "true");
  }
  for (const link of homeApp.querySelectorAll(".result-entry-link")) {
    link.classList.toggle("locked-link", !capabilities.open_results);
    link.setAttribute("aria-disabled", capabilities.open_results ? "false" : "true");
  }

  const details = document.getElementById("new-submission");
  if (details) {
    details.dataset.disabled = capabilities.submit_oil ? "false" : "true";
    if (!capabilities.submit_oil) details.open = false;
    const summary = details.querySelector("summary");
    summary?.classList.toggle("locked-link", !capabilities.submit_oil);
    summary?.setAttribute("aria-disabled", capabilities.submit_oil ? "false" : "true");
  }
  const submitButton = document.getElementById("submit-oil-button");
  if (submitButton) submitButton.disabled = !capabilities.submit_oil || Number(payload.submission_capacity || 0) < 1;
}

function renderOwnerOptions(payload, reset = false) {
  const container = document.getElementById("submission-owner-options");
  if (!container) return;
  const checked = new Set(
    reset || !ownerSelectionTouched
      ? [String(payload.participant?.id || "")]
      : [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => String(input.value)),
  );
  container.innerHTML = (payload.participants || [])
    .map((participant) => {
      const id = String(participant.id);
      return `
        <label class="check-option submission-owner-option">
          <input type="checkbox" value="${escapeHtml(id)}" ${checked.has(id) ? "checked" : ""}>
          <span>${escapeHtml(participant.display_name)}</span>
        </label>
      `;
    })
    .join("");
}

function chartX(value) {
  return Math.max(0, Math.min(100, ((Number(value) + 5) / 10) * 100));
}

function renderSubmissionBar(value, color, title) {
  if (value === null || value === undefined) return `<span class="overall-bar-slot empty" title="${escapeHtml(title)}"></span>`;
  const position = chartX(value);
  const left = Math.min(position, 50);
  const width = Math.abs(position - 50);
  const direction = Number(value) >= 0 ? "positive" : "negative";
  return `
    <span class="overall-bar-slot" title="${escapeHtml(`${title}: ${Number(value).toFixed(2).replace(".", ",")}`)}">
      <span class="overall-bar ${direction}" style="--bar-color:${escapeHtml(color)};--bar-left:${left.toFixed(3)}%;--bar-width:${Math.max(0.8, width).toFixed(3)}%"></span>
    </span>
  `;
}

function renderSubmissionChart(submission, series) {
  if (!submission.overall) return "";
  const mean = submission.overall.all?.avg;
  const meanLine = mean === null || mean === undefined
    ? ""
    : `<span class="overall-mean-line" style="--mean-left:${chartX(mean).toFixed(3)}%" title="${escapeHtml(homeText("submission_mean_label", "Mittelwert"))}: ${escapeHtml(Number(mean).toFixed(2).replace(".", ","))}"></span>`;
  return `
    <div class="submission-result-chart" aria-label="${escapeHtml(homeText("submission_chart_label", "Drei Testreihen und Mittelwert"))}">
      <span class="submission-chart-zero" aria-hidden="true"></span>
      <div class="overall-bars">
        ${series.map((survey) => renderSubmissionBar(submission.overall.by_survey?.[survey.id]?.avg, survey.accent, survey.title)).join("")}
        ${meanLine}
      </div>
    </div>
  `;
}

function renderSubmissions(payload) {
  const container = document.getElementById("own-submissions");
  const count = document.getElementById("submission-count");
  if (!container) return;
  const submissions = payload.submissions || [];
  if (count) count.textContent = String(submissions.length);
  if (!payload.participant?.authenticated) {
    container.innerHTML = `<p class="notice">${escapeHtml(homeText("submissions_login_hint", "Melde dich an, damit deine eingereichten Öle hier erscheinen."))}</p>`;
    return;
  }
  if (!submissions.length) {
    container.innerHTML = `<p class="notice">${escapeHtml(homeText("submissions_empty", "Du hast noch kein Öl eingereicht."))}</p>`;
    return;
  }
  container.innerHTML = submissions
    .map((submission) => {
      const owners = submission.brought_by_name
        ? `${homeText("submission_from_prefix", "von")} ${submission.brought_by_name}`
        : homeText("submission_owner_missing", "ohne Zuordnung");
      const price = submission.actual_price_per_liter_eur === null || submission.actual_price_per_liter_eur === undefined
        ? ""
        : `${Math.round(Number(submission.actual_price_per_liter_eur))} €/l`;
      return `
        <article class="own-submission-item">
          <div class="own-submission-copy">
            <strong>${escapeHtml(submission.name)}</strong>
            <span>${escapeHtml([owners, submission.type, price].filter(Boolean).join(" · "))}</span>
          </div>
          ${payload.event_finished ? renderSubmissionChart(submission, payload.survey_series || []) : ""}
        </article>
      `;
    })
    .join("");
}

function applyState(payload, hydrateForm = false, resetOwners = false) {
  homeState = payload;
  applyAccess(payload);
  if (hydrateForm) hydrateParticipantForm(payload);
  renderOwnerOptions(payload, resetOwners);
  renderSubmissions(payload);
}

async function parseResponse(response, fallback) {
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || fallback);
  return payload;
}

async function loginParticipant(event) {
  event?.preventDefault();
  const elements = participantElements();
  elements.login.disabled = true;
  setParticipantState(globalText("saving", "speichert..."));
  try {
    const response = await fetch("/api/participant", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: elements.name?.value || "",
        pin: elements.pin?.value || "",
        publish_name: Boolean(elements.publish?.checked),
        publish_competitive_name: Boolean(elements.publishCompetitive?.checked),
      }),
    });
    const payload = await parseResponse(response, homeText("participant_save_failed", "Anmeldung fehlgeschlagen."));
    applyState(payload, true, true);
    setParticipantState(
      payload.pin_was_set
        ? homeText("participant_pin_set", "Angemeldet. Deine neue PIN wurde gespeichert.")
        : homeText("participant_logged_in", "Angemeldet."),
    );
  } catch (error) {
    setParticipantState(error.message, true);
    elements.pin?.focus();
    elements.pin?.select();
  } finally {
    elements.login.disabled = false;
  }
}

async function logoutParticipant() {
  const response = await fetch("/api/participant/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = await parseResponse(response, homeText("participant_logout_failed", "Abmelden fehlgeschlagen."));
  ownerSelectionTouched = false;
  applyState(payload, true, true);
  setParticipantState(homeText("participant_logged_out", "Abgemeldet."));
}

async function submitOil() {
  const button = document.getElementById("submit-oil-button");
  if (!button) return;
  const ownerIds = [...document.querySelectorAll('#submission-owner-options input[type="checkbox"]:checked')]
    .map((input) => Number(input.value));
  button.disabled = true;
  setSubmissionState(globalText("saving", "speichert..."));
  try {
    const response = await fetch("/api/submissions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("submission-name")?.value.trim() || "",
        actual_price_per_liter_eur: document.getElementById("submission-price")?.value || "",
        is_olive_oil: Boolean(document.getElementById("submission-is-olive")?.checked),
        owner_ids: ownerIds,
      }),
    });
    const payload = await parseResponse(response, homeText("submission_failed", "Öl konnte nicht eingereicht werden."));
    document.getElementById("submission-name").value = "";
    document.getElementById("submission-price").value = "";
    document.getElementById("submission-is-olive").checked = true;
    document.getElementById("new-submission").open = false;
    ownerSelectionTouched = false;
    applyState(payload, false, true);
    setSubmissionState(homeText("submission_saved", "Öl eingereicht."));
  } catch (error) {
    setSubmissionState(error.message, true);
  } finally {
    button.disabled = !homeState?.capabilities?.submit_oil || Number(homeState?.submission_capacity || 0) < 1;
  }
}

function normalizedName() {
  return String(participantElements().name?.value || "").trim().toLocaleLowerCase("de-DE");
}

function infoSeenKey() {
  const name = normalizedName();
  return name ? `${INFO_SEEN_PREFIX}${name}` : "";
}

function updateInfoPulse() {
  const { infoButton } = participantElements();
  if (!infoButton) return;
  const key = infoSeenKey();
  const seen = key ? window.localStorage?.getItem(key) === "1" : false;
  infoButton.classList.toggle("needs-attention", !seen);
}

function closeInfoPopover() {
  const elements = participantElements();
  elements.infoButton?.setAttribute("aria-expanded", "false");
  elements.infoPopover?.classList.remove("open");
}

homeApp?.addEventListener("click", (event) => {
  const infoButton = event.target.closest("#participant-info-button");
  if (infoButton) {
    const elements = participantElements();
    const expanded = infoButton.getAttribute("aria-expanded") === "true";
    infoButton.setAttribute("aria-expanded", expanded ? "false" : "true");
    elements.infoPopover?.classList.toggle("open", !expanded);
    const key = infoSeenKey();
    if (key) window.localStorage?.setItem(key, "1");
    updateInfoPulse();
    return;
  }

  if (event.target.closest("#participant-logout")) {
    logoutParticipant().catch((error) => setParticipantState(error.message, true));
    return;
  }
  if (event.target.closest("#submit-oil-button")) {
    submitOil();
    return;
  }

  const lockedLink = event.target.closest(".locked-link");
  if (!lockedLink) return;
  event.preventDefault();
  if (lockedLink.closest("#new-submission")) {
    setSubmissionState(homeText("submission_locked", "Neue Öle können nur in der Vorbereitung eingereicht werden."), true);
    return;
  }
  if (lockedLink.classList.contains("result-entry-link")) {
    setParticipantState(homeText("results_locked", "Ergebnisse werden erst in der Auswertung freigeschaltet."), true);
    return;
  }
  const message = homeState?.event_mode === "preparation"
    ? homeText("surveys_preparation_locked", "Die Umfragen werden mit Beginn der Durchführung freigeschaltet.")
    : homeText("participant_locked", "Bitte zuerst mit Name und PIN anmelden.");
  setParticipantState(message, true);
  participantElements().name?.focus();
});

homeApp?.addEventListener("toggle", (event) => {
  const details = event.target.closest?.("#new-submission");
  if (!details || details.dataset.disabled !== "true" || !details.open) return;
  details.open = false;
  setSubmissionState(homeText("submission_locked", "Neue Öle können nur in der Vorbereitung eingereicht werden."), true);
}, true);

homeApp?.addEventListener("change", (event) => {
  if (event.target.closest?.('#submission-owner-options input[type="checkbox"]')) ownerSelectionTouched = true;
});

homeApp?.addEventListener("input", (event) => {
  if (event.target?.id === "participant-pin") {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
  }
  if (event.target?.id === "participant-name") updateInfoPulse();
});

participantElements().form?.addEventListener("submit", loginParticipant);

document.addEventListener("click", (event) => {
  if (event.target.closest(".participant-info")) return;
  closeInfoPopover();
});

if (homeState) {
  applyState(homeState, true, true);
  setParticipantState(
    homeState.participant?.authenticated
      ? homeText("participant_logged_in", "Angemeldet.")
      : homeText("participant_need_login", "Bitte Name und PIN eingeben."),
  );
} else {
  fetch("/api/participant", { credentials: "same-origin" })
    .then((response) => parseResponse(response, homeText("participant_load_failed", "Anmeldung konnte nicht geladen werden.")))
    .then((payload) => applyState(payload, true, true))
    .catch((error) => setParticipantState(error.message, true));
}
