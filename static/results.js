const app = document.getElementById("results-app");
const revealedOils = new Set();
const openOils = new Set();
const expandedRankings = new Set();

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value) => (value === null || value === undefined ? "offen" : Number(value).toFixed(2).replace(".", ","));
const percent = (value) => (value === null || value === undefined ? "offen" : `${Math.round(value * 100)}%`);
const rank = (value) => (value ? `Platz ${value}` : "ohne Rang");

async function loadResults() {
  const response = await fetch("/api/results", { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Ergebnisse konnten nicht geladen werden.");
  render(payload);
}

function render(payload) {
  const { config, summary } = payload;
  const updated = summary.updated_at
    ? new Date(summary.updated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "noch keine Daten";

  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">Live-Auswertung</p>
        <h1>${escapeHtml(config.event.title || "Oliven-Symposium")}</h1>
        <p class="lead">Aktualisiert: ${escapeHtml(updated)}</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">Linktree</a>
      </div>
    </section>

    <section class="kpi-grid">
      ${metricCard("Teilnehmer", summary.tester_count)}
      ${metricCard("Wertungen", summary.response_count, `${summary.expected_responses || 0} möglich`)}
      ${metricCard("Fortschritt", percent(summary.completion_ratio), "über alle Testreihen")}
      ${metricCard("Trefferquote", percent(summary.guess_accuracy), `${summary.guess_correct}/${summary.guess_total} Sorten richtig`)}
    </section>

    <section class="overview-section">
      <div class="section-heading">
        <h2>Generelle Übersicht</h2>
        <p>Alle Öle, Tester und Testreihen.</p>
      </div>
      <div class="ranking-grid">
        ${payload.rankings.map((ranking) => renderRankingCard(ranking, `global-${ranking.key}`)).join("")}
      </div>
    </section>

    <section class="overview-section">
      <div class="section-heading">
        <h2>Aufschlüsselung nach Öl</h2>
        <p>Dechiffrierung, Kategorien, Ranglisten und Aromaprofile.</p>
      </div>
      <div class="oil-grid">
        ${payload.oils.map((oil) => renderOilCard(oil, config.surveys, payload.rankings)).join("")}
      </div>
    </section>
  `;
}

function metricCard(label, value, sub = "") {
  return `
    <article class="metric-card">
      <h2>${escapeHtml(label)}</h2>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${sub ? `<p class="metric-sub">${escapeHtml(sub)}</p>` : ""}
    </article>
  `;
}

function renderRankingCard(ranking, id) {
  const expanded = expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  return `
    <article class="metric-card ranking-card">
      <h3>${escapeHtml(ranking.title)}</h3>
      ${ranking.subtitle ? `<p class="metric-sub">${escapeHtml(ranking.subtitle)}</p>` : ""}
      ${ranking.items.length ? `<ol>${shown.map((item) => renderRankingItem(item, ranking.unit, "")).join("")}</ol>` : `<p class="notice">Noch keine Werte.</p>`}
      ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? "Top 3 anzeigen" : "Alle anzeigen"}</button>` : ""}
    </article>
  `;
}

function renderRankingItem(item, unit, currentOilId) {
  const value = unit === "%" ? percent(item.value) : number(item.value);
  const current = item.oil_id === currentOilId ? " current" : "";
  return `
    <li class="${current}">
      <span class="rank-place">${escapeHtml(item.rank || "")}</span>
      <span class="rank-name">${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(value)}</strong>
    </li>
  `;
}

function renderOilCard(oil, surveys, rankings) {
  const open = openOils.has(oil.id);
  return `
    <article class="oil-card ${open ? "open" : ""}" data-oil-id="${escapeHtml(oil.id)}">
      <button class="oil-card-toggle" type="button" data-action="toggle-oil" data-oil-id="${escapeHtml(oil.id)}">
        <h3>${escapeHtml(oil.name)}</h3>
        <span>${open ? "−" : "+"}</span>
      </button>

      <div class="oil-card-body">
        <div class="oil-meta-row">
          <span>${escapeHtml(oil.type || "Öl")}</span>
          <span>${escapeHtml(oil.response_count)} Wertungen</span>
        </div>

        <div class="cipher-box ${revealedOils.has(oil.id) ? "revealed" : ""}">
          <div class="cipher-values">
            ${surveys
              .map((survey) => `<span><b>${escapeHtml(seriesLabel(survey))}</b>${escapeHtml(oil.ciphers[survey.id] || "-")}</span>`)
              .join("")}
          </div>
          ${revealedOils.has(oil.id) ? "" : `<button class="cipher-shield" type="button" data-action="reveal">Dechiffrierung aufdecken</button>`}
        </div>

        <div class="oil-stats">
          ${renderCategory(oil, "Gesamt", oil.overall.all.avg, oil.overall.all.rank, findRanking(rankings, "Gesamteindruck gesamt"), "number")}
          ${surveys.map((survey) => renderCategory(oil, seriesLabel(survey), oil.overall.by_survey[survey.id]?.avg, oil.overall.by_survey[survey.id]?.rank, findRanking(rankings, `Gesamteindruck: ${survey.short_title || survey.title}`), "number")).join("")}
          ${renderCategory(oil, "Streuung", oil.spread.value, oil.spread.rank, findRanking(rankings, "Streuung"), "number")}
          ${renderCategory(oil, "eigene Streuung", oil.own_spread.value, oil.own_spread.rank, findRanking(rankings, "eigene Streuung"), "number")}
          ${renderCategory(oil, "Bitterkeit", oil.bitter.avg, oil.bitter.rank, findRanking(rankings, "Bitterkeit"), "number")}
          ${renderCategory(oil, "Richtig klassifiziert", oil.guess.accuracy, oil.guess.rank, findRanking(rankings, "Trefferquote"), "percent")}
        </div>

        <div class="comment-panel">
          <h4>Aromaprofile</h4>
          <div class="comment-scroll">
            ${oil.comments.length ? oil.comments.map(renderComment).join("") : `<p class="notice">Noch keine Kommentare.</p>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCategory(oil, label, value, rankValue, ranking, valueType) {
  const id = `oil-${oil.id}-${slugify(label)}`;
  const display = valueType === "percent" ? percent(value) : number(value);
  return `
    <details class="category-detail">
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(display)}</strong>
        <em>${escapeHtml(rank(rankValue))}</em>
      </summary>
      ${ranking ? renderMiniRanking(ranking, id, oil.id) : `<p class="notice">Noch keine Rangliste.</p>`}
    </details>
  `;
}

function renderMiniRanking(ranking, id, currentOilId) {
  const expanded = expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  return `
    ${ranking.items.length ? `<ol class="mini-ranking">${shown.map((item) => renderRankingItem(item, ranking.unit, currentOilId)).join("")}</ol>` : `<p class="notice">Noch keine Werte.</p>`}
    ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? "Top 3 anzeigen" : "Alle anzeigen"}</button>` : ""}
  `;
}

function renderComment(comment) {
  return `
    <article class="comment-item">
      <span>${escapeHtml(comment.series_label || comment.survey_title || "")}</span>
      <p>${escapeHtml(comment.text)}</p>
    </article>
  `;
}

function findRanking(rankings, title) {
  return rankings.find((ranking) => ranking.title === title || ranking.key === slugify(title));
}

function seriesLabel(survey) {
  if (survey.id === "geschmack") return "Testreihe 1";
  if (survey.id === "geruch") return "Testreihe 2";
  if (survey.id === "gesamt") return "Testreihe 3";
  return survey.title || survey.id;
}

function slugify(value) {
  return String(value)
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function handleClick(event) {
  const toggleRanking = event.target.closest('[data-action="toggle-ranking"]');
  if (toggleRanking) {
    const id = toggleRanking.dataset.rankingId;
    if (expandedRankings.has(id)) expandedRankings.delete(id);
    else expandedRankings.add(id);
    loadResults().catch(() => undefined);
    return;
  }

  const oilToggle = event.target.closest('[data-action="toggle-oil"]');
  if (oilToggle) {
    const id = oilToggle.dataset.oilId;
    if (openOils.has(id)) openOils.delete(id);
    else openOils.add(id);
    loadResults().catch(() => undefined);
    return;
  }

  const reveal = event.target.closest('[data-action="reveal"]');
  if (reveal) {
    const card = reveal.closest(".oil-card");
    if (card?.dataset.oilId) revealedOils.add(card.dataset.oilId);
    const box = reveal.closest(".cipher-box");
    box?.classList.add("revealed");
    reveal.remove();
  }
}

app.addEventListener("click", handleClick);

loadResults().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});

setInterval(() => {
  loadResults().catch(() => undefined);
}, 2000);
