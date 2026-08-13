const app = document.getElementById("results-app");
const mode = window.RESULTS_MODE || "rankings";
const revealedOils = new Set();
const openOils = new Set();
const openRankings = new Set();
const expandedRankings = new Set();
const commentScrollPositions = new Map();
const PASSWORD_KEY = "oil_tasting_results_password";

const state = {
  password: window.sessionStorage?.getItem(PASSWORD_KEY) || "",
  payload: null,
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value) => (value === null || value === undefined ? "offen" : Number(value).toFixed(2).replace(".", ","));
const currency = (value) => (value === null || value === undefined ? "offen" : `${number(value)} €`);
const signedCurrency = (value) => {
  if (value === null || value === undefined) return "offen";
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(2).replace(".", ",")} €`;
};
const realCurrency = (value) => (value === null || value === undefined ? "Realpreis unbekannt" : `${Number(value).toFixed(0)} €/l`);
const percent = (value) => (value === null || value === undefined ? "offen" : `${Math.round(value * 100)}%`);
const rank = (value) => (value ? `Platz ${value}` : "ohne Rang");
const isMobileView = () => window.matchMedia("(max-width: 860px)").matches;
const pageHeading = () => (mode === "oils" ? "Aufschlüsselung je Öl" : "Ergebnisse");
const pageEyebrow = () => (mode === "oils" ? "detaillierte Ergebnisse" : "Live-Auswertung");

async function loadResults() {
  if (!state.password) {
    renderLogin();
    return;
  }

  const response = await fetch(`/api/results?password=${encodeURIComponent(state.password)}`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) {
    window.sessionStorage?.removeItem(PASSWORD_KEY);
    state.password = "";
    renderLogin(payload.error || "Passwort ist falsch.");
    return;
  }

  state.payload = payload;
  render(payload);
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
        <p class="lead">Passwort eingeben, um die Ergebnisse zu öffnen.</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">Startseite</a>
      </div>
    </section>

    <section class="setup-editor oil-login-panel">
      <label>
        Passwort
        <input id="results-password" type="password" autocomplete="current-password" autofocus>
      </label>
      <div class="setup-actions">
        <p class="notice ${error ? "error" : ""}">${escapeHtml(error || " ")}</p>
        <button class="save-button" type="button" data-action="login-results">Öffnen</button>
      </div>
    </section>
  `;
}

