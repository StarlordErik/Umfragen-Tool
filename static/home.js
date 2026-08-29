const homeApp = document.getElementById("home-app");
const AUTOSAVE_DELAY = 450;
const INFO_SEEN_PREFIX = "oil_tasting_registration_info_seen:";
let saveTimer = null;

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

function participantElements() {
  return {
    name: document.getElementById("participant-name"),
    publish: document.getElementById("participant-publish"),
    publishCompetitive: document.getElementById("participant-publish-competitive"),
    state: document.getElementById("participant-state"),
    infoButton: document.getElementById("participant-info-button"),
    infoPopover: document.getElementById("participant-info-popover"),
  };
}

function applyPublicationLocks(eventFinished) {
  const { publish, publishCompetitive } = participantElements();
  for (const input of [publish, publishCompetitive]) {
    if (!input) continue;
    input.disabled = Boolean(eventFinished && input.checked);
    input.title = input.disabled
      ? homeText("publish_locked_notice", "Nach Ende der Umfrage kann eine Veröffentlichung nicht mehr zurückgenommen werden.")
      : "";
  }
}

function setParticipantState(message, error = false) {
  const { state } = participantElements();
  if (!state) return;
  state.textContent = message;
  state.classList.toggle("error", error);
}

function updateSurveyAccess(displayName) {
  const hasName = String(displayName || "").trim().length > 0;
  for (const link of homeApp?.querySelectorAll(".survey-entry-link") || []) {
    link.classList.toggle("locked-link", !hasName);
    link.setAttribute("aria-disabled", hasName ? "false" : "true");
  }
  for (const button of homeApp?.querySelectorAll('.export-panel button[type="submit"]') || []) {
    button.disabled = !hasName;
  }
  return hasName;
}

async function loadParticipant() {
  const response = await fetch("/api/participant", { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || homeText("participant_load_failed", "Name konnte nicht geladen werden."));

  const elements = participantElements();
  if (elements.name) elements.name.value = payload.participant.display_name || "";
  if (elements.publish) elements.publish.checked = Boolean(payload.participant.publish_name);
  if (elements.publishCompetitive) elements.publishCompetitive.checked = Boolean(payload.participant.publish_competitive_name);
  applyPublicationLocks(payload.event_finished);

  const hasName = updateSurveyAccess(payload.participant.display_name);
  setParticipantState(hasName ? globalText("saved", "gespeichert") : homeText("participant_need_name", "Bitte Namen eingeben, um die Umfragen zu öffnen."));
  updateInfoPulse();
}

async function saveParticipant() {
  const elements = participantElements();
  const typedName = elements.name?.value || "";
  const response = await fetch("/api/participant", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: typedName,
      publish_name: Boolean(elements.publish?.checked),
      publish_competitive_name: Boolean(elements.publishCompetitive?.checked),
    }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || homeText("participant_save_failed", "Name konnte nicht gespeichert werden."));

  if (elements.name) elements.name.value = payload.participant.display_name || "";
  if (elements.publish) elements.publish.checked = Boolean(payload.participant.publish_name);
  if (elements.publishCompetitive) elements.publishCompetitive.checked = Boolean(payload.participant.publish_competitive_name);
  applyPublicationLocks(payload.event_finished);

  const hasName = updateSurveyAccess(payload.participant.display_name);
  setParticipantState(hasName ? globalText("saved", "gespeichert") : homeText("participant_need_name", "Bitte Namen eingeben, um die Umfragen zu öffnen."));
  updateInfoPulse();
}

function scheduleParticipantSave(delay = AUTOSAVE_DELAY) {
  const elements = participantElements();
  clearTimeout(saveTimer);

  if (!String(elements.name?.value || "").trim()) {
    updateSurveyAccess("");
    setParticipantState(homeText("participant_need_name", "Bitte Namen eingeben, um die Umfragen zu öffnen."));
  } else {
    setParticipantState(globalText("saving", "speichert..."));
  }

  saveTimer = setTimeout(() => {
    saveParticipant().catch((error) => setParticipantState(error.message, true));
  }, delay);
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
    if (key) {
      window.localStorage?.setItem(key, "1");
      updateInfoPulse();
    }
    return;
  }

  const lockedSurvey = event.target.closest(".survey-entry-link.locked-link");
  if (!lockedSurvey) return;

  event.preventDefault();
  setParticipantState(homeText("participant_locked", "Bitte zuerst einen Namen eingeben."), true);
  participantElements().name?.focus();
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".participant-info")) return;
  closeInfoPopover();
});

homeApp?.addEventListener("input", (event) => {
  if (event.target?.id !== "participant-name") return;
  scheduleParticipantSave();
  updateInfoPulse();
});

homeApp?.addEventListener("change", (event) => {
  if (event.target?.id === "export-competitive") {
    const elements = participantElements();
    if (event.target.checked && elements.publishCompetitive && !elements.publishCompetitive.checked) {
      elements.publishCompetitive.checked = true;
      setParticipantState(globalText("saving", "speichert..."));
      saveParticipant().catch((error) => {
        event.target.checked = false;
        elements.publishCompetitive.checked = false;
        setParticipantState(error.message, true);
      });
    }
    return;
  }
  if (!["participant-publish", "participant-publish-competitive"].includes(event.target?.id)) return;
  scheduleParticipantSave(0);
});

homeApp?.addEventListener("submit", async (event) => {
  const form = event.target.closest(".export-panel form");
  const exportCompetitive = form?.querySelector("#export-competitive");
  if (!form || !exportCompetitive?.checked) return;
  event.preventDefault();
  const elements = participantElements();
  if (elements.publishCompetitive) elements.publishCompetitive.checked = true;
  try {
    await saveParticipant();
    form.submit();
  } catch (error) {
    exportCompetitive.checked = false;
    if (elements.publishCompetitive && !elements.publishCompetitive.disabled) elements.publishCompetitive.checked = false;
    setParticipantState(error.message, true);
  }
});

homeApp?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target?.id !== "participant-name") return;
  event.preventDefault();
  scheduleParticipantSave(0);
  event.target.blur();
});

loadParticipant().catch((error) => {
  setParticipantState(error.message, true);
  updateInfoPulse();
});
