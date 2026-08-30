const app = document.getElementById("results-app");
const mode = window.RESULTS_MODE || "rankings";
const pageRoutes = {
  rankings: "/ergebnisse",
  oils: "/einzelne-oel-wertungen",
  competitive: "/kompetitive-verkostung",
};
const pageRoute = pageRoutes[mode] || "/ergebnisse";
const revealedOils = new Set();
const openOils = new Set();
const openRankings = new Set();
const expandedRankings = new Set();
const commentScrollPositions = new Map();
const loginScope = mode === "competitive" ? "competitive" : "results";
const loginContexts = {
  results: {
    apiAccess: "results",
    formAction: "/ergebnisse/login",
    formName: "results-login",
    passwordId: "results-password",
    passwordName: "results-password",
    passwordKey: "oil_tasting_results_password",
    usernameId: "results-login-realm",
    usernameName: "results-login-realm",
    usernameValue: "ergebnisse",
    autocomplete: "section-results current-password",
  },
  competitive: {
    apiAccess: "competitive",
    formAction: "/kompetitive-verkostung/login",
    formName: "competitive-results-login",
    passwordId: "competitive-results-password",
    passwordName: "competitive-results-password",
    passwordKey: "oil_tasting_competitive_results_password",
    usernameId: "competitive-results-login-realm",
    usernameName: "competitive-results-login-realm",
    usernameValue: "kompetitive-verkostung",
    autocomplete: "section-competitive-results current-password",
  },
};
const loginContext = loginContexts[loginScope];
const PASSWORD_KEY = loginContext.passwordKey;

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

const pointColors = [
  "#4f83cc",
  "#c86b7a",
  "#66a36f",
  "#c3943f",
  "#8b75c9",
  "#42a7a5",
  "#d47f49",
  "#d06ca8",
  "#7c9a42",
  "#6f8fd8",
  "#bf6f3a",
  "#53a0cf",
  "#a77244",
  "#45a878",
  "#9b78c8",
  "#bf755f",
  "#6aa0a7",
  "#b98f39",
  "#7886c7",
  "#c3698e",
  "#5f9d55",
  "#a87dbd",
  "#4f9a8b",
  "#cf7a3d",
];

const state = {
  password: window.sessionStorage?.getItem(PASSWORD_KEY) || "",
  payload: null,
  allRankingsExpanded: false,
  competitiveOilIndex: 0,
  tasteRotationX: -22,
  tasteRotationY: -35,
  rotatingTasteSpace: false,
  selectingCompetitiveOil: false,
  rotationStartX: 0,
  rotationStartY: 0,
  rotationStartPitch: 0,
  rotationStartYaw: 0,
  tasteSpaceAnimationFrame: 0,
};

function text(path, fallback = "") {
  let node = window.UI_TEXTS || {};
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === "string" ? node : fallback;
}

function dict(path) {
  let node = window.UI_TEXTS || {};
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return {};
    node = node[key];
  }
  return node && typeof node === "object" && !Array.isArray(node) ? node : {};
}

function globalText(key, fallback = "") {
  return text(["global", key], fallback);
}

function routeText(key, fallback = "") {
  return text([pageRoute, key], fallback);
}

function resultsText(key, fallback = "") {
  return text(["/ergebnisse", key], fallback);
}

function oilText(key, fallback = "") {
  return text(["/einzelne-oel-wertungen", key], fallback);
}

function categoryText(key, fallback = "") {
  return text(["/einzelne-oel-wertungen", "categories", key], fallback);
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : Number(value).toFixed(2).replace(".", ","));
const currency = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : `${number(value)} €`);
const signedCurrency = (value) => {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(2).replace(".", ",")} €`;
};
const signedWholeCurrency = (value) => {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const rounded = Math.round(Math.abs(numeric));
  const sign = rounded === 0 ? "" : numeric >= 0 ? "+" : "-";
  return `${sign}${rounded} €`;
};
const realCurrency = (value) => (value === null || value === undefined ? oilText("real_price_unknown", "Realpreis unbekannt") : `${Number(value).toFixed(0)} €/l`);
const percent = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : `${Math.round(value * 100)}%`);
const signedNumber = (value) => {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(2).replace(".", ",")}`;
};
function formatPersonalAnswer(answer) {
  const value = answer?.value;
  if (value === null || value === undefined || value === "") return globalText("open_value", "offen");
  if (typeof value === "number") return Number(value).toFixed(2).replace(/,00$|\.00$/, "").replace(".", ",");
  return String(value);
}
const rank = (value) => (value ? `${resultsText("rank_prefix", "Platz")} ${value}` : resultsText("rank_missing", "ohne Rang"));
const isMobileView = () => window.matchMedia("(max-width: 860px)").matches;
const pageHeading = () => routeText("heading", mode === "oils" ? "Aufschlüsselung je Öl" : mode === "competitive" ? "Symposium-Minispiel" : "Ergebnisse");
const pageEyebrow = () => routeText("eyebrow", mode === "oils" ? "detaillierte Ergebnisse" : mode === "competitive" ? "Auswertung nach Probanden" : "Live-Auswertung");

async function loadResults() {
  const apiAccess = loginContext.apiAccess;
  const response = await fetch(`/api/results?access=${encodeURIComponent(apiAccess)}&password=${encodeURIComponent(state.password)}`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) {
    if (state.password) window.sessionStorage?.removeItem(PASSWORD_KEY);
    state.password = "";
    renderLogin(payload.error || "Passwort ist falsch.");
    return;
  }

  state.payload = payload;
  if (mode === "competitive" && (state.selectingCompetitiveOil || state.rotatingTasteSpace)) {
    updateTasteSpace();
    return;
  }
  render(payload);
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
        <p class="lead">${escapeHtml(routeText("login_lead", "Passwort eingeben, um die Ergebnisse zu öffnen."))}</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
      </div>
    </section>

    <form class="setup-editor oil-login-panel" action="${escapeHtml(loginContext.formAction)}" method="post" data-login-form="${escapeHtml(loginContext.formName)}">
      <label class="visually-hidden" for="${escapeHtml(loginContext.usernameId)}">
        Anmeldebereich
        <input
          id="${escapeHtml(loginContext.usernameId)}"
          name="${escapeHtml(loginContext.usernameName)}"
          type="text"
          value="${escapeHtml(loginContext.usernameValue)}"
          autocomplete="username"
          tabindex="-1"
        >
      </label>
      <label for="${escapeHtml(loginContext.passwordId)}">
        ${escapeHtml(globalText("password_label", "Passwort"))}
        <input
          id="${escapeHtml(loginContext.passwordId)}"
          name="${escapeHtml(loginContext.passwordName)}"
          type="password"
          autocomplete="${escapeHtml(loginContext.autocomplete)}"
          autofocus
        >
      </label>
      <div class="setup-actions">
        <p class="notice ${error ? "error" : ""}">${escapeHtml(error || " ")}</p>
        <button class="save-button" type="button" data-action="login-results">${escapeHtml(globalText("login_button", "Öffnen"))}</button>
      </div>
    </form>
  `;
}

function render(payload) {
  rememberCommentScroll();
  const { summary } = payload;

  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
      </div>
    </section>

    ${renderResultsCommands(summary)}

    ${mode === "oils" ? renderOilSection(payload) : mode === "competitive" ? renderCompetitiveSection(payload) : renderRankingSection(payload)}
  `;
  restoreCommentScroll();
  syncRankingCardHeights();
  const masterList = app.querySelector(".oil-master-list");
  if (masterList) app.style.setProperty("--oil-list-height", `${Math.max(190, masterList.scrollHeight)}px`);
}

