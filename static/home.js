const homeApp = document.getElementById("home-app");
const AUTOSAVE_DELAY = 450;
let saveTimer = null;

function participantElements() {
  return {
    name: document.getElementById("participant-name"),
    publish: document.getElementById("participant-publish"),
    state: document.getElementById("participant-state"),
  };
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
  return hasName;
}

async function loadParticipant() {
  const response = await fetch("/api/participant", { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Name konnte nicht geladen werden.");

  const elements = participantElements();
  if (elements.name) elements.name.value = payload.participant.display_name || "";
  if (elements.publish) elements.publish.checked = Boolean(payload.participant.publish_name);

  const hasName = updateSurveyAccess(payload.participant.display_name);
  setParticipantState(hasName ? "gespeichert" : "Bitte Namen eingeben, um die Umfragen zu öffnen.");
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
    }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Name konnte nicht gespeichert werden.");

  if (elements.name) elements.name.value = payload.participant.display_name || "";
  if (elements.publish) elements.publish.checked = Boolean(payload.participant.publish_name);

  const hasName = updateSurveyAccess(payload.participant.display_name);
  setParticipantState(hasName ? "gespeichert" : "Bitte Namen eingeben, um die Umfragen zu öffnen.");
}

function scheduleParticipantSave(delay = AUTOSAVE_DELAY) {
  const elements = participantElements();
  clearTimeout(saveTimer);

  if (!String(elements.name?.value || "").trim()) {
    updateSurveyAccess("");
    setParticipantState("Bitte Namen eingeben, um die Umfragen zu öffnen.");
  } else {
    setParticipantState("speichert...");
  }

  saveTimer = setTimeout(() => {
    saveParticipant().catch((error) => setParticipantState(error.message, true));
  }, delay);
}

homeApp?.addEventListener("click", (event) => {
  const lockedSurvey = event.target.closest(".survey-entry-link.locked-link");
  if (!lockedSurvey) return;

  event.preventDefault();
  setParticipantState("Bitte zuerst einen Namen eingeben.", true);
  participantElements().name?.focus();
});

homeApp?.addEventListener("input", (event) => {
  if (event.target?.id !== "participant-name") return;
  scheduleParticipantSave();
});

homeApp?.addEventListener("change", (event) => {
  if (event.target?.id !== "participant-publish") return;
  scheduleParticipantSave(0);
});

homeApp?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target?.id !== "participant-name") return;
  event.preventDefault();
  scheduleParticipantSave(0);
  event.target.blur();
});

loadParticipant().catch((error) => {
  setParticipantState(error.message, true);
});