function render(payload) {
  rememberCommentScroll();
  const { config, summary } = payload;
  const updated = summary.updated_at
    ? new Date(summary.updated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "noch keine Daten";
  const otherHref = mode === "oils" ? "/ergebnisse" : "";
  const otherLabel = mode === "oils" ? "Ergebnisse" : "";

  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
        <p class="lead">Aktualisiert: ${escapeHtml(updated)}</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">Startseite</a>
        ${otherHref ? `<a class="ghost-button" href="${escapeHtml(otherHref)}">${escapeHtml(otherLabel)}</a>` : ""}
      </div>
    </section>

    <section class="kpi-grid compact">
      ${metricCard("Probanden", summary.tester_count)}
      ${metricCard("abgegebene Wertungen", summary.response_count, `${summary.expected_responses || 0} möglich`)}
    </section>

    ${mode === "oils" ? renderOilSection(payload) : renderRankingSection(payload)}
  `;
  restoreCommentScroll();
}

function renderRankingSection(payload) {
  return `
    <section class="overview-section">
      <div class="section-heading">
        <h2>Ranglisten</h2>
        <p>Alle Öle, Probanden und Testreihen.</p>
      </div>
      <div class="ranking-grid">
        ${payload.rankings.map((ranking) => renderRankingCard(ranking, `global-${ranking.key}`)).join("")}
      </div>
      <div class="detail-link-panel">
        <a class="ghost-button" href="/einzelne-oel-wertungen">Aufschlüsselung je Öl</a>
      </div>
    </section>
  `;
}

function renderOilSection(payload) {
  const oils = [...payload.oils].sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  return `
    <section class="overview-section">
      <div class="section-heading">
        <h2>Aufschlüsselung nach Öl</h2>
        <p>Dechiffrierung, Kategorien, Ranglisten und Kommentare zum Aromaprofil.</p>
      </div>
      <div class="oil-grid">
        ${oils.map((oil) => renderOilCard(oil, payload.config.surveys, payload.rankings)).join("")}
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
  const mobile = isMobileView();
  const open = !mobile || openRankings.has(id);
  const expanded = expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  const domain = boxDomain(ranking.items);
  return `
    <article class="metric-card ranking-card ${open ? "open" : ""}" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking))}" data-ranking-card="${escapeHtml(id)}">
      <button class="ranking-card-toggle" type="button" data-action="toggle-ranking-card" data-ranking-id="${escapeHtml(id)}">
        <span>
          <h3>${escapeHtml(ranking.title)}</h3>
          ${ranking.subtitle ? `<p class="metric-sub">${escapeHtml(ranking.subtitle)}</p>` : ""}
        </span>
        <span class="ranking-card-icon">${open ? "-" : "+"}</span>
      </button>
      <div class="ranking-card-body">
        ${ranking.items.length ? `<ol>${shown.map((item, index) => renderRankingItem(item, ranking, "", index, ranking.items.length, domain, expanded)).join("")}</ol>` : `<p class="notice">Noch keine Werte.</p>`}
        ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? "Top 3 anzeigen" : "Alle anzeigen"}</button>` : ""}
      </div>
    </article>
  `;
}

function renderRankingItem(item, ranking, currentOilId, index, total, domain, showBoxPlot = false) {
  const value = formatByUnit(item.value, ranking.unit);
  const current = item.oil_id === currentOilId ? " current" : "";
  const rankRatio = total <= 1 ? 0 : index / (total - 1);
  const color = rankingColor(ranking, rankRatio);
  return `
    <li class="${current}" style="--rank-bg:${escapeHtml(color)}">
      <span class="rank-place">${escapeHtml(item.rank || "")}</span>
      <span class="rank-name">${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${showBoxPlot && item.box ? renderBoxPlot(item.box, domain, ranking.unit) : ""}
    </li>
  `;
}

function renderBoxPlot(box, domain, unit) {
  if (!box || !domain) return "";
  const left = position(box.min, domain);
  const q1 = position(box.q1, domain);
  const avgValue = position(box.avg ?? box.median, domain);
  const q3 = position(box.q3, domain);
  const right = position(box.max, domain);
  const title = `n=${box.count}, min ${formatByUnit(box.min, unit)}, Mittelwert ${formatByUnit(box.avg ?? box.median, unit)}, max ${formatByUnit(box.max, unit)}`;
  return `
    <div class="rank-boxplot" title="${escapeHtml(title)}">
      <span class="boxplot-whisker" style="left:${left}%;width:${Math.max(1, right - left)}%"></span>
      <span class="boxplot-box" style="left:${q1}%;width:${Math.max(1, q3 - q1)}%"></span>
      <span class="boxplot-mean" style="left:${avgValue}%"></span>
    </div>
  `;
}

function renderOilCard(oil, surveys, rankings) {
  const open = openOils.has(oil.id);
  return `
    <article class="oil-card ${open ? "open" : ""}" data-oil-id="${escapeHtml(oil.id)}">
      <button class="oil-card-toggle" type="button" data-action="toggle-oil" data-oil-id="${escapeHtml(oil.id)}">
        <h3>${escapeHtml(oil.name)}</h3>
        <span>${open ? "-" : "+"}</span>
      </button>

      <div class="oil-card-body">
        <div class="oil-meta-row">
          <span>${escapeHtml(oil.type || "Öl")}</span>
          <span>${escapeHtml(realCurrency(oil.actual_price_per_liter_eur))}</span>
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
          ${surveys
            .map((survey) =>
              renderCategory(
                oil,
                seriesLabel(survey),
                oil.overall.by_survey[survey.id]?.avg,
                oil.overall.by_survey[survey.id]?.rank,
                findRanking(rankings, `overall_${survey.id}`),
                "number",
                survey.accent,
              ),
            )
            .join("")}
          ${renderCategory(oil, "Gesamt", oil.overall.all.avg, oil.overall.all.rank, findRanking(rankings, "overall_all"), "number", "var(--overall-ranking-color)")}
          ${renderCategory(oil, "Streuung", oil.spread.value, oil.spread.rank, findRanking(rankings, "Streuung"), "number")}
          ${renderCategory(oil, "individuelle Streuung", oil.own_spread.value, oil.own_spread.rank, findRanking(rankings, "own_spread"), "number")}
          ${renderCategory(oil, "Bitterkeit", oil.bitter.avg, oil.bitter.rank, findRanking(rankings, "Bitterkeit"), "number")}
          ${renderCategory(oil, "Geschätzter Preis", oil.price_guess.avg, oil.price_guess.rank, findRanking(rankings, "price_guess"), "currency")}
          ${renderCategory(oil, "Abweichung vom realen Preis", oil.price_deviation.avg, oil.price_deviation.rank, findRanking(rankings, "price_deviation"), "signed_currency")}
          ${renderCategory(oil, "Richtig klassifiziert", oil.guess.accuracy, oil.guess.rank, findRanking(rankings, "Trefferquote"), "percent")}
        </div>

        <div class="comment-panel">
          <h4>Kommentare zum Aromaprofil</h4>
          <div class="comment-scroll" data-scroll-key="${escapeHtml(oil.id)}">
            ${oil.comments.length ? oil.comments.map(renderComment).join("") : `<p class="notice">Noch keine Kommentare.</p>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCategory(oil, label, value, rankValue, ranking, valueType, color = "") {
  const id = `oil-${oil.id}-${ranking?.key || slugify(label)}`;
  const display = valueType === "percent" ? percent(value) : valueType === "currency" ? currency(value) : valueType === "signed_currency" ? signedCurrency(value) : number(value);
  return `
    <details class="category-detail" style="${color ? `--category-color:${escapeHtml(color)}` : ""}">
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
  const domain = boxDomain(ranking.items);
  return `
    ${ranking.items.length ? `<ol class="mini-ranking" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking))};">${shown.map((item, index) => renderRankingItem(item, ranking, currentOilId, index, ranking.items.length, domain, expanded)).join("")}</ol>` : `<p class="notice">Noch keine Werte.</p>`}
    ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? "Top 3 anzeigen" : "Alle anzeigen"}</button>` : ""}
  `;
}