function renderResultsCommands(summary) {
  if (!["rankings", "oils", "competitive"].includes(mode)) return "";
  const homeLink = `<a class="ghost-button command-home" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>`;
  let areaLinks = "";
  let thirdLabel = resultsText("response_count", "abgegebene Einzelwertungen");
  let thirdValue = summary.response_count;
  if (mode === "rankings") {
    areaLinks = `
      <a class="ghost-button command-detail" href="/einzelne-oel-wertungen">${escapeHtml(resultsText("detail_link", "Aufschlüsselung nach Produkt"))}</a>
      <a class="ghost-button command-competitive" href="/kompetitive-verkostung">${escapeHtml(resultsText("competitive_link", "Symposium-Minispiel"))}</a>`;
  } else if (mode === "oils") {
    thirdLabel = oilText("comment_count", "Anzahl Kommentare");
    thirdValue = summary.comment_count;
    areaLinks = `
      <a class="ghost-button command-overview" href="/ergebnisse">${escapeHtml(oilText("overview_link", "zurück zur Ergebnis-Startseite"))}</a>
      <a class="ghost-button command-competitive" href="/kompetitive-verkostung">${escapeHtml(resultsText("competitive_link", "Symposium-Minispiel"))}</a>`;
  } else {
    thirdLabel = routeText("competitor_count", "Mitspieler");
    thirdValue = summary.competitor_count;
    areaLinks = `
      <a class="ghost-button command-overview" href="/ergebnisse">${escapeHtml(resultsText("overview_link", "zurück zur Ergebnis-Startseite"))}</a>
      <a class="ghost-button command-detail" href="/einzelne-oel-wertungen">${escapeHtml(resultsText("detail_link", "Aufschlüsselung nach Produkt"))}</a>`;
  }
  return `
    <section class="results-command-grid">
      <nav class="results-command-links ${escapeHtml(mode)}-links" aria-label="Ergebnisbereiche">
        ${homeLink}
        ${areaLinks}
      </nav>
      <div class="results-kpi-grid">
        ${metricCard(resultsText("tester_count", "Probanden"), summary.tester_count)}
        ${metricCard(resultsText("oil_count", "Anzahl Öle"), summary.oil_count)}
        ${metricCard(thirdLabel, thirdValue)}
      </div>
    </section>
  `;
}

function syncRankingCardHeights() {
  app.style.removeProperty("--ranking-header-height");
  if (isMobileView()) return;
  const headers = [...app.querySelectorAll(".ranking-card-toggle")];
  if (!headers.length) return;
  const height = Math.max(...headers.map((header) => Math.ceil(header.scrollHeight)));
  app.style.setProperty("--ranking-header-height", `${height}px`);
}

function renderRankingSection(payload) {
  const forceExpanded = state.allRankingsExpanded && !isMobileView();
  return `
    <section class="overview-section">
      ${renderOverallChart(payload)}
      ${renderPriceScatterChart(payload)}
      <div class="section-heading ranking-section-heading">
        <div>
          <h2>${escapeHtml(resultsText("ranking_heading", "Ranglisten"))}</h2>
          <p>${escapeHtml(resultsText("ranking_subtitle", "Alle Öle, Probanden und Testreihen."))}</p>
        </div>
        <button class="ghost-button desktop-only" type="button" data-action="toggle-all-rankings">${escapeHtml(forceExpanded ? resultsText("collapse_all", "Top 3 anzeigen") : resultsText("expand_all", "alle aufklappen"))}</button>
      </div>
      <div class="ranking-grid">
        ${payload.rankings.map((ranking) => renderRankingCard(ranking, `global-${ranking.key}`)).join("")}
      </div>
      <div class="detail-link-panel">
        <a class="ghost-button" href="/einzelne-oel-wertungen">${escapeHtml(resultsText("detail_link", "Aufschlüsselung je Öl"))}</a>
        <a class="ghost-button" href="/kompetitive-verkostung">${escapeHtml(resultsText("competitive_link", "Symposium-Minispiel"))}</a>
      </div>
    </section>
  `;
}

function renderOverallChart(payload) {
  const surveys = payload.config.surveys || [];
  const oils = overallChartOils(payload);
  const hasValues = oils.some((oil) => surveys.some((survey) => oil.overall.by_survey[survey.id]?.avg !== null && oil.overall.by_survey[survey.id]?.avg !== undefined));
  if (!hasValues) {
    return `
      <article class="metric-card overall-chart-card empty-chart">
        <h2>${escapeHtml(resultsText("chart_title", "Gesamteindruck je Öl"))}</h2>
        <p class="notice">${escapeHtml(resultsText("chart_empty", "Noch keine Gesamteindruck-Werte."))}</p>
      </article>
    `;
  }

  return `
    <article class="metric-card overall-chart-card">
      <div class="overall-chart-heading">
        <div>
          <h2>${escapeHtml(resultsText("chart_title", "Gesamteindruck je Öl"))}</h2>
          <p class="metric-sub">${escapeHtml(resultsText("chart_subtitle", "Gruppierte Wertungen aus Geschmack, Geruch und Erfahrung."))}</p>
        </div>
        <div class="overall-chart-legend">
          ${surveys.map((survey) => `<span><i style="--legend-color:${escapeHtml(survey.accent || "#d49b2b")}"></i>${escapeHtml(seriesLabel(survey))}</span>`).join("")}
          <span><i class="mean-key"></i>${escapeHtml(resultsText("chart_mean_label", "Mittelwert"))}</span>
        </div>
      </div>
      <div class="overall-chart-scroll">
        <div class="overall-chart-frame" style="--oil-count:${escapeHtml(Math.max(1, oils.length))}">
          <div class="overall-y-labels">
            ${oils.map((oil) => `<span title="${escapeHtml(oil.name)}">${escapeHtml(oil.name)}</span>`).join("")}
          </div>
          <div class="overall-chart-plot">
            ${renderChartGridLines()}
            <div class="overall-chart-groups">
              ${oils.map((oil) => renderOverallGroup(oil, surveys)).join("")}
            </div>
          </div>
          <div></div>
          <div class="overall-x-axis">${renderChartXAxis()}</div>
        </div>
      </div>
    </article>
  `;
}

function overallChartOils(payload) {
  const byId = new Map((payload.oils || []).map((oil) => [oil.id, oil]));
  const ranked = findRanking(payload.rankings || [], "overall_all")?.items || [];
  const ordered = ranked.map((item) => byId.get(item.oil_id)).filter(Boolean);
  const used = new Set(ordered.map((oil) => oil.id));
  const rest = (payload.oils || [])
    .filter((oil) => !used.has(oil.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  return [...ordered, ...rest];
}

function chartTicks() {
  return [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
}

function renderChartXAxis() {
  return chartTicks()
    .map((value) => `<span style="left:${escapeHtml(chartX(value))}%">${escapeHtml(value)}</span>`)
    .join("");
}

function renderChartGridLines() {
  return chartTicks()
    .map((value) => `<span class="overall-grid-line ${value === 0 ? "zero" : ""}" style="left:${escapeHtml(chartX(value))}%"></span>`)
    .join("");
}

function renderOverallGroup(oil, surveys) {
  const mean = oil.overall.all.avg;
  return `
    <div class="overall-chart-group" title="${escapeHtml(oil.name)}">
      <div class="overall-bars">
        ${surveys.map((survey) => renderOverallBar(oil.overall.by_survey[survey.id]?.avg, survey.accent)).join("")}
        ${renderMeanLine(mean)}
      </div>
    </div>
  `;
}

function renderOverallBar(value, color) {
  if (value === null || value === undefined) return `<span class="overall-bar-slot empty"></span>`;
  const numeric = Number(value);
  const position = chartX(numeric);
  const left = Math.min(position, 50);
  const width = Math.abs(position - 50);
  const direction = numeric >= 0 ? "positive" : "negative";
  return `
    <span class="overall-bar-slot">
      <span class="overall-bar ${direction}" style="--bar-color:${escapeHtml(color || "#d49b2b")};--bar-left:${escapeHtml(left.toFixed(3))}%;--bar-width:${escapeHtml(Math.max(0.8, width).toFixed(3))}%"></span>
    </span>
  `;
}

function renderMeanLine(value) {
  if (value === null || value === undefined) return "";
  const left = chartX(Number(value));
  return `<span class="overall-mean-line" style="--mean-left:${escapeHtml(left.toFixed(3))}%"></span>`;
}

function chartX(value) {
  return Math.max(0, Math.min(100, ((value + 5) / 10) * 100));
}

function renderPriceScatterChart(payload) {
  const chart = payload.price_scatter || {};
  const points = chart.points || [];
  if (!points.length) {
    return "";
  }
  const max = Math.max(Number(chart.domain?.max) || 0, 1);
  const ticks = priceChartTicks(max);
  return `
    <article class="metric-card price-scatter-card">
      <div class="price-scatter-heading">
        <div>
          <h2>${escapeHtml(resultsText("price_scatter_title", "Geschätzter vs. realer Preis"))}</h2>
          <p class="metric-sub">${escapeHtml(resultsText("price_scatter_subtitle", "Punkte über der Linie wurden höher geschätzt als der reale Preis."))}</p>
        </div>
        <div class="price-scatter-legend">
          <span><i class="reference"></i>${escapeHtml(resultsText("price_scatter_reference_label", "100%-Linie"))}</span>
        </div>
      </div>
      <div class="price-scatter-frame">
        <div class="price-scatter-y-title">${escapeHtml(resultsText("price_scatter_y_axis", "Schätzung"))}</div>
        <div class="price-scatter-y-axis">
          ${ticks.map((value) => `<span style="top:${escapeHtml(priceChartY(value, max))}%">${escapeHtml(formatPriceTick(value))}</span>`).join("")}
        </div>
        <div class="price-scatter-plot">
          <svg class="price-scatter-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${ticks
              .map((value) => {
                const x = priceChartX(value, max);
                const y = priceChartY(value, max);
                return `<line class="price-scatter-grid vertical" x1="${escapeHtml(x)}" y1="0" x2="${escapeHtml(x)}" y2="100"></line><line class="price-scatter-grid horizontal" x1="0" y1="${escapeHtml(y)}" x2="100" y2="${escapeHtml(y)}"></line>`;
              })
              .join("")}
            <line class="price-scatter-reference" x1="0" y1="100" x2="100" y2="0"></line>
          </svg>
          <div class="price-scatter-points">
            ${points.map((point, index) => renderPriceScatterPoint(point, max, index)).join("")}
          </div>
        </div>
        <div></div>
        <div></div>
        <div class="price-scatter-x-axis">
          ${ticks.map((value) => `<span style="left:${escapeHtml(priceChartX(value, max))}%">${escapeHtml(formatPriceTick(value))}</span>`).join("")}
        </div>
        <div class="price-scatter-x-title">${escapeHtml(resultsText("price_scatter_x_axis", "Realpreis"))}</div>
      </div>
    </article>
  `;
}

function renderPriceScatterPoint(point, max, index) {
  const actual = Number(point.actual_price_per_liter_eur);
  const guess = Number(point.price_guess_avg);
  const percentValue = Number(point.price_deviation_percent);
  const left = priceChartX(actual, max);
  const top = priceChartY(guess, max);
  const labelSide = left > 62 ? " label-left" : "";
  const title = `${point.name}: Realpreis ${currency(actual)}, Schätzung ${currency(guess)}, ${signedPercentPoints(percentValue)}`;
  return `
    <span
      class="price-scatter-point ${percentValue >= 0 ? "over" : "under"}${labelSide}"
      style="--point-x:${escapeHtml(left)}%;--point-y:${escapeHtml(top)}%;--point-color:${escapeHtml(pointColor(index))}"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
    >
      <span class="price-scatter-dot" aria-hidden="true"></span>
      <span class="price-scatter-label">${escapeHtml(shortOilLabel(point.name))}</span>
    </span>
  `;
}

function pointColor(index) {
  return pointColors[index % pointColors.length];
}

function shortOilLabel(name) {
  const textValue = String(name || "").replace(/\s+/g, " ").trim();
  if (textValue.length <= 24) return textValue;
  return `${textValue.slice(0, 22).trim()}...`;
}

function priceChartTicks(max) {
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const ticks = [];
  for (let value = 0; value < max; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function priceChartX(value, max) {
  return Math.max(0, Math.min(100, (Number(value) / max) * 100));
}

function priceChartY(value, max) {
  return Math.max(0, Math.min(100, 100 - (Number(value) / max) * 100));
}

function formatPriceTick(value) {
  return `${Math.round(Number(value))} €`;
}

function renderOilSection(payload) {
  const oils = [...payload.oils].sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  if (!isMobileView() && oils.length) {
    const selectedId = [...openOils].find((id) => oils.some((oil) => oil.id === id));
    const selectedOil = selectedId ? oils.find((oil) => oil.id === selectedId) : null;
    return `
      <section class="overview-section oil-split-view">
        <div class="oil-master-list">
          ${oils.map((oil) => renderOilCard(oil, payload.config.surveys, payload.rankings, { summaryOnly: true })).join("")}
        </div>
        <div class="oil-detail-pane">
          ${selectedOil ? renderOilCard(selectedOil, payload.config.surveys, payload.rankings, { forceOpen: true }) : renderOilPlaceholder()}
        </div>
      </section>
    `;
  }
  return `
    <section class="overview-section">
      <div class="oil-grid">
        ${oils.map((oil) => renderOilCard(oil, payload.config.surveys, payload.rankings)).join("")}
      </div>
    </section>
  `;
}

function renderOilPlaceholder() {
  return `<div class="oil-detail-placeholder"><div class="oil-still-life" aria-hidden="true"><span class="bottle"></span><span class="bread"></span><i class="olive one"></i><i class="olive two"></i><i class="olive three"></i></div><p>${escapeHtml(oilText("select_product_notice", "wähle links ein Produkt aus"))}</p></div>`;
}

function renderCompetitiveSection(payload) {
  const competitive = payload.competitive || {};
  const forceExpanded = state.allRankingsExpanded && !isMobileView();
  return `
    <section class="overview-section competitive-section">
      ${renderTasteSpace(competitive)}
      ${renderCrownChart(competitive)}
      <div class="section-heading ranking-section-heading">
        <div>
          <h2>${escapeHtml(routeText("ranking_heading", "Ranglisten"))}</h2>
          <p>${escapeHtml(routeText("ranking_subtitle", "Direkte Auswertung der Probanden."))}</p>
        </div>
        <button class="ghost-button desktop-only" type="button" data-action="toggle-all-rankings">${escapeHtml(forceExpanded ? resultsText("collapse_all", "Top 3 anzeigen") : resultsText("expand_all", "alle aufklappen"))}</button>
      </div>
      <div class="ranking-grid compact">
        ${(competitive.rankings || []).map((ranking) => renderRankingCard(ranking, `competitive-${ranking.key}`)).join("")}
      </div>
    </section>
  `;
}

function renderCrownChart(competitive) {
  const standings = competitive.crown_standings || [];
  if (!standings.length) return "";
  return `
    <article class="metric-card crown-chart-card">
      <h2>${escapeHtml(competitive.crown_title || routeText("crown_chart_title", "ölympisches Treppchen"))}</h2>
      <p class="metric-sub">${escapeHtml(competitive.crown_subtitle || routeText("crown_chart_subtitle", "Gold 3 Punkte, Silber 2 Punkte, Bronze 1 Punkt."))}</p>
      ${renderCrownLegend()}
      <div class="crown-chart-scroll">
        <div class="crown-chart-content" style="--crown-columns:${escapeHtml(standings.length)}">
          <div class="crown-chart-plot">
            <div class="crown-chart">
              ${standings.map((entry) => `<div class="crown-chart-person"><div class="crown-chart-stack">${renderCrownStack(entry.crowns)}</div></div>`).join("")}
            </div>
          </div>
          <div class="crown-chart-names">
            ${standings.map((entry) => `<strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong>`).join("")}
          </div>
        </div>
      </div>
    </article>`;
}

function renderCrownLegend() {
  return `<div class="crown-chart-legend">
    <span>${renderCrownIcons({ gold: 1 }, true)}<b>: 3 Punkte</b></span>
    <span>${renderCrownIcons({ silver: 1 }, true)}<b>: 2 Punkte</b></span>
    <span>${renderCrownIcons({ bronze: 1 }, true)}<b>: 1 Punkt</b></span>
    <span>${renderCrownIcons({ blue: 1 }, true)}<b>: ${escapeHtml(routeText("participation_crown_label", "Mitmach-Krone"))}</b></span>
  </div>`;
}

function renderCrownStack(awards = {}) {
  const total = Number(awards.gold || 0) + Number(awards.silver || 0) + Number(awards.bronze || 0);
  return total ? renderCrownIcons(awards) : renderCrownIcons({ blue: 1 });
}

function renderTasteSpace(competitive) {
  const oils = competitive.coordinate_oils || [];
  const populated = oils.filter((oil) => (oil.points || []).length);
  if (!populated.length) {
    return `
      <article class="metric-card taste-space-card empty-chart">
        <h2>${escapeHtml(routeText("space_title", "3D-Gesamteindruck je Öl"))}</h2>
        <p class="metric-sub">${escapeHtml(routeText("space_subtitle", "Aus den drei Wertungen je Öl und Proband entstehen folgende Punkte in einem dreidimensionalen Koordinatensystem!"))}</p>
        <p class="notice">${escapeHtml(routeText("space_empty", "Noch keine vollständigen Wertungen für das Koordinatensystem."))}</p>
      </article>
    `;
  }

  state.competitiveOilIndex = Math.max(0, Math.min(state.competitiveOilIndex, populated.length - 1));
  const oil = populated[state.competitiveOilIndex];
  const oilLabel = tasteSpaceOilLabel(oil);
  const sliderMax = Math.max(0, populated.length - 1);
  const sliderPos = sliderMax ? (state.competitiveOilIndex / sliderMax) * 100 : 0;
  return `
    <article class="metric-card taste-space-card">
      <div class="taste-space-heading">
        <div>
          <h2>${escapeHtml(routeText("space_title", "3D-Gesamteindruck je Öl"))}</h2>
          <p class="metric-sub">${escapeHtml(routeText("space_subtitle", "Aus den drei Wertungen je Öl und Proband entstehen folgende Punkte in einem dreidimensionalen Koordinatensystem!"))}</p>
          <p class="metric-sub taste-space-oil-label">${escapeHtml(oilLabel)}</p>
        </div>
        <div class="taste-space-slider range-widget">
          <div class="range-control simple-range-control" style="--range-pos:${escapeHtml(sliderPos.toFixed(2))}%">
            ${renderSimpleTicks(0, sliderMax, 1)}
            <input type="range" min="0" max="${escapeHtml(sliderMax)}" step="1" value="${escapeHtml(state.competitiveOilIndex)}" data-action="select-competitive-oil">
          </div>
        </div>
      </div>
      <div class="taste-space-plot" data-action="rotate-taste-space">
        ${renderTasteSpaceSvg(oil.points || [])}
      </div>
    </article>
  `;
}

function competitivePopulatedOils() {
  return (state.payload?.competitive?.coordinate_oils || []).filter((oil) => (oil.points || []).length);
}

function selectedCompetitiveOil() {
  const populated = competitivePopulatedOils();
  if (!populated.length) return null;
  state.competitiveOilIndex = Math.max(0, Math.min(state.competitiveOilIndex, populated.length - 1));
  return populated[state.competitiveOilIndex];
}

function tasteSpaceOilLabel(oil) {
  if (!oil?.brought_by_name) return oil?.name || "";
  return `${oil.name} · ${oilText("owner_label", "Mitgebracht von")} ${oil.brought_by_name}`;
}

function scheduleTasteSpaceUpdate() {
  if (state.tasteSpaceAnimationFrame) return;
  state.tasteSpaceAnimationFrame = window.requestAnimationFrame(() => {
    state.tasteSpaceAnimationFrame = 0;
    updateTasteSpace();
  });
}

function updateTasteSpace() {
  const oil = selectedCompetitiveOil();
  if (!oil) return;

  const card = app.querySelector(".taste-space-card");
  const plot = card?.querySelector(".taste-space-plot");
  const title = card?.querySelector(".taste-space-oil-label");
  if (title) title.textContent = tasteSpaceOilLabel(oil);
  if (plot) plot.innerHTML = renderTasteSpaceSvg(oil.points || []);

  const slider = card?.querySelector('[data-action="select-competitive-oil"]');
  const populated = competitivePopulatedOils();
  const sliderMax = Math.max(0, populated.length - 1);
  const sliderPos = sliderMax ? (state.competitiveOilIndex / sliderMax) * 100 : 0;
  slider?.setAttribute("max", String(sliderMax));
  if (slider) slider.value = String(state.competitiveOilIndex);
  slider?.closest(".range-control")?.style.setProperty("--range-pos", `${sliderPos.toFixed(2)}%`);
}

function renderTasteSpaceSvg(points) {
  const axisX = routeText("space_x_axis", "Geschmack");
  const axisY = routeText("space_y_axis", "volle Erfahrung");
  const axisZ = routeText("space_z_axis", "Geruch");
  const renderedPoints = points
    .map((point, index) => ({
      point,
      index,
      projected: project3d(Number(point.x), Number(point.y), Number(point.z)),
    }))
    .sort((a, b) => a.projected.depth - b.projected.depth);
  return `
    <svg viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(routeText("space_title", "3D-Gesamteindruck je Öl"))}">
      <defs>
        <marker id="taste-axis-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      ${render3dAxis("x", axisX)}
      ${render3dAxis("y", axisY)}
      ${render3dAxis("z", axisZ)}
      ${render3dLine([-5, -5, -5], [5, 5, 5], "taste-diagonal")}
      ${renderedPoints.map(({ point, index, projected }) => render3dPoint(point, index, projected)).join("")}
    </svg>
  `;
}

function renderSimpleTicks(min, max, step) {
  if (max <= min) return "";
  const values = [];
  for (let value = min; value <= max; value += step) {
    values.push(value);
  }
  if (values[values.length - 1] !== max) values.push(max);
  return `<div class="tick-row" aria-hidden="true">${values
    .map((value) => `<span style="left:${escapeHtml(((value - min) / (max - min)) * 100)}%"></span>`)
    .join("")}</div>`;
}

function project3d(x, y, z) {
  const yaw = (Number(state.tasteRotationY) * Math.PI) / 180;
  const pitch = (Number(state.tasteRotationX) * Math.PI) / 180;
  const yawX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const yawZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const pitchedY = y * Math.cos(pitch) - yawZ * Math.sin(pitch);
  const pitchedZ = y * Math.sin(pitch) + yawZ * Math.cos(pitch);
  return {
    x: 50 + yawX * 6.2,
    y: 54 - pitchedY * 5.4,
    depth: pitchedZ,
  };
}

function render3dLine(start, end, className, arrow = false) {
  const a = project3d(start[0], start[1], start[2]);
  const b = project3d(end[0], end[1], end[2]);
  return `<line class="${escapeHtml(className)}" x1="${escapeHtml(a.x.toFixed(2))}" y1="${escapeHtml(a.y.toFixed(2))}" x2="${escapeHtml(b.x.toFixed(2))}" y2="${escapeHtml(b.y.toFixed(2))}" ${arrow ? 'marker-end="url(#taste-axis-arrow)"' : ""}></line>`;
}

function render3dAxis(axis, label) {
  const vector = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  const negative = vector.map((value) => value * -5);
  const positive = vector.map((value) => value * 5);
  const labelPosition = vector.map((value) => value * 5.8);
  return `
    ${render3dLine(negative, positive, `taste-axis axis-${axis}`, true)}
    ${[-5, 0, 5].map((value) => render3dTick(axis, value)).join("")}
    ${render3dLabel(labelPosition, label)}
  `;
}

function render3dTick(axis, value) {
  const point = axis === "x" ? [value, 0, 0] : axis === "y" ? [0, value, 0] : [0, 0, value];
  return render3dLabel(point, String(value), "middle", "taste-tick-label");
}

function render3dLabel(position, label, anchor = "middle", className = "taste-axis-label") {
  const point = project3d(position[0], position[1], position[2]);
  return `<text class="${escapeHtml(className)}" x="${escapeHtml(point.x.toFixed(2))}" y="${escapeHtml(point.y.toFixed(2))}" text-anchor="${escapeHtml(anchor)}">${escapeHtml(label)}</text>`;
}

function render3dPoint(point, index, projected = project3d(Number(point.x), Number(point.y), Number(point.z))) {
  const labelLeft = projected.x > 70;
  const title = `${point.name}: ${routeText("space_x_axis", "Geschmack")} ${number(point.x)}, ${routeText("space_y_axis", "volle Erfahrung")} ${number(point.y)}, ${routeText("space_z_axis", "Geruch")} ${number(point.z)}`;
  const radius = 1.45 + ((projected.depth + 8.66) / 17.32) * 0.45;
  return `
    <g class="taste-point ${labelLeft ? "label-left" : ""}" transform="translate(${escapeHtml(projected.x.toFixed(2))} ${escapeHtml(projected.y.toFixed(2))})">
      <title>${escapeHtml(title)}</title>
      <circle r="${escapeHtml(Math.max(1.25, Math.min(2.05, radius)).toFixed(2))}" fill="${escapeHtml(pointColor(index))}"></circle>
      <text x="${labelLeft ? "-2.9" : "2.9"}" y="0.85" text-anchor="${labelLeft ? "end" : "start"}">${escapeHtml(point.name)}</text>
    </g>
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
  const forceExpanded = state.allRankingsExpanded && !mobile;
  const expanded = forceExpanded || expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  const domain = rankingDomain(ranking.items, ranking);
  const showToggle = ranking.items.length > 3 && !forceExpanded;
  return `
    <article class="metric-card ranking-card ${open ? "open" : ""} ${expanded ? "expanded" : ""}" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking, "card"))}" data-ranking-card="${escapeHtml(id)}">
      <button class="ranking-card-toggle" type="button" data-action="toggle-ranking-card" data-ranking-id="${escapeHtml(id)}">
        <span class="ranking-card-title">
          <h3>${escapeHtml(ranking.title)}</h3>
          ${ranking.subtitle ? `<p class="metric-sub">${escapeHtml(ranking.subtitle)}</p>` : ""}
        </span>
        <span class="ranking-card-icon">${open ? "-" : "+"}</span>
      </button>
      <div class="ranking-card-body">
        ${ranking.items.length ? `<ol>${shown.map((item, index) => renderRankingItem(item, ranking, "", index, ranking.items.length, domain, expanded, "card")).join("")}</ol>` : `<p class="notice">${escapeHtml(resultsText("no_values", "Noch keine Werte."))}</p>`}
        ${showToggle ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? escapeHtml(resultsText("show_top_3", "Top 3 anzeigen")) : escapeHtml(resultsText("show_all", "Alle anzeigen"))}</button>` : ""}
      </div>
    </article>
  `;
}

function renderRankingItem(item, ranking, currentOilId, index, total, domain, showBoxPlot = false, variant = "mini") {
  const value = formatByUnit(item.value, ranking.unit);
  const itemId = item.oil_id || item.participant_id || item.id;
  const current = itemId === currentOilId ? " current" : "";
  const rankRatio = total <= 1 ? 0 : Math.max(0, Number(item.rank || index + 1) - 1) / (total - 1);
  const color = rankingColor(ranking, rankRatio, variant, item.value);
  const graph = showBoxPlot ? renderRankingGraph(item, ranking, domain) : "";
  const earnedCrowns = item.crown_awards ? `<div class="earned-crowns">${renderCrownIcons(item.crown_awards, true)}</div>` : "";
  return `
    <li class="${current}${graph || earnedCrowns ? " has-graph" : ""}${earnedCrowns ? " has-awards" : ""}" style="--rank-bg:${escapeHtml(color)}">
      ${renderRankPlace(item.rank, ranking)}
      <span class="rank-name">${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${earnedCrowns}
      ${graph}
    </li>
  `;
}

function renderRankPlace(rankValue, ranking) {
  const place = Number(rankValue);
  const crownPlace = place - Number(ranking?.crown_rank_offset || 0);
  if (rankingUsesCrowns(ranking) && [1, 2, 3].includes(crownPlace)) {
    return `
      <span class="rank-place crown-place crown-${escapeHtml(crownPlace)}" title="${escapeHtml(rank(place))}" aria-label="${escapeHtml(rank(place))}">
        <span class="crown-shape" aria-hidden="true"></span>
        <span class="crown-number">${escapeHtml(place)}</span>
      </span>
    `;
  }
  return `<span class="rank-place">${escapeHtml(rankValue || "")}</span>`;
}

function renderCrownIcons(awards = {}, compact = false) {
  const groups = [
    ["gold", Number(awards.gold || 0), 1, "Gold"],
    ["silver", Number(awards.silver || 0), 2, "Silber"],
    ["bronze", Number(awards.bronze || 0), 3, "Bronze"],
    ["blue", Number(awards.blue || 0), null, "Blau"],
  ];
  return groups
    .map(([type, count, place, label]) => Array.from({ length: count }, () => `<span class="award-crown award-crown-${type} ${place ? `crown-${place}` : ""} ${compact ? "compact" : ""}" title="${escapeHtml(label + "krone")}" aria-label="${escapeHtml(label + "krone")}"><i></i></span>`).join(""))
    .join("");
}

function renderRankingGraph(item, ranking, domain) {
  if (item.intermediate_values?.length) {
    return `<div class="rank-intermediate-values">${item.intermediate_values.map((entry) => `<span><em>${escapeHtml(entry.label)}</em><strong>${escapeHtml(number(entry.value))}</strong></span>`).join("")}</div>`;
  }
  if (ranking.graph === "price_deviation") return renderPriceDeviationPlot(item, ranking.price_domain);
  if (["spread", "own_spread"].includes(ranking.key)) return "";
  if (item.box) return renderBoxPlot(item.box, domain, ranking.unit);
  return "";
}

function renderBoxPlot(box, domain, unit) {
  if (!box || !domain) return "";
  const left = position(box.min, domain);
  const q1 = position(box.q1, domain);
  const medianValue = position(box.median ?? box.avg, domain);
  const q3 = position(box.q3, domain);
  const right = position(box.max, domain);
  const title = `n=${box.count}, min ${formatByUnit(box.min, unit)}, Median ${formatByUnit(box.median ?? box.avg, unit)}, max ${formatByUnit(box.max, unit)}`;
  return `
    <div class="rank-boxplot" title="${escapeHtml(title)}">
      <em class="boxplot-edge-label first">${escapeHtml(formatScaleLabel(domain.min, unit))}</em>
      <span class="boxplot-track">
        ${renderBoxPlotScale(domain, unit, false)}
        <span class="boxplot-whisker" style="left:${left}%;width:${Math.max(1, right - left)}%"></span>
        <span class="boxplot-box" style="left:${q1}%;width:${Math.max(1, q3 - q1)}%"></span>
        <span class="boxplot-median" style="left:${medianValue}%"></span>
      </span>
      <em class="boxplot-edge-label last">${escapeHtml(formatScaleLabel(domain.max, unit))}</em>
    </div>
  `;
}

function renderBoxPlotScale(domain, unit = "", edgeLabels = true) {
  const ticks = [];
  const step = Number(domain.step) || (domain.max - domain.min <= 10 ? 1 : 5);
  const tickCount = Math.round((domain.max - domain.min) / step);
  for (let index = 0; index <= tickCount; index += 1) {
    const value = index === tickCount ? domain.max : domain.min + step * index;
    const edge = index === 0 ? " first" : index === tickCount ? " last" : "";
    const label = edge && edgeLabels ? `<em>${escapeHtml(formatScaleLabel(value, unit))}</em>` : "";
    ticks.push(`<span class="${edge}" style="left:${escapeHtml(position(value, domain))}%">${label}</span>`);
  }
  return `<span class="boxplot-scale" aria-hidden="true">${ticks.join("")}</span>`;
}

function formatScaleLabel(value, unit) {
  const rounded = Math.round(Number(value));
  if (unit === "%") return `${Math.round(Number(value) * 100)}%`;
  if (unit === "€" || unit === "€±") return `${rounded} €`;
  if (unit === "Punkte±") {
    const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
    return `${sign}${Math.abs(rounded)}`;
  }
  return String(rounded);
}

function renderPriceDeviationPlot(item, domain) {
  if (!domain || item.actual_price_per_liter_eur === null || item.actual_price_per_liter_eur === undefined || item.price_guess_avg === null || item.price_guess_avg === undefined) {
    return "";
  }
  const actual = Number(item.actual_price_per_liter_eur);
  const guess = Number(item.price_guess_avg);
  const leftValue = Math.min(actual, guess);
  const rightValue = Math.max(actual, guess);
  const left = position(leftValue, domain);
  const right = position(rightValue, domain);
  const actualPos = position(actual, domain);
  const guessPos = position(guess, domain);
  const direction = guess >= actual ? "over" : "under";
  const eurDeviation = item.price_deviation_eur ?? guess - actual;
  const percentLabel = item.price_deviation_percent === null || item.price_deviation_percent === undefined ? "" : `, ${signedPercentPoints(item.price_deviation_percent)}`;
  return `
    <div class="rank-price-deviation" title="${escapeHtml(`Realpreis ${currency(actual)}, Schätzung ${currency(guess)}${percentLabel}`)}">
      <em class="boxplot-edge-label first">${escapeHtml(formatScaleLabel(domain.min, "€"))}</em>
      <span class="price-deviation-track">
        ${renderBoxPlotScale(domain, "€", false)}
        <span class="price-deviation-range ${direction}" style="left:${escapeHtml(left)}%;width:${escapeHtml(Math.max(1, right - left))}%">
          <span class="price-deviation-label">${escapeHtml(signedWholeCurrency(eurDeviation))}</span>
        </span>
        <span class="price-marker actual" style="left:${escapeHtml(actualPos)}%"></span>
        <span class="price-marker guess" style="left:${escapeHtml(guessPos)}%"></span>
      </span>
      <em class="boxplot-edge-label last">${escapeHtml(formatScaleLabel(domain.max, "€"))}</em>
    </div>
  `;
}

function renderOilCard(oil, surveys, rankings, options = {}) {
  const open = Boolean(options.forceOpen) || openOils.has(oil.id);
  const commentsTitle = oilText("comments_title", "Kommentare zum Aromaprofil von {oil}:").replaceAll("{oil}", oil.name);
  const toggleContent = `
        <h3>${escapeHtml(oil.name)}</h3>
        ${options.hideToggleIcon ? "" : `<span>${open ? "-" : "+"}</span>`}
      `;
  return `
    <article class="oil-card ${open ? "open" : ""}" data-oil-id="${escapeHtml(oil.id)}">
      ${
        options.staticHeader
          ? `<div class="oil-card-toggle static">${toggleContent}</div>`
          : `<button class="oil-card-toggle" type="button" data-action="toggle-oil" data-oil-id="${escapeHtml(oil.id)}">${toggleContent}</button>`
      }

      ${options.summaryOnly ? "" : `<div class="oil-card-body">
        <div class="oil-meta-row">
          <span>${escapeHtml(oil.type || "Öl")}</span>
          <span>${escapeHtml(realCurrency(oil.actual_price_per_liter_eur))}</span>
          ${oil.brought_by_name ? `<span>${escapeHtml(oilText("owner_label", "Mitgebracht von"))} ${escapeHtml(oil.brought_by_name)}</span>` : ""}
          <span>${escapeHtml(oil.response_count)} ${escapeHtml(oilText("ratings_suffix", "Wertungen"))}</span>
        </div>

        <div class="cipher-box ${revealedOils.has(oil.id) ? "revealed" : ""}">
          <div class="cipher-values">
            ${surveys
              .map((survey) => renderCipherValue(oil, survey, surveys))
              .join("")}
          </div>
          ${options.hideCipherShield || revealedOils.has(oil.id) ? "" : `<button class="cipher-shield" type="button" data-action="reveal">${escapeHtml(oilText("decrypt_button", "Dechiffrierung aufdecken"))}</button>`}
        </div>

        <div class="oil-stats">
          ${renderBreakdownCategories(oil, surveys, rankings)}
        </div>

        <div class="comment-panel">
          <h4>${escapeHtml(commentsTitle)}</h4>
          <div class="comment-scroll" data-scroll-key="${escapeHtml(oil.id)}">
            ${oil.comments.length ? oil.comments.map(renderComment).join("") : `<p class="notice">${escapeHtml(oilText("comments_empty", "Noch keine Kommentare."))}</p>`}
          </div>
        </div>
      </div>`}
    </article>
  `;
}

function renderCipherValue(oil, survey, surveys) {
  const personalSurvey = (oil.personal_surveys || []).find((entry) => entry.survey_id === survey.id);
  const answers = new Map((personalSurvey?.answers || []).map((answer) => [answer.field_id, answer]));
  const overall = answers.get("overall");
  const bitter = survey.id === "geschmack" ? answers.get("bitter") : null;
  const price = survey.id === "gesamt" ? answers.get("price_guess") : null;
  const ownRatingFallbacks = {
    geschmack: "eigene Geschmackswertung",
    geruch: "eigene Geruchswertung",
    gesamt: "eigene Wertung der vollen Erfahrung",
  };
  const ownRatingLabel = oilText(`own_${survey.id}_rating_label`, ownRatingFallbacks[survey.id] || "eigene Wertung");
  const personalRows = [
    overall ? `${ownRatingLabel}: ${formatPersonalAnswer(overall)}` : "",
    bitter ? `${oilText("own_bitter_label", "eigene Bitterkeitswahrnehmung")}: ${formatPersonalAnswer(bitter)}` : "",
    price ? `${oilText("own_price_label", "Preiseinschätzung")}: ${formatPersonalAnswer(price)} €` : "",
  ].filter(Boolean);
  const classification = survey.id === "geruch" ? renderOwnClassification(oil, surveys) : "";
  return `<div class="cipher-value"><b>${escapeHtml(seriesLabel(survey))}</b><i class="cipher-code">${escapeHtml(displayCipher(oil.ciphers[survey.id], survey))}</i>${personalRows.map((row) => `<small>${escapeHtml(row)}</small>`).join("")}${classification}</div>`;
}

function renderOwnClassification(oil, surveys) {
  const personalBySurvey = new Map((oil.personal_surveys || []).map((entry) => [entry.survey_id, entry]));
  const marks = surveys.map((survey) => {
    const answer = (personalBySurvey.get(survey.id)?.answers || []).find((entry) => entry.field_id === "oil_guess");
    if (!answer || answer.value === null || answer.value === undefined || answer.value === "") return '<em class="classification-mark missing">–</em>';
    const normalized = String(answer.value).trim().toLocaleLowerCase("de-DE");
    const classifiedAsOlive = ["olivenöl", "olivenoel", "ja", "yes", "true", "1"].includes(normalized);
    return `<em class="classification-mark ${classifiedAsOlive ? "yes" : "no"}">${classifiedAsOlive ? "✓" : "✕"}</em>`;
  });
  return `<small class="own-classification"><i class="classification-label">${escapeHtml(oilText("own_classification_label", "eigene Olivenöl-Klassifizierung"))}:</i> ${marks.join('<i class="classification-separator">|</i>')}</small>`;
}

function renderBreakdownCategories(oil, surveys, rankings) {
  return `
    ${renderCategory(oil, categoryText("overall", "Gesamt"), oil.overall.all.avg, oil.overall.all.rank, findRanking(rankings, "overall_all"), "number", "var(--overall-ranking-color)")}
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
    ${renderCategory(oil, categoryText("spread", "Streuung"), oil.spread.value, oil.spread.rank, findRanking(rankings, "spread"), "number")}
    ${renderCategory(oil, categoryText("own_spread", "individuelle Streuung"), oil.own_spread.value, oil.own_spread.rank, findRanking(rankings, "own_spread"), "number")}
    ${renderCategory(oil, categoryText("accuracy", "Richtig klassifiziert"), oil.guess.accuracy, oil.guess.rank, findRanking(rankings, "guess_accuracy"), "percent")}
    ${renderCategory(oil, categoryText("bitter", "Bitterkeit"), oil.bitter.avg, oil.bitter.rank, findRanking(rankings, "bitter"), "number")}
    ${renderCategory(oil, categoryText("price_guess", "Geschätzter Preis"), oil.price_guess.avg, oil.price_guess.rank, findRanking(rankings, "price_guess"), "currency")}
    ${renderCategory(oil, categoryText("price_deviation", "Abweichung vom realen Preis"), oil.price_deviation.avg, oil.price_deviation.rank, findRanking(rankings, "price_deviation"), "signed_percent_points")}
  `;
}

function renderCategory(oil, label, value, rankValue, ranking, valueType, color = "") {
  const id = `oil-${oil.id}-${ranking?.key || slugify(label)}`;
  const display = valueType === "percent" ? percent(value) : valueType === "signed_percent_points" ? signedPercentPoints(value) : valueType === "currency" ? currency(value) : valueType === "signed_currency" ? signedCurrency(value) : number(value);
  const categoryColor = color || rankingColorAccent(ranking || {});
  return `
    <details class="category-detail" style="--category-color:${escapeHtml(categoryColor)}">
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(display)}</strong>
        <em>${rankMarkup(rankValue, ranking)}</em>
      </summary>
      ${ranking ? renderMiniRanking(ranking, id, oil.id) : `<p class="notice">${escapeHtml(oilText("no_ranking", "Noch keine Rangliste."))}</p>`}
    </details>
  `;
}

function rankMarkup(rankValue, ranking) {
  const value = Number(rankValue);
  if (!rankingUsesCrowns(ranking) || ![1, 2, 3].includes(value)) return escapeHtml(rank(rankValue));
  return `${escapeHtml(resultsText("rank_prefix", "Platz"))} <span class="rank-crowned-number crown-${escapeHtml(value)}"><span class="inline-rank-crown" aria-hidden="true"></span><span class="rank-crowned-digit">${escapeHtml(value)}</span></span>`;
}

function rankingUsesCrowns(ranking) {
  if (ranking?.crowns === false) return false;
  return !["spread", "own_spread"].includes(ranking?.key || "");
}

function renderMiniRanking(ranking, id, currentOilId) {
  const expanded = expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  const domain = rankingDomain(ranking.items, ranking);
  return `
    ${ranking.items.length ? `<ol class="mini-ranking" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking))};">${shown.map((item, index) => renderRankingItem(item, ranking, currentOilId, index, ranking.items.length, domain, expanded, "mini")).join("")}</ol>` : `<p class="notice">${escapeHtml(resultsText("no_values", "Noch keine Werte."))}</p>`}
    ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? escapeHtml(resultsText("show_top_3", "Top 3 anzeigen")) : escapeHtml(resultsText("show_all", "Alle anzeigen"))}</button>` : ""}
  `;
}