function renderComment(comment) {
  const author = comment.author ? comment.author : "anonym";
  return `
    <article class="comment-item">
      <span>${escapeHtml(comment.series_label || comment.survey_title || "")} - ${escapeHtml(author)}</span>
      <p>${escapeHtml(comment.text)}</p>
    </article>
  `;
}

function findRanking(rankings, titleOrKey) {
  return rankings.find((ranking) => ranking.title === titleOrKey || ranking.key === titleOrKey || ranking.key === slugify(titleOrKey));
}

function seriesLabel(survey) {
  if (survey.id === "geschmack") return "Testreihe 1";
  if (survey.id === "geruch") return "Testreihe 2";
  if (survey.id === "gesamt") return "Testreihe 3";
  return survey.title || survey.id;
}

function formatByUnit(value, unit) {
  if (unit === "%") return percent(value);
  if (unit === "€±") return signedCurrency(value);
  if (unit === "€") return currency(value);
  return number(value);
}

function boxDomain(items) {
  const values = items.flatMap((item) => (item.box ? [item.box.min, item.box.max] : []));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function position(value, domain) {
  return Math.max(0, Math.min(100, ((value - domain.min) / (domain.max - domain.min)) * 100));
}

function rankingColorAccent(ranking) {
  if (ranking.color) return ranking.color;
  return "var(--neutral-ranking-color)";
}

function rankingColor(ranking, rankRatio) {
  if (ranking.key === "price_guess") return priceGradientColor(rankRatio);
  const ratio = ranking.key === "trefferquote" ? 1 - rankRatio : rankRatio;
  return gradientColor(ratio);
}

function gradientColor(ratio) {
  const hue = 122 - ratio * 122;
  return `hsl(${hue} 34% 18%)`;
}

function priceGradientColor(ratio) {
  const hue = 214 - ratio * 12;
  const saturation = 54 + ratio * 14;
  const lightness = 18 + ratio * 16;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function rememberCommentScroll() {
  for (const node of app.querySelectorAll(".comment-scroll[data-scroll-key]")) {
    commentScrollPositions.set(node.dataset.scrollKey, node.scrollTop);
  }
}

function restoreCommentScroll() {
  for (const node of app.querySelectorAll(".comment-scroll[data-scroll-key]")) {
    const top = commentScrollPositions.get(node.dataset.scrollKey);
    if (top !== undefined) node.scrollTop = top;
  }
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
  const login = event.target.closest('[data-action="login-results"]');
  if (login) {
    state.password = document.getElementById("results-password")?.value || "";
    window.sessionStorage?.setItem(PASSWORD_KEY, state.password);
    loadResults().catch((error) => renderLogin(error.message));
    return;
  }

  const rankingCard = event.target.closest('[data-action="toggle-ranking-card"]');
  if (rankingCard) {
    if (!isMobileView()) return;
    const id = rankingCard.dataset.rankingId;
    if (openRankings.has(id)) openRankings.delete(id);
    else openRankings.add(id);
    if (state.payload) render(state.payload);
    return;
  }

  const toggleRanking = event.target.closest('[data-action="toggle-ranking"]');
  if (toggleRanking) {
    const id = toggleRanking.dataset.rankingId;
    if (expandedRankings.has(id)) expandedRankings.delete(id);
    else expandedRankings.add(id);
    if (state.payload) render(state.payload);
    return;
  }

  const oilToggle = event.target.closest('[data-action="toggle-oil"]');
  if (oilToggle) {
    const id = oilToggle.dataset.oilId;
    if (openOils.has(id)) openOils.delete(id);
    else openOils.add(id);
    if (state.payload) render(state.payload);
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

app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.id === "results-password") {
    app.querySelector('[data-action="login-results"]')?.click();
  }
});

let lastMobile = isMobileView();
window.addEventListener("resize", () => {
  const nextMobile = isMobileView();
  if (nextMobile !== lastMobile && state.payload) render(state.payload);
  lastMobile = nextMobile;
});

loadResults().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});

setInterval(() => {
  if (state.password) loadResults().catch(() => undefined);
}, 2000);