function renderComment(comment) {
  return `
    <article class="comment-item">
      <span>${escapeHtml(commentIntro(comment))}</span>
      <p>${escapeHtml(comment.text)}</p>
    </article>
  `;
}

function commentIntro(comment) {
  const author = comment.author ? comment.author : oilText("anonymous", "anonym");
  const label = comment.series_label || comment.survey_title || "";
  const normalized = String(label).toLocaleLowerCase("de-DE");
  const article = comment.survey_id === "gesamt" || normalized.includes("erfahrung") ? "zur" : "zum";
  const contextualLabel = article === "zur" && normalized === "volle erfahrung" ? "vollen Erfahrung" : label;
  return `${article} ${contextualLabel} von ${author}:`;
}

function findRanking(rankings, titleOrKey) {
  return rankings.find((ranking) => ranking.title === titleOrKey || ranking.key === titleOrKey || ranking.key === slugify(titleOrKey));
}

function seriesLabel(survey) {
  return survey.series_label || survey.short_title || survey.title || survey.id;
}

function displayCipher(cipher, survey = {}) {
  if (survey.cipher_set === "greek") return greekSymbols[cipher] || cipher || "-";
  return cipher || "-";
}

function formatByUnit(value, unit) {
  if (unit === "%") return percent(value);
  if (unit === "Punkte±") return signedNumber(value);
  if (["Kommentare", "Zeichen", "Kronenpunkte"].includes(unit)) return value === null || value === undefined ? globalText("open_value", "offen") : String(Math.round(Number(value)));
  if (unit === "%±") return signedPercentPoints(value);
  if (unit === "€±") return signedCurrency(value);
  if (unit === "€") return currency(value);
  return number(value);
}

function signedPercentPoints(value) {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(0)}%`;
}

function rankingDomain(items, ranking) {
  if (ranking?.key === "overall_all" || String(ranking?.key || "").startsWith("overall_")) {
    return { min: -5, max: 5, step: 1 };
  }
  return boxDomain(items);
}

function boxDomain(items) {
  const values = items.flatMap((item) => (item.box ? [item.box.min, item.box.max] : []));
  if (!values.length) return null;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const absoluteMax = Math.max(Math.abs(rawMin), Math.abs(rawMax));
  const step = absoluteMax > 100 ? 20 : absoluteMax > 50 ? 10 : rawMax - rawMin <= 10 ? 1 : 5;
  let min = Math.floor(rawMin / step) * step;
  let max = Math.ceil(rawMax / step) * step;
  if (min === max) {
    min -= step;
    max += step;
  }
  return { min, max, step };
}

function position(value, domain) {
  return Math.max(0, Math.min(100, ((value - domain.min) / (domain.max - domain.min)) * 100));
}

function rankingColorAccent(ranking, variant = "mini") {
  if (ranking.color) return ranking.color;
  return "var(--neutral-ranking-color)";
}

function rankingColor(ranking, rankRatio, variant = "mini", value = null) {
  if (["spread", "own_spread", "participant_average_overall", "participant_oil_group_zero", "participant_bitter"].includes(ranking.key)) return priceGradientColor(rankRatio);
  if (["guess_accuracy", "participant_classification"].includes(ranking.key) && value !== null && value !== undefined) {
    return gradientColor(1 - Math.max(0, Math.min(1, Number(value))));
  }
  return gradientColor(rankRatio);
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
    state.password = document.getElementById(loginContext.passwordId)?.value || "";
    window.sessionStorage?.setItem(PASSWORD_KEY, state.password);
    loadResults().catch((error) => renderLogin(error.message));
    return;
  }

  const allRankings = event.target.closest('[data-action="toggle-all-rankings"]');
  if (allRankings) {
    state.allRankingsExpanded = !state.allRankingsExpanded;
    if (!state.allRankingsExpanded) expandedRankings.clear();
    if (state.payload) render(state.payload);
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
    if (!isMobileView()) {
      if (openOils.has(id)) openOils.clear();
      else {
        openOils.clear();
        openOils.add(id);
      }
    } else if (openOils.has(id)) {
      openOils.delete(id);
    } else {
      openOils.clear();
      openOils.add(id);
    }
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

app.addEventListener("input", (event) => {
  const slider = event.target.closest('[data-action="select-competitive-oil"]');
  if (!slider) return;
  state.selectingCompetitiveOil = true;
  state.competitiveOilIndex = Number(slider.value) || 0;
  updateTasteSpace();
});

app.addEventListener("change", (event) => {
  const slider = event.target.closest('[data-action="select-competitive-oil"]');
  if (!slider) return;
  state.selectingCompetitiveOil = false;
  updateTasteSpace();
});

app.addEventListener("pointerdown", (event) => {
  const slider = event.target.closest('[data-action="select-competitive-oil"]');
  if (slider) {
    state.selectingCompetitiveOil = true;
    return;
  }

  const plot = event.target.closest('[data-action="rotate-taste-space"]');
  if (!plot) return;
  state.rotatingTasteSpace = true;
  state.rotationStartX = event.clientX;
  state.rotationStartY = event.clientY;
  state.rotationStartPitch = state.tasteRotationX;
  state.rotationStartYaw = state.tasteRotationY;
  plot.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (!state.rotatingTasteSpace) return;
  state.tasteRotationY = state.rotationStartYaw + (event.clientX - state.rotationStartX) * 0.7;
  state.tasteRotationX = Math.max(-85, Math.min(85, state.rotationStartPitch - (event.clientY - state.rotationStartY) * 0.55));
  scheduleTasteSpaceUpdate();
});

document.addEventListener("pointerup", () => {
  state.selectingCompetitiveOil = false;
  state.rotatingTasteSpace = false;
});

app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.id === loginContext.passwordId) {
    event.preventDefault();
    app.querySelector('[data-action="login-results"]')?.click();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  event.target.querySelector("[data-action]")?.click();
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
  if (state.selectingCompetitiveOil || state.rotatingTasteSpace) return;
  if (state.password) loadResults().catch(() => undefined);
}, 2000);
